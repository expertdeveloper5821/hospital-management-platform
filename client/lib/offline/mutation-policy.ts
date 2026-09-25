// Which RTK Query mutations may be queued offline, and how. This is the
// client-side mirror of the backend's idempotency-guarded route list
// (server/src/shared/middleware/idempotency.ts call sites) — see the offline
// architecture plan, §1 "Data Classification".
//
// Two allowlists live here: OFFLINE_MUTATION_POLICIES (below) for UPDATE/
// APPEND against an entity the user has already fetched, and
// OFFLINE_CREATE_POLICIES (further down) for CREATE — createPatient,
// createOPDVisit, createAdmission, createManualPayment. Bed/ward
// reassignment and Razorpay payments remain online-only and are simply
// absent from both tables.
import type { OutboxEntityType, OutboxOperation, TempIdRef } from './types';

export const TEMP_ID_PREFIX = 'temp-';

export function isTempId(id: string | undefined | null): boolean {
  return typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX);
}

interface MutationPolicy {
  entityType:            OutboxEntityType;
  operation:             OutboxOperation;
  urlPattern:            RegExp;
  // Body fields allowed while offline; undefined = every field on this
  // endpoint is safe. Anything else (e.g. IPD's assignedDoctorId/wardId/bedId,
  // OPD's doctorIds/visitDate) touches server-side-only logic with no DB
  // constraint backing it and must go through the normal online path.
  allowedBodyFields?:    string[];
  // Field name on the cached entity (and in the outbox's dependent lookups)
  // used to find this record in the RTK Query cache.
  idFieldForCacheLookup: string;
}

const OFFLINE_MUTATION_POLICIES: Record<string, MutationPolicy> = {
  updatePatient: {
    entityType: 'PATIENT', operation: 'UPDATE',
    urlPattern: /^\/api\/patients\/([^/]+)$/,
    idFieldForCacheLookup: 'patientId',
  },
  updateOPDVisit: {
    entityType: 'OPD_VISIT', operation: 'UPDATE',
    urlPattern: /^\/api\/opd\/visits\/([^/]+)$/,
    allowedBodyFields: ['diagnosis', 'prescription', 'notes', 'vitals'],
    idFieldForCacheLookup: 'visitId',
  },
  addProgressNote: {
    entityType: 'IPD_PROGRESS_NOTE', operation: 'APPEND',
    urlPattern: /^\/api\/ipd\/admissions\/([^/]+)\/progress-notes$/,
    idFieldForCacheLookup: 'admissionId',
  },
  updateAdmission: {
    entityType: 'IPD_ADMISSION_VITALS', operation: 'UPDATE',
    urlPattern: /^\/api\/ipd\/admissions\/([^/]+)$/,
    allowedBodyFields: ['vitals'],
    idFieldForCacheLookup: 'admissionId',
  },
  editPathologyRequest: {
    entityType: 'LAB_REQUEST', operation: 'UPDATE',
    urlPattern: /^\/api\/lab\/pathology\/([^/]+)$/,
    allowedBodyFields: ['notes'],
    idFieldForCacheLookup: 'requestId',
  },
  editRadiologyRequest: {
    entityType: 'LAB_REQUEST', operation: 'UPDATE',
    urlPattern: /^\/api\/lab\/radiology\/([^/]+)$/,
    allowedBodyFields: ['notes'],
    idFieldForCacheLookup: 'requestId',
  },
};

export interface OfflineMutationPlan {
  entityType:            OutboxEntityType;
  operation:             OutboxOperation;
  subjectId:             string;
  idFieldForCacheLookup: string;
  url:                   string;
  method:                'POST' | 'PATCH';
  body:                  Record<string, unknown>;
}

/**
 * Returns how to queue this mutation offline, or null if it isn't eligible —
 * either it's not on the allowlist at all, its subject id is an unsynced temp
 * id (URL-embedded temp-id substitution isn't supported), or its body touches
 * a field outside the safe subset for that endpoint.
 */
export function planOfflineMutation(
  endpointName: string,
  args: { url: string; method?: string; body?: unknown },
): OfflineMutationPlan | null {
  const policy = OFFLINE_MUTATION_POLICIES[endpointName];
  if (!policy) return null;

  const match = policy.urlPattern.exec(args.url);
  if (!match) return null;

  const subjectId = match[1];
  if (isTempId(subjectId)) return null;

  const body = (args.body && typeof args.body === 'object' ? args.body : {}) as Record<string, unknown>;
  if (policy.allowedBodyFields && !Object.keys(body).every((key) => policy.allowedBodyFields!.includes(key))) {
    return null;
  }

  return {
    entityType:            policy.entityType,
    operation:             policy.operation,
    subjectId,
    idFieldForCacheLookup: policy.idFieldForCacheLookup,
    url:                   args.url,
    method:                (args.method as 'POST' | 'PATCH' | undefined) ?? 'PATCH',
    body,
  };
}

/**
 * Produces the best-effort optimistic entity to show immediately, by patching
 * the queued body onto the entity's last-known cached state (never fabricated
 * from scratch — see planOfflineMutation callers, which only queue when a
 * cached entity was actually found).
 */
export function applyOptimisticPatch(
  entityType: OutboxEntityType,
  cached: Record<string, unknown>,
  body: Record<string, unknown>,
  context: { userId: string },
): Record<string, unknown> {
  if (entityType === 'IPD_PROGRESS_NOTE') {
    const existingNotes = Array.isArray(cached.progressNotes) ? cached.progressNotes : [];
    const newNote = {
      noteId:    `${TEMP_ID_PREFIX}${crypto.randomUUID()}`,
      doctorId:  context.userId,
      note:      body.note,
      timestamp: new Date().toISOString(),
    };
    return { ...cached, progressNotes: [...existingNotes, newNote] };
  }

  const { vitals, ...rest } = body;
  const merged: Record<string, unknown> = { ...cached, ...rest };
  if (vitals !== undefined && typeof vitals === 'object' && vitals !== null) {
    const existingVitals = typeof cached.vitals === 'object' && cached.vitals !== null ? cached.vitals : {};
    merged.vitals = { ...existingVitals, ...vitals };
  }
  return merged;
}

// ─── CREATE ─────────────────────────────────────────────────────────────────
// A CREATE has no pre-existing cached entity to patch (unlike every UPDATE/
// APPEND policy above, which requires one) and no subject id in its URL —
// the id doesn't exist yet. This table is deliberately separate from
// OFFLINE_MUTATION_POLICIES rather than merged into it, so the existing,
// already-proven UPDATE/APPEND path above stays completely unchanged.

interface CreateMutationPolicy {
  entityType: OutboxEntityType;
  // Static POST route for this entity's create endpoint.
  endpoint:   string;
  // Field name (in both the request body and the server's response) that
  // carries the entity's id — this is what the minted temp id stands in for
  // until sync resolves it to the real, server-assigned id.
  idField:    string;
  // If present, this body field may itself hold another (not-yet-synced)
  // entity's temp id — e.g. OPD_VISIT/IPD_ADMISSION's `patientId`. When it
  // does, the queued entry records a dependency so sync waits for the
  // referenced CREATE to resolve first, then rewrites this field to the
  // real id (see processor.ts's resolveTempIdRefs usage).
  dependsOnBodyField?: string;
}

const OFFLINE_CREATE_POLICIES: Record<string, CreateMutationPolicy> = {
  createPatient: {
    entityType: 'PATIENT',
    endpoint:   '/api/patients',
    idField:    'patientId',
  },
  createOPDVisit: {
    entityType: 'OPD_VISIT',
    endpoint:   '/api/opd/visits',
    idField:    'visitId',
    dependsOnBodyField: 'patientId',
  },
  createAdmission: {
    entityType: 'IPD_ADMISSION',
    endpoint:   '/api/ipd/admissions',
    idField:    'admissionId',
    dependsOnBodyField: 'patientId',
  },
  // The New OPD Visit form's mandatory Payment step runs createOPDVisit then
  // createManualPayment as one logical submission (see opd/page.tsx) — when
  // the visit above was itself just queued offline, its `referenceId` here
  // is that visit's tempId, so this depends on it the same way createOPDVisit
  // depends on an offline-created patient. When referenceId is already a
  // real (synced) id — e.g. an online visit whose payment step alone went
  // offline — dependsOn/tempIdRefs simply end up empty and this syncs on its
  // own. (IPD's identical "admission then manual payment" submission reuses
  // this same endpoint/policy, so it becomes offline-eligible too.)
  createManualPayment: {
    entityType: 'MANUAL_PAYMENT',
    endpoint:   '/api/payments/manual',
    idField:    'paymentId',
    dependsOnBodyField: 'referenceId',
  },
  // Inventory/Wards/Packages/Charges — self-contained creates with no
  // temp-id-eligible dependency of their own (Charge's patientId is the one
  // exception, handled the same way OPD_VISIT/IPD_ADMISSION already are).
  // Ward's own child resource (adding beds to a specific ward) doesn't fit
  // this table: its endpoint embeds the target wardId in the URL rather than
  // the body, and a single "Add Beds" submission can create many bed records
  // at once (see ipd.api.ts's addBeds, which POSTs an array of bed numbers
  // and returns BedResponse[]) — see planOfflineAddBed further below instead,
  // which queues one bed at a time to stay within this same one-CREATE-
  // produces-one-entity-with-one-id model without changing it.
  createInventoryItem: {
    entityType: 'INVENTORY_ITEM',
    endpoint:   '/api/inventory',
    idField:    'itemId',
  },
  createWard: {
    entityType: 'WARD',
    endpoint:   '/api/ipd/wards',
    idField:    'wardId',
  },
  createPackage: {
    entityType: 'PACKAGE',
    endpoint:   '/api/packages',
    idField:    'packageId',
  },
  addCharge: {
    entityType: 'CHARGE',
    endpoint:   '/api/charges',
    idField:    'chargeId',
    dependsOnBodyField: 'patientId',
  },
};

// The real OPD queueNumber is a server-computed, per-day sequential count —
// never guessable offline (two offline clients would collide, and nothing
// server-side even enforces uniqueness on it). This sentinel marks "not yet
// known" everywhere a queue number would otherwise appear; the UI must
// render it as "Pending" rather than a real number (see opd/page.tsx).
export const PENDING_QUEUE_NUMBER = -1;

export const EMPTY_VITALS = {
  weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null,
};

export interface OfflineCreatePlan {
  entityType:  OutboxEntityType;
  idField:     string;
  url:         string;
  method:      'POST';
  body:        Record<string, unknown>;
  tempId:      string;
  dependsOn:   string[];
  tempIdRefs:  TempIdRef[];
}

/**
 * Returns how to queue this CREATE offline, or null if the endpoint isn't on
 * the CREATE allowlist. Unlike planOfflineMutation, this never needs a
 * cached entity — a CREATE has nothing to patch onto. If the dependency
 * field (e.g. patientId) already holds an unsynced temp id, the plan records
 * it as a dependency: the entry's tempId (which doubles as its clientOpId —
 * see outbox.ts's enqueue) is exactly the string a dependent CREATE would
 * need to reference, so no separate id-to-entry lookup is required.
 */
export function planOfflineCreate(
  endpointName: string,
  args: { url: string; method?: string; body?: unknown },
): OfflineCreatePlan | null {
  const policy = OFFLINE_CREATE_POLICIES[endpointName];
  if (!policy) return null;
  if ((args.method ?? 'POST') !== 'POST') return null;
  if (args.url !== policy.endpoint) return null;

  const body = (args.body && typeof args.body === 'object' ? args.body : {}) as Record<string, unknown>;
  const tempId = `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;

  const dependsOn: string[] = [];
  const tempIdRefs: TempIdRef[] = [];
  if (policy.dependsOnBodyField) {
    const refValue = body[policy.dependsOnBodyField];
    if (typeof refValue === 'string' && isTempId(refValue)) {
      dependsOn.push(refValue);
      tempIdRefs.push({ path: policy.dependsOnBodyField, tempId: refValue });
    }
  }

  return {
    entityType: policy.entityType,
    idField:    policy.idField,
    url:        policy.endpoint,
    method:     'POST',
    body,
    tempId,
    dependsOn,
    tempIdRefs,
  };
}

// addBeds's URL embeds the target ward's id (POST /api/ipd/wards/:wardId/beds)
// rather than carrying it in the body, and its body is `{ bedNumbers: string[] }`
// — one submission can create many beds at once. Neither shape fits
// OFFLINE_CREATE_POLICIES's model (a static endpoint, one body, one resulting
// id), so this is a small bespoke planner instead of a table entry. Offline
// queuing is restricted to exactly one bed number so the single queued CREATE
// still produces exactly one id, matching every other entity type's contract
// with processor.ts (handleCreateSynced reads one id off the response and
// deletes one cache row keyed by the entry's own tempId) — submitting several
// bed numbers at once still works, but only while online. wardId must already
// be a real (synced) id: there is no mechanism (unlike a body field's
// tempIdRefs) to rewrite a temp id embedded in an outbox entry's URL once its
// dependency resolves, so a ward that is itself still offline-only can't have
// its beds queued yet — same limitation planOfflineMutation already accepts
// for any subject id (see isTempId checks throughout this file).
const ADD_BEDS_URL_PATTERN = /^\/api\/ipd\/wards\/([^/]+)\/beds$/;

export function planOfflineAddBed(
  endpointName: string,
  args: { url: string; method?: string; body?: unknown },
): OfflineCreatePlan | null {
  if (endpointName !== 'addBeds') return null;
  if ((args.method ?? 'POST') !== 'POST') return null;

  const match = ADD_BEDS_URL_PATTERN.exec(args.url);
  if (!match) return null;
  const wardId = match[1];
  if (isTempId(wardId)) return null;

  const body = (args.body && typeof args.body === 'object' ? args.body : {}) as Record<string, unknown>;
  const bedNumbers = Array.isArray(body.bedNumbers) ? body.bedNumbers : [];
  if (bedNumbers.length !== 1 || typeof bedNumbers[0] !== 'string' || !bedNumbers[0].trim()) return null;

  return {
    entityType: 'BED',
    idField:    'bedId',
    url:        args.url,
    method:     'POST',
    body:       { wardId, bedNumbers },
    tempId:     `${TEMP_ID_PREFIX}${crypto.randomUUID()}`,
    dependsOn:  [],
    tempIdRefs: [],
  };
}

/**
 * Builds the bare optimistic record to show immediately for a queued CREATE,
 * from the submitted body plus the minted temp id. Denormalized display
 * fields this module has no way to know (a ward's name, a bed's number, a
 * referenced patient's fullName) are left as safe placeholders — base.api.ts
 * fills them in, best-effort, from whatever's already in the RTK Query
 * cache, since only it has access to Redux state.
 */
export function buildCreateOptimisticRecord(
  entityType: OutboxEntityType,
  tempId:     string,
  body:       Record<string, unknown>,
  tenantId:   string,
  // Optional so existing call sites/tests that never touch CHARGE (the only
  // entity type that needs it, for `addedBy`) keep working unchanged.
  userId?:    string,
): Record<string, unknown> {
  const now = new Date().toISOString();

  if (entityType === 'PATIENT') {
    return {
      ...body,
      patientId:    tempId,
      tenantId,
      departmentId: body.departmentId ?? null,
      registrationFee: body.registrationFee ?? null,
      registrationPaymentMethod: body.registrationPaymentMethod ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (entityType === 'OPD_VISIT') {
    return {
      visitId:      tempId,
      tenantId,
      patientId:    body.patientId,
      fullName:     null,
      doctorIds:    body.doctorIds ?? [],
      nurseIds:     body.nurseIds ?? [],
      departmentId: null, // resolved server-side at sync — never guessed client-side
      visitDate:    body.visitDate ?? now.slice(0, 10),
      queueNumber:  PENDING_QUEUE_NUMBER,
      status:       'OPEN',
      diagnosis:    null,
      prescription: null,
      notes:        body.notes ?? null,
      vitals:       EMPTY_VITALS,
      createdAt:    now,
      updatedAt:    now,
    };
  }

  if (entityType === 'IPD_ADMISSION') {
    return {
      admissionId:       tempId,
      patientId:         body.patientId,
      fullName:          null,
      wardId:            body.wardId,
      wardName:          '',
      bedId:             body.bedId,
      bedNumber:         '',
      assignedDoctorIds: body.assignedDoctorIds ?? [],
      departmentId:      null, // resolved server-side at sync — never guessed client-side
      status:            'ADMITTED',
      admissionDate:     now,
      dischargeDate:     null,
      progressNotes:     [],
      vitals:            EMPTY_VITALS,
    };
  }

  if (entityType === 'INVENTORY_ITEM') {
    const quantity  = typeof body.quantity === 'number' ? body.quantity : 0;
    const threshold = typeof body.lowStockThreshold === 'number' ? body.lowStockThreshold : 0;
    return {
      itemId:            tempId,
      tenantId,
      name:              body.name,
      category:          body.category,
      unit:              body.unit,
      quantity,
      lowStockThreshold: threshold,
      description:       body.description ?? null,
      // Mirrors inventory.service.ts's createItem exactly: strictly-less-than,
      // and only ever true when a real (positive) threshold was set.
      isLowStock:        threshold > 0 && quantity < threshold,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (entityType === 'WARD') {
    return {
      wardId:           tempId,
      name:             body.name,
      floor:            body.floor ?? null,
      assignedNurseIds: [],
      tenantId,
      createdAt: now,
    };
  }

  if (entityType === 'BED') {
    const bedNumbers = Array.isArray(body.bedNumbers) ? body.bedNumbers : [];
    return {
      bedId:              tempId,
      wardId:             body.wardId,
      bedNumber:          typeof bedNumbers[0] === 'string' ? bedNumbers[0] : '',
      isOccupied:         false,
      currentAdmissionId: null,
      tenantId,
      createdAt: now,
    };
  }

  if (entityType === 'PACKAGE') {
    return {
      packageId:        tempId,
      tenantId,
      name:             body.name,
      description:      body.description ?? null,
      price:            body.price,
      includedServices: body.includedServices ?? [],
      // packages.service.ts's createPackage always creates ACTIVE.
      status:           'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
  }

  if (entityType === 'CHARGE') {
    const isLabTest = body.category === 'LAB_TEST';
    const amount = typeof body.amount === 'number' ? Math.round(body.amount * 100) / 100 : body.amount;
    return {
      chargeId:           tempId,
      tenantId,
      patientId:          body.patientId,
      category:           body.category,
      description:        body.description,
      amount,
      encounterReference: body.encounterReference ?? null,
      testTypeId:         isLabTest ? (body.testTypeId   ?? null) : null,
      testTypeName:       isLabTest ? (body.testTypeName ?? null) : null,
      addedBy:            userId ?? null,
      // Denormalized display name — base.api.ts fills this in from the
      // current user's own cached profile (see tryQueueOfflineCreate).
      addedByName:        null,
      // charges.service.ts's addCharge always creates UNPAID.
      status:             'UNPAID',
      paidBy:      null, paidAt:      null,
      cancelledBy: null, cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (entityType === 'MANUAL_PAYMENT') {
    return {
      paymentId:         tempId,
      tenantId,
      patientId:         body.patientId,
      fullName:          null,
      amount:            body.amount,
      paymentMethod:     body.paymentMethod,
      description:       body.description,
      // A manual payment is recorded as already paid — never PENDING, unlike
      // a Razorpay order (which stays online-only; see the top-of-file
      // comment) — so COMPLETED is the correct optimistic status, matching
      // what the online create would return.
      status:            'COMPLETED',
      receiptUrl:        null,
      razorpayOrderId:   null,
      razorpayPaymentId: null,
      referenceType:     body.referenceType ?? null,
      referenceId:       body.referenceId   ?? null,
      transactionId:     body.transactionId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  return { ...body, id: tempId };
}
