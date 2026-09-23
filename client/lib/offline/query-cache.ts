// Read-through cache for GET/query responses — the counterpart to
// mutation-policy.ts's outbox for writes. Populates the existing cache_*
// IndexedDB stores (schema already defined in db.ts, previously unused) on a
// successful eligible GET, and serves from them when that same GET later
// fails at the transport level (offline) or is skipped because the browser
// already knows it has no connection.
//
// Deliberately NOT a generic "cache every response" mechanism — only the
// endpoints listed in QUERY_CACHE_POLICIES are ever written or read, matching
// the current safe offline scope (Patients, OPD visits, IPD admissions,
// Pathology/Radiology requests). Sensitive fields are encrypted with the same
// client-side AES-256-GCM key as the outbox (client/lib/offline/crypto.ts) —
// never plaintext, never the backend's own encryption keys.
import type { CacheStoreName } from './db';
import { openOfflineDb } from './db';
import { encryptClientField, decryptClientField, getOrCreateClientKey } from './crypto';
import type { CachedRecord, OutboxEntityType } from './types';
import type { OfflineSession } from './session';

// Shared by both the entity-list filterFromUrl matching below and the
// keyed-singleton cache further down — a GET's `args.url` may be a bare path
// (no query string) or `path?a=b&c=d`; this always returns a (possibly empty)
// URLSearchParams either way.
function urlQueryParams(url: string): URLSearchParams {
  return new URLSearchParams(url.split('?')[1] ?? '');
}

// Which read-through cache store holds a given entity type's rows — reused
// by processor.ts to remove a CREATE entry's temp-id optimistic row once the
// real row has been fetched and cached under its server-assigned id.
export const CACHE_STORE_BY_ENTITY: Partial<Record<OutboxEntityType, CacheStoreName>> = {
  PATIENT:         'cache_patients',
  OPD_VISIT:       'cache_opd_visits',
  IPD_ADMISSION:   'cache_ipd_admissions',
  MANUAL_PAYMENT:  'cache_payments',
  INVENTORY_ITEM:  'cache_inventory',
  WARD:            'cache_wards_beds',
  BED:             'cache_wards_beds',
  PACKAGE:         'cache_packages',
  CHARGE:          'cache_charges',
};

// WARD and BED share cache_wards_beds under a key prefix (see
// listWards/listBeds sharing that store below) — processor.ts's post-sync
// cleanup needs this to delete the *actual* stored key, not the bare temp
// id, or the temp row is silently orphaned forever (every other entity type
// here writes its CREATE_CACHE_ENDPOINT target under an unprefixed store, so
// this map is deliberately sparse).
export const CACHE_STORE_KEY_PREFIX_BY_ENTITY: Partial<Record<OutboxEntityType, string>> = {
  WARD: 'ward:',
  BED:  'bed:',
};

type ResponseShape = 'single' | 'array' | 'wrapped';

// Narrows a cached entity list by the same filter params the live query sent
// — see matchesFilterSpec below for what each kind does. Applied on top of
// (not instead of) scopedByUrl: scopedByUrl is a hard structural scope a
// policy's live query is always subject to (e.g. "beds of this one ward"),
// while filterFromUrl replicates the page's own optional filter UI (a status
// dropdown, a date range, a search box) so switching that filter offline
// shows the matching subset of what's cached instead of everything cached.
type FilterFromUrlSpec =
  // Exact string equality against one param — a status/category/role/id enum
  // or foreign-key filter. Absent/empty param = no filter (matches everything).
  | { kind: 'exact'; param: string; field: string }
  // True/false param (e.g. lowStock=1) — only narrows when the param is
  // present AND truthy; unset or false leaves the list unfiltered, matching
  // how these checkboxes work online (present only when checked).
  | { kind: 'boolean'; param: string; field: string }
  // Case-insensitive substring match against one or more fields — a
  // best-effort, client-side approximation of the backend's own free-text
  // search (which may span joined fields or use different matching rules).
  | { kind: 'contains'; param: string; fields: string[] }
  // Date-range match against one ISO-ish field, via plain `new Date(param)`
  // on each bound — deliberately mirrors payment.repository.ts /
  // charges.repository.ts / audit.repository.ts's own `new Date(dateFrom)` /
  // `new Date(dateTo)` exactly, including their shared quirk that a bare
  // YYYY-MM-DD `to` bound (Billing/Audit Logs send one; Payments instead
  // pre-converts to a precise end-of-day instant client-side — see
  // payment.api.ts's toEndOfDay) parses as that day's UTC *midnight*, not
  // its end — so most of the selected end day is excluded both online and,
  // with this same parsing, offline. Replicating the exact (if surprising)
  // online behavior is the goal here, not second-guessing it. Either bound
  // may be absent (open-ended); an entity whose field fails to parse never
  // matches a range with at least one real bound set.
  | { kind: 'dateRange'; fromParam?: string; toParam?: string; field: string }
  // Same calendar day (ignoring time-of-day) — for a single `date` filter
  // like OPD's queue-by-day, not a range.
  | { kind: 'sameDay'; param: string; field: string }
  // Membership in an array-valued field (e.g. doctorId in doctorIds[]).
  | { kind: 'arrayIncludes'; param: string; field: string }
  // Both representations user.api.ts's listUsers can send for the same
  // underlying boolean (isActive=true/false, or status=ACTIVE/INACTIVE) —
  // whichever the caller's URL actually used.
  | { kind: 'activeStatus'; statusParam: string; isActiveParam: string; field: string };

// IST (UTC+5:30, no DST) calendar-day bucketing — mirrors
// server/src/modules/attendance/attendance.timezone.ts's toIstMidnight /
// getIstDateParts, which opd.repository.ts's findByDate uses for the exact
// same "queue for this calendar day" query the 'sameDay' kind replicates.
// Needed because a visit stored just after midnight IST is still "yesterday"
// in UTC — naively slicing the raw UTC ISO string's first 10 characters
// would bucket it under the wrong day for roughly the first 5.5 hours of
// every IST calendar day.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateKey(isoString: string): string | null {
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return null;
  const shifted = new Date(t + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function matchesFilterSpec(
  entity: Record<string, unknown>,
  spec: FilterFromUrlSpec,
  params: URLSearchParams,
): boolean {
  switch (spec.kind) {
    case 'exact': {
      const want = params.get(spec.param);
      if (!want) return true;
      return String(entity[spec.field] ?? '') === want;
    }
    case 'boolean': {
      const want = params.get(spec.param);
      if (want !== 'true' && want !== '1') return true;
      return entity[spec.field] === true;
    }
    case 'contains': {
      const want = params.get(spec.param)?.trim().toLowerCase();
      if (!want) return true;
      return spec.fields.some((field) => String(entity[field] ?? '').toLowerCase().includes(want));
    }
    case 'dateRange': {
      const from = spec.fromParam ? params.get(spec.fromParam) : null;
      const to   = spec.toParam   ? params.get(spec.toParam)   : null;
      if (!from && !to) return true;

      const raw = entity[spec.field];
      const t = typeof raw === 'string' ? new Date(raw).getTime() : NaN;
      if (Number.isNaN(t)) return false;

      if (from) {
        const fromT = new Date(from).getTime();
        if (!Number.isNaN(fromT) && t < fromT) return false;
      }
      if (to) {
        const toT = new Date(to).getTime();
        if (!Number.isNaN(toT) && t > toT) return false;
      }
      return true;
    }
    case 'sameDay': {
      const want = params.get(spec.param);
      if (!want) return true;
      const raw = entity[spec.field];
      if (typeof raw !== 'string') return false;
      return istDateKey(raw) === want.slice(0, 10);
    }
    case 'arrayIncludes': {
      const want = params.get(spec.param);
      if (!want) return true;
      const arr = entity[spec.field];
      return Array.isArray(arr) && arr.includes(want);
    }
    case 'activeStatus': {
      const status = params.get(spec.statusParam);
      if (status === 'ACTIVE')   return entity[spec.field] === true;
      if (status === 'INACTIVE') return entity[spec.field] === false;
      const isActive = params.get(spec.isActiveParam);
      if (isActive === 'true')  return entity[spec.field] === true;
      if (isActive === 'false') return entity[spec.field] === false;
      return true;
    }
  }
}

function applyFiltersFromUrl(
  entities: Record<string, unknown>[],
  url: string,
  specs: FilterFromUrlSpec[],
): Record<string, unknown>[] {
  const params = urlQueryParams(url);
  return entities.filter((entity) => specs.every((spec) => matchesFilterSpec(entity, spec, params)));
}

interface QueryCachePolicy {
  cacheStore:      CacheStoreName;
  idField:         string;
  responseShape:   ResponseShape;
  // Sensitive field names (top-level on the entity) — mirrors the backend's
  // own encrypted-field list per module (see CLAUDE.md "Field-Level
  // Encryption"). Stored as one encrypted JSON blob, never plaintext.
  sensitiveFields: string[];
  // Only for 'single' — extracts the requested id from the GET URL so a
  // fallback read returns exactly the one row that was requested, not
  // whatever happens to be first in the store.
  urlIdPattern?:   RegExp;
  // Distinguishes rows sharing a cache store with another entity type (e.g.
  // wards and beds both live in cache_wards_beds — see CACHE_STORE_NAMES in
  // db.ts) — prefixed onto the IDB key at write time and used as a filter at
  // read time, so the two entity types can never collide or leak into each
  // other's list reads.
  storeKeyPrefix?: string;
  // For 'array'/'wrapped' policies whose live query is itself scoped by a
  // path param (e.g. listBeds is always "beds of one ward") — extracts that
  // param from the request URL and keeps only cached rows whose matchField
  // equals it, instead of returning every cached row of that entity type.
  scopedByUrl?:    { pattern: RegExp; matchField: string };
  // Replicates the live query's own optional filters (status/category/date
  // range/search box/…) against the cached rows — see FilterFromUrlSpec.
  // Only meaningful for 'array'/'wrapped'; ignored for 'single'.
  filterFromUrl?:  FilterFromUrlSpec[];
  // Opt in for any policy an offline CREATE can write into (see
  // base.api.ts's CREATE_CACHE_ENDPOINT) — sorts pendingSync rows first
  // (most-recently-created first), so a just-created record shows at the
  // top of its list immediately, matching "newly created records must
  // appear at the top" without waiting for a real sync/refetch. Falls back
  // to createdAt DESC for the rest, mirroring the backend's own default sort.
  sortPendingFirst?: boolean;
}

const PATIENT_SENSITIVE_FIELDS = [
  'aadhaarNumber', 'dateOfBirth', 'bloodGroup',
  'emergencyContactName', 'emergencyContactMobile',
  'address', 'addressLine1', 'addressLine2', 'city', 'state', 'country', 'pincode',
];
const OPD_SENSITIVE_FIELDS = ['diagnosis', 'prescription', 'notes', 'vitals'];
const IPD_SENSITIVE_FIELDS = ['progressNotes', 'vitals'];
const LAB_SENSITIVE_FIELDS = ['notes'];
// Mirrors PAYMENT_DATA_ENCRYPTION_KEY's backend field list (CLAUDE.md
// "Field-Level Encryption": Payment.description/.transactionId, Charge.description).
const PAYMENT_SENSITIVE_FIELDS = ['description', 'transactionId'];
const CHARGE_SENSITIVE_FIELDS = ['description'];
// Wards, beds, departments, users, inventory, packages and audit logs carry
// no PHI/clinical data (see CLAUDE.md "Field-Level Encryption" — none of
// these modules appear in the encrypted-field lists; audit entries already
// redact any sensitive value server-side before they're ever returned), so
// nothing here needs the encrypted-blob treatment.
const NO_SENSITIVE_FIELDS: string[] = [];

export const QUERY_CACHE_POLICIES: Record<string, QueryCachePolicy> = {
  getPatientById: {
    cacheStore: 'cache_patients', idField: 'patientId', responseShape: 'single',
    urlIdPattern: /^\/api\/patients\/([^/?]+)$/,
    sensitiveFields: PATIENT_SENSITIVE_FIELDS,
  },
  searchPatients: {
    cacheStore: 'cache_patients', idField: 'patientId', responseShape: 'wrapped',
    sensitiveFields: PATIENT_SENSITIVE_FIELDS, sortPendingFirst: true,
    filterFromUrl: [
      { kind: 'contains', param: 'q', fields: ['fullName', 'mobileNumber', 'patientId'] },
    ],
  },
  getOPDVisitById: {
    cacheStore: 'cache_opd_visits', idField: 'visitId', responseShape: 'single',
    urlIdPattern: /^\/api\/opd\/visits\/([^/?]+)$/,
    sensitiveFields: OPD_SENSITIVE_FIELDS,
  },
  getOPDQueue: {
    cacheStore: 'cache_opd_visits', idField: 'visitId', responseShape: 'array',
    sensitiveFields: OPD_SENSITIVE_FIELDS,
    filterFromUrl: [
      { kind: 'sameDay', param: 'date', field: 'visitDate' },
      { kind: 'arrayIncludes', param: 'doctorId', field: 'doctorIds' },
      // opd.service.ts's getQueue searches fullName/patientId only (not visitId).
      { kind: 'contains', param: 'search', fields: ['fullName', 'patientId'] },
    ],
  },
  getAdmissionById: {
    cacheStore: 'cache_ipd_admissions', idField: 'admissionId', responseShape: 'single',
    urlIdPattern: /^\/api\/ipd\/admissions\/([^/?]+)$/,
    sensitiveFields: IPD_SENSITIVE_FIELDS,
  },
  listAdmissions: {
    cacheStore: 'cache_ipd_admissions', idField: 'admissionId', responseShape: 'wrapped',
    sensitiveFields: IPD_SENSITIVE_FIELDS,
    filterFromUrl: [
      // ipd.api.ts always sends `status` (defaults to 'ADMITTED' when the
      // caller doesn't override it), so this is never a no-op in practice.
      { kind: 'exact', param: 'status', field: 'status' },
      { kind: 'exact', param: 'wardId', field: 'wardId' },
      // ipd.service.ts's search resolves matching Patient fullName/patientId
      // only (not the admission's own id) — mirrored exactly here.
      { kind: 'contains', param: 'search', fields: ['fullName', 'patientId'] },
    ],
  },
  // Pathology and radiology requests share cache_lab_requests (see
  // CACHE_STORE_NAMES in db.ts) but both use 'requestId' as their idField —
  // storeKeyPrefix (same pattern as listWards/listBeds sharing
  // cache_wards_beds) keeps the two entity types from colliding on write and,
  // just as importantly, from leaking into each other's list/detail reads:
  // without it, an offline read of the Pathology tab would return every
  // cached Radiology request too (and vice versa), each missing the fields
  // the table expects for its actual type.
  getPathologyRequest: {
    cacheStore: 'cache_lab_requests', idField: 'requestId', responseShape: 'single',
    urlIdPattern: /^\/api\/lab\/pathology\/([^/?]+)$/,
    sensitiveFields: LAB_SENSITIVE_FIELDS, storeKeyPrefix: 'pathology:',
  },
  listPathologyRequests: {
    cacheStore: 'cache_lab_requests', idField: 'requestId', responseShape: 'wrapped',
    sensitiveFields: LAB_SENSITIVE_FIELDS, storeKeyPrefix: 'pathology:',
    filterFromUrl: [
      { kind: 'exact', param: 'status', field: 'status' },
      { kind: 'exact', param: 'patientId', field: 'patientId' },
      // lab.service.ts's search resolves matching Patient fullName/patientId
      // only (not requestId/testType) — mirrored exactly here.
      { kind: 'contains', param: 'search', fields: ['fullName', 'patientId'] },
    ],
  },
  getRadiologyRequest: {
    cacheStore: 'cache_lab_requests', idField: 'requestId', responseShape: 'single',
    urlIdPattern: /^\/api\/lab\/radiology\/([^/?]+)$/,
    sensitiveFields: LAB_SENSITIVE_FIELDS, storeKeyPrefix: 'radiology:',
  },
  listRadiologyRequests: {
    cacheStore: 'cache_lab_requests', idField: 'requestId', responseShape: 'wrapped',
    sensitiveFields: LAB_SENSITIVE_FIELDS, storeKeyPrefix: 'radiology:',
    filterFromUrl: [
      { kind: 'exact', param: 'status', field: 'status' },
      { kind: 'exact', param: 'patientId', field: 'patientId' },
      // Same scope as listPathologyRequests above — patient fullName/patientId only.
      { kind: 'contains', param: 'search', fields: ['fullName', 'patientId'] },
    ],
  },
  // Offline-navigation shell support — filter/assignment dropdowns used on
  // the Patients/OPD/IPD/Lab pages themselves. Non-sensitive, so cached
  // entirely in plaintextFields (no encryptedFieldsCiphertext).
  listWards: {
    cacheStore: 'cache_wards_beds', idField: 'wardId', responseShape: 'array',
    sensitiveFields: NO_SENSITIVE_FIELDS, storeKeyPrefix: 'ward:', sortPendingFirst: true,
  },
  listBeds: {
    cacheStore: 'cache_wards_beds', idField: 'bedId', responseShape: 'array',
    sensitiveFields: NO_SENSITIVE_FIELDS, storeKeyPrefix: 'bed:',
    // listBeds's live query is always scoped to one ward (/api/ipd/wards/:wardId/beds) —
    // without this, an offline read would return every cached bed across every ward.
    scopedByUrl: { pattern: /^\/api\/ipd\/wards\/([^/?]+)\/beds/, matchField: 'wardId' },
  },
  listDepartments: {
    cacheStore: 'cache_departments', idField: 'departmentId', responseShape: 'array',
    sensitiveFields: NO_SENSITIVE_FIELDS,
  },
  // Shared by the Users/Staff pages' own filters AND the OPD/IPD/Wards/Lab
  // doctor/nurse dropdowns (useListUsersQuery({ role, isActive, limit })) —
  // fixing this once means an offline doctor dropdown also correctly shows
  // only active doctors instead of every cached user regardless of role.
  listUsers: {
    cacheStore: 'cache_users', idField: 'userId', responseShape: 'wrapped',
    sensitiveFields: NO_SENSITIVE_FIELDS,
    filterFromUrl: [
      { kind: 'exact', param: 'role', field: 'role' },
      { kind: 'activeStatus', statusParam: 'status', isActiveParam: 'isActive', field: 'isActive' },
      { kind: 'contains', param: 'search', fields: ['name', 'email'] },
    ],
  },
  // Active-employee roster for the Attendance "Employee" filter — its own
  // store (not shared with cache_users/listUsers): its rows carry only a
  // subset of UserResponse's fields (userId/name/email), and listUsers's own
  // read has no storeKeyPrefix filter of its own to exclude a differently-
  // shaped row keyed under the same userId.
  listEmployeeRoster: {
    cacheStore: 'cache_employee_roster', idField: 'userId', responseShape: 'array',
    sensitiveFields: NO_SENSITIVE_FIELDS,
  },
  listInventoryItems: {
    cacheStore: 'cache_inventory', idField: 'itemId', responseShape: 'wrapped',
    sensitiveFields: NO_SENSITIVE_FIELDS, sortPendingFirst: true,
    filterFromUrl: [
      // inventory.repository.ts matches category case-insensitively and by
      // partial string (`$regex`), not exact equality — 'contains' mirrors
      // that; 'exact' would wrongly hide a partial match like "glov" → "Gloves".
      { kind: 'contains', param: 'category', fields: ['category'] },
      { kind: 'boolean', param: 'lowStock', field: 'isLowStock' },
    ],
  },
  listPackages: {
    cacheStore: 'cache_packages', idField: 'packageId', responseShape: 'wrapped',
    sensitiveFields: NO_SENSITIVE_FIELDS, sortPendingFirst: true,
    filterFromUrl: [
      { kind: 'exact', param: 'status', field: 'status' },
    ],
  },
  // Shares cache_packages with listPackages above (same idField, no prefix
  // needed — packages are the only entity type in that store) — a package
  // written by either a real GET or an offline CREATE's optimistic cache
  // write (see base.api.ts's CREATE_CACHE_ENDPOINT) is immediately readable
  // through both. Without this policy, opening a package's own detail page
  // (client/app/(dashboard)/packages/[packageId]/page.tsx's useGetPackageQuery)
  // has no offline fallback at all — previously the single biggest cause of
  // a newly-created offline package failing to open.
  getPackage: {
    cacheStore: 'cache_packages', idField: 'packageId', responseShape: 'single',
    urlIdPattern: /^\/api\/packages\/([^/?]+)$/,
    sensitiveFields: NO_SENSITIVE_FIELDS,
  },
  listPayments: {
    cacheStore: 'cache_payments', idField: 'paymentId', responseShape: 'wrapped',
    sensitiveFields: PAYMENT_SENSITIVE_FIELDS, sortPendingFirst: true,
    filterFromUrl: [
      { kind: 'exact', param: 'patientId', field: 'patientId' },
      { kind: 'exact', param: 'paymentMethod', field: 'paymentMethod' },
      { kind: 'exact', param: 'status', field: 'status' },
      { kind: 'exact', param: 'referenceType', field: 'referenceType' },
      { kind: 'exact', param: 'referenceId', field: 'referenceId' },
      { kind: 'dateRange', fromParam: 'dateFrom', toParam: 'dateTo', field: 'createdAt' },
    ],
  },
  listCharges: {
    cacheStore: 'cache_charges', idField: 'chargeId', responseShape: 'wrapped',
    sensitiveFields: CHARGE_SENSITIVE_FIELDS, sortPendingFirst: true,
    filterFromUrl: [
      { kind: 'exact', param: 'patientId', field: 'patientId' },
      { kind: 'exact', param: 'category', field: 'category' },
      { kind: 'exact', param: 'addedBy', field: 'addedBy' },
      { kind: 'contains', param: 'addedByName', fields: ['addedByName'] },
      { kind: 'dateRange', fromParam: 'startDate', toParam: 'endDate', field: 'createdAt' },
    ],
  },
  listAuditLogs: {
    cacheStore: 'cache_audit_logs', idField: 'auditId', responseShape: 'wrapped',
    sensitiveFields: NO_SENSITIVE_FIELDS,
    filterFromUrl: [
      { kind: 'exact', param: 'entityType', field: 'entityType' },
      { kind: 'exact', param: 'entityId', field: 'entityId' },
      { kind: 'exact', param: 'userId', field: 'userId' },
      { kind: 'dateRange', fromParam: 'dateFrom', toParam: 'dateTo', field: 'timestamp' },
    ],
  },
};

function extractEntities(rawData: unknown, shape: ResponseShape): Record<string, unknown>[] {
  if (shape === 'single') {
    return rawData && typeof rawData === 'object' ? [rawData as Record<string, unknown>] : [];
  }
  if (shape === 'array') {
    return Array.isArray(rawData) ? (rawData as Record<string, unknown>[]) : [];
  }
  // wrapped: { data: [...], total, page, limit, ... }
  const inner = (rawData as { data?: unknown } | undefined)?.data;
  return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [];
}

/**
 * The inverse of extractEntities — shapes a single bare optimistic entity
 * into whatever raw response body the named policy's responseShape expects,
 * so cacheQueryResult's own extractEntities can find it. Only base.api.ts's
 * offline CREATE path needs this: it always has exactly one freshly-minted
 * entity to persist, never the paginated/wrapped body a real GET receives.
 * A 'single' policy needs no wrapping — its raw shape already *is* the bare
 * entity — so this only ever changes anything for 'array'/'wrapped'.
 */
export function wrapForCacheWrite(endpointName: string, entity: Record<string, unknown>): unknown {
  const policy = QUERY_CACHE_POLICIES[endpointName];
  if (!policy || policy.responseShape === 'single') return entity;
  if (policy.responseShape === 'array') return [entity];
  return { data: [entity], total: 1, page: 1, limit: 1, totalPages: 1 };
}

function splitEntity(
  entity: Record<string, unknown>,
  sensitiveFields: string[],
): { plaintext: Record<string, unknown>; sensitive: Record<string, unknown> } {
  const plaintext: Record<string, unknown> = {};
  const sensitive: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (sensitiveFields.includes(key)) sensitive[key] = value;
    else plaintext[key] = value;
  }
  return { plaintext, sensitive };
}

/**
 * Persists a successful eligible GET response into the matching cache_*
 * store. Best-effort and fire-and-forget by design (see base.api.ts) — never
 * throws in a way that should affect the response already delivered to the UI.
 */
export async function cacheQueryResult(
  endpointName: string,
  rawData: unknown,
  session: OfflineSession,
  options?: { pendingSync?: boolean },
): Promise<void> {
  const policy = QUERY_CACHE_POLICIES[endpointName];
  if (!policy) return;

  const entities = extractEntities(rawData, policy.responseShape);
  if (entities.length === 0) return;

  const key = await getOrCreateClientKey(session.tenantId, session.userId);
  const db = await openOfflineDb(session.tenantId, session.userId);

  for (const entity of entities) {
    const id = entity[policy.idField];
    if (typeof id !== 'string') continue;

    const { plaintext, sensitive } = splitEntity(entity, policy.sensitiveFields);
    const encryptedFieldsCiphertext = Object.keys(sensitive).length > 0
      ? await encryptClientField(JSON.stringify(sensitive), key)
      : null;

    const record: CachedRecord = {
      id: policy.storeKeyPrefix ? `${policy.storeKeyPrefix}${id}` : id,
      plaintextFields: plaintext,
      encryptedFieldsCiphertext,
      version: typeof entity.updatedAt === 'string' ? entity.updatedAt : null,
      cachedAt: Date.now(),
      ...(options?.pendingSync ? { pendingSync: true } : {}),
    };

    await db.put(policy.cacheStore, record);
  }
}

// Pending-sync rows (offline-created/edited, not yet synced) sort first —
// most recently created/edited first — matching the "new/edited record
// stays at the top" requirement. Everything else falls back to createdAt
// DESC, mirroring the backend's own default `.sort({ createdAt: -1 })" so
// the offline list order matches the online order instead of IndexedDB's
// arbitrary key-based getAll() order. Applied to any policy with
// sortPendingFirst set — see readCachedQueryResult.
function comparePendingFirstRecords(a: CachedRecord, b: CachedRecord): number {
  const aPending = !!a.pendingSync;
  const bPending = !!b.pendingSync;
  if (aPending !== bPending) return aPending ? -1 : 1;
  if (aPending) return b.cachedAt - a.cachedAt;

  const aCreatedAt = typeof a.plaintextFields.createdAt === 'string' ? a.plaintextFields.createdAt : '';
  const bCreatedAt = typeof b.plaintextFields.createdAt === 'string' ? b.plaintextFields.createdAt : '';
  return bCreatedAt.localeCompare(aCreatedAt);
}

async function decryptRecord(record: CachedRecord, key: CryptoKey): Promise<Record<string, unknown>> {
  if (!record.encryptedFieldsCiphertext) return { ...record.plaintextFields };
  const json = await decryptClientField(record.encryptedFieldsCiphertext, key);
  const sensitive = JSON.parse(json) as Record<string, unknown>;
  return { ...record.plaintextFields, ...sensitive };
}

/**
 * Reconstructs the response `data` an eligible query's own transformResponse
 * expects, from whatever is cached — or null if this endpoint isn't
 * cacheable or nothing is cached for it. List/paginated endpoints ignore the
 * original *pagination* params (page/limit — offline always returns one
 * unpaginated page of everything matching) but, where the policy declares
 * `filterFromUrl`, DO replicate the caller's status/category/date-range/
 * search filters against the cached rows client-side, so switching a filter
 * offline shows the matching subset of what's cached rather than silently
 * showing everything regardless of the selected filter. A policy with no
 * `filterFromUrl` (or an unlisted filter param) falls back to the original,
 * documented best-effort simplification: "see the record you already
 * viewed," unfiltered.
 */
export async function readCachedQueryResult(
  endpointName: string,
  args: { url: string },
  session: OfflineSession,
): Promise<unknown | null> {
  const policy = QUERY_CACHE_POLICIES[endpointName];
  if (!policy) return null;

  const key = await getOrCreateClientKey(session.tenantId, session.userId);
  const db = await openOfflineDb(session.tenantId, session.userId);

  if (policy.responseShape === 'single') {
    const match = policy.urlIdPattern?.exec(args.url);
    const id = match?.[1];
    if (!id) return null;

    const storeKey = policy.storeKeyPrefix ? `${policy.storeKeyPrefix}${id}` : id;
    const record = await db.get(policy.cacheStore, storeKey);
    if (!record) return null;
    return decryptRecord(record, key);
  }

  const allRecords = await db.getAll(policy.cacheStore);
  const records = policy.storeKeyPrefix
    ? allRecords.filter((record) => record.id.startsWith(policy.storeKeyPrefix!))
    : allRecords;
  if (records.length === 0) return null;

  const orderedRecords = policy.sortPendingFirst
    ? [...records].sort(comparePendingFirstRecords)
    : records;

  let entities = await Promise.all(orderedRecords.map((record) => decryptRecord(record, key)));

  if (policy.scopedByUrl) {
    const match = policy.scopedByUrl.pattern.exec(args.url);
    const scopeValue = match?.[1];
    if (!scopeValue) return null;
    entities = entities.filter((entity) => entity[policy.scopedByUrl!.matchField] === scopeValue);
  }

  if (policy.filterFromUrl) {
    entities = applyFiltersFromUrl(entities, args.url, policy.filterFromUrl);
  }

  if (policy.responseShape === 'array') return entities;

  // wrapped
  return {
    data: entities,
    total: entities.length,
    page: 1,
    limit: entities.length,
    totalPages: 1,
  };
}

// ─── Singleton endpoints ────────────────────────────────────────────────────
// These don't fit the entity-list model above — each is one aggregate object
// per query, not a collection with an idField. Stored whole in the existing
// generic `meta` store, entirely in plaintext: none of DashboardStats
// (dashboard.api.ts), MyProfileResponse, WardOccupancySummary[],
// AttendanceMonthResponse, PaymentSummaryResponse or DepartmentRevenueResponse
// carry a field appearing in CLAUDE.md's encrypted-field lists, so there is
// no sensitive sub-data to split out and encrypt.
//
// Most of these endpoints (getDashboardStats, getMyProfile,
// getOccupancySummary) take no args that change the underlying data, so one
// shared cache entry per endpoint is correct — exactly like before. A few
// (getMyAttendance/listAttendance's month+employee, getPaymentSummary/
// getDepartmentRevenue's date range) take args that select a genuinely
// different report; for those, `keyFromUrl` folds the relevant params into
// the cache key so switching the selected period while offline can never
// silently show one period's figures mislabeled as another's — the same
// problem `scopedByUrl` solves for listBeds above, just for a singleton
// rather than a list.
interface SingletonPolicy {
  keyFromUrl?: (url: string) => string;
}

const SINGLETON_QUERY_ENDPOINTS: Record<string, SingletonPolicy> = {
  getDashboardStats:   {},
  getMyProfile:        {},
  getOccupancySummary: {},
  getMyAttendance: {
    keyFromUrl: (url) => {
      const p = urlQueryParams(url);
      return `${p.get('month')}-${p.get('year')}`;
    },
  },
  listAttendance: {
    keyFromUrl: (url) => {
      const p = urlQueryParams(url);
      return `${p.get('userId')}-${p.get('month')}-${p.get('year')}`;
    },
  },
  getPaymentSummary: {
    keyFromUrl: (url) => {
      const p = urlQueryParams(url);
      return `${p.get('dateFrom') ?? ''}_${p.get('dateTo') ?? ''}`;
    },
  },
  getDepartmentRevenue: {
    keyFromUrl: (url) => {
      const p = urlQueryParams(url);
      return `${p.get('dateFrom') ?? ''}_${p.get('dateTo') ?? ''}_${p.get('paymentMethod') ?? ''}_${p.get('status') ?? ''}`;
    },
  },
};

export function isSingletonCacheEndpoint(endpointName: string): boolean {
  return endpointName in SINGLETON_QUERY_ENDPOINTS;
}

function singletonMetaKey(endpointName: string, url: string): string {
  const suffix = SINGLETON_QUERY_ENDPOINTS[endpointName]?.keyFromUrl?.(url);
  return suffix ? `singleton:${endpointName}:${suffix}` : `singleton:${endpointName}`;
}

/**
 * Same fire-and-forget contract as cacheQueryResult — see its docstring.
 * `url` is only needed by endpoints with a `keyFromUrl` policy (defaults to
 * '' so existing no-arg callers, and the endpoints that don't need it, are
 * unaffected).
 */
export async function cacheSingletonQueryResult(
  endpointName: string,
  rawData: unknown,
  session: OfflineSession,
  url: string = '',
): Promise<void> {
  if (!isSingletonCacheEndpoint(endpointName)) return;
  if (!rawData || typeof rawData !== 'object') return;

  const db = await openOfflineDb(session.tenantId, session.userId);
  await db.put('meta', { key: singletonMetaKey(endpointName, url), value: rawData });
}

/**
 * Mirrors readCachedQueryResult's contract for the entity-list endpoints:
 * reconstructs the response `data` the endpoint's own transformResponse
 * expects, or null if nothing is cached yet for this endpoint (and, for a
 * keyed endpoint, this exact arg combination).
 */
export async function readCachedSingletonQueryResult(
  endpointName: string,
  session: OfflineSession,
  url: string = '',
): Promise<unknown | null> {
  if (!isSingletonCacheEndpoint(endpointName)) return null;

  const db = await openOfflineDb(session.tenantId, session.userId);
  const row = await db.get('meta', singletonMetaKey(endpointName, url));
  return row ? row.value : null;
}
