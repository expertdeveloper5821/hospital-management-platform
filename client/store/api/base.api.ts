import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type { RootState } from '../index';
import { toastError, toastSuccess } from '@/lib/toast';
import { planOfflineMutation, applyOptimisticPatch, planOfflineCreate, planOfflineAddBed, buildCreateOptimisticRecord } from '@/lib/offline/mutation-policy';
import { findCachedEntityById } from '@/lib/offline/cache-lookup';
import { getSessionFromToken, type OfflineSession } from '@/lib/offline/session';
import { getOrCreateClientKey, encryptClientField } from '@/lib/offline/crypto';
import { openOfflineDb } from '@/lib/offline/db';
import { enqueue } from '@/lib/offline/outbox';
import {
  QUERY_CACHE_POLICIES,
  cacheQueryResult,
  readCachedQueryResult,
  isSingletonCacheEndpoint,
  cacheSingletonQueryResult,
  readCachedSingletonQueryResult,
  wrapForCacheWrite,
} from '@/lib/offline/query-cache';
import type { OutboxEntityType } from '@/lib/offline/types';

type BackendSuccess = {
  status?: string;
  data?: unknown;
  message?: string;
};

type BackendError = {
  message?: string;
  error?: string;
};

const endpointSuccessMessages: Record<string, string> = {
  login: 'Signed in successfully.',
  superAdminLogin: 'Signed in successfully.',
  changePassword: 'Password updated successfully.',
  forgotPassword: 'Password reset link sent.',
  resetPassword: 'Password reset successfully.',
  completeSetup: 'Setup completed successfully.',
  logout: 'Signed out successfully.',
  checkIn: 'Checked in successfully.',
  checkOut: 'Checked out successfully.',
};

const quietSuccessEndpoints = new Set([
  'createRazorpayOrder',
  'markNotificationRead',
  'markAllNotificationsRead',
  // New OPD Visit runs createOPDVisit then createManualPayment as one logical submission —
  // silence the intermediate visit-created toast so the user isn't shown a success toast
  // followed by a failure toast for what they perceive as a single action.
  'createOPDVisit',
  // These screens show their own, more specific success toast — avoid a duplicate.
  'changeMyPassword',
  'changeSuperAdminPassword',
  'updateMyProfile',
  'createAdmission',
  'uploadProfileImage',
]);

// Endpoints whose errors are handled locally / are expected, so the global toast
// must not fire (e.g. logout after a password change hits an already-invalid token).
const quietErrorEndpoints = new Set([
  'logout',
]);

function extractErrorMessage(error: FetchBaseQueryError) {
  const data = error.data as BackendError | string | undefined;
  if (typeof data === 'string') return data;
  return data?.message ?? data?.error ?? 'Something went wrong. Please try again.';
}

function getSuccessMessage(endpoint: string, data: BackendSuccess) {
  if (endpointSuccessMessages[endpoint]) return endpointSuccessMessages[endpoint];

  const messageFromBody =
    data.message ??
    (typeof data.data === 'object' && data.data !== null && 'message' in data.data
      ? String((data.data as { message?: unknown }).message)
      : undefined);

  return messageFromBody || 'Saved successfully.';
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001',
  prepareHeaders(headers, { getState }) {
    const token = (getState() as RootState).auth.token;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

// Which cacheable GET endpoint's cache store a CREATE entity's optimistic
// row should be persisted into — reuses the exact same read-through cache
// (and thus the exact same pendingSync/ordering treatment) the matching GET
// already writes to.
const CREATE_CACHE_ENDPOINT: Partial<Record<OutboxEntityType, string>> = {
  PATIENT:        'getPatientById',
  OPD_VISIT:      'getOPDVisitById',
  IPD_ADMISSION:  'getAdmissionById',
  MANUAL_PAYMENT: 'listPayments',
  INVENTORY_ITEM: 'listInventoryItems',
  WARD:           'listWards',
  BED:            'listBeds',
  PACKAGE:        'listPackages',
  CHARGE:         'listCharges',
};

/**
 * Queues an offline-eligible CREATE into the outbox, returning the
 * optimistic response body to show immediately, or null if this endpoint
 * isn't on the CREATE allowlist. Unlike an UPDATE/APPEND, a CREATE never
 * requires a pre-existing cached entity — there's nothing to patch onto —
 * so this is a separate path from tryQueueOffline's UPDATE/APPEND logic
 * below, not a variant of it.
 */
async function tryQueueOfflineCreate(
  endpointName: string,
  args: FetchArgs,
  state: RootState,
  session: OfflineSession,
): Promise<BackendSuccess | null> {
  const plan = planOfflineCreate(endpointName, args) ?? planOfflineAddBed(endpointName, args);
  if (!plan) return null;

  const optimisticData = buildCreateOptimisticRecord(plan.entityType, plan.tempId, plan.body, session.tenantId, session.userId);

  // Best-effort enrichment of denormalized display fields mutation-policy.ts
  // has no way to know (it's a pure module, no Redux state access) — filled
  // in here from whatever's already sitting in the RTK Query cache, exactly
  // like an online create would eventually show once its own GETs land.
  if (plan.entityType === 'OPD_VISIT' || plan.entityType === 'IPD_ADMISSION' || plan.entityType === 'MANUAL_PAYMENT') {
    const patient = findCachedEntityById(state, 'patientId', String(plan.body.patientId ?? ''));
    if (patient && typeof patient.fullName === 'string') optimisticData.fullName = patient.fullName;
  }
  if (plan.entityType === 'IPD_ADMISSION') {
    const ward = findCachedEntityById(state, 'wardId', String(plan.body.wardId ?? ''));
    if (ward && typeof ward.name === 'string') optimisticData.wardName = ward.name;
    const bed = findCachedEntityById(state, 'bedId', String(plan.body.bedId ?? ''));
    if (bed && typeof bed.bedNumber === 'string') optimisticData.bedNumber = bed.bedNumber;
  }
  if (plan.entityType === 'CHARGE') {
    // MyProfileResponse (getMyProfile) carries a `name`; MeResponse (the
    // Redux-persisted profile) doesn't, so the cache lookup is tried first
    // and the always-available email is the fallback — same "name || email"
    // pattern already used elsewhere in this codebase (e.g. Sidebar.tsx).
    const me = findCachedEntityById(state, 'userId', session.userId);
    const displayName = (me && typeof me.name === 'string' && me.name) || state.auth.profile?.email || null;
    if (displayName) optimisticData.addedByName = displayName;
  }

  try {
    const key = await getOrCreateClientKey(session.tenantId, session.userId);
    const payloadCiphertext = await encryptClientField(JSON.stringify(plan.body), key);
    const db = await openOfflineDb(session.tenantId, session.userId);
    await enqueue(db, {
      tenantId:   session.tenantId,
      userId:     session.userId,
      entityType: plan.entityType,
      operation:  'CREATE',
      endpoint:   plan.url,
      method:     plan.method,
      payloadCiphertext,
      dependsOn:  plan.dependsOn,
      tempIdRefs: plan.tempIdRefs,
      // The entry's clientOpId (and thus its sync Idempotency-Key) IS the
      // minted temp id — so a dependent CREATE queued afterwards (e.g. an
      // OPD visit for this offline-created patient) can declare `dependsOn`
      // directly against `plan.tempId`, with no separate lookup needed.
      clientOpId: plan.tempId,
    });
  } catch (err) {
    console.error('Failed to queue offline create', err);
    return null;
  }

  const cacheEndpoint = CREATE_CACHE_ENDPOINT[plan.entityType];
  if (cacheEndpoint) {
    try {
      // wrapForCacheWrite shapes the bare optimisticData into whatever
      // cacheEndpoint's own responseShape expects (e.g. a wrapped
      // { data: [...] } for a list endpoint like listPayments/listWards) —
      // cacheQueryResult's extractEntities would otherwise find nothing to
      // write for anything but a 'single'-shape target.
      await cacheQueryResult(cacheEndpoint, wrapForCacheWrite(cacheEndpoint, optimisticData), session, { pendingSync: true });
    } catch (err) {
      console.error('Failed to persist offline optimistic create cache', err);
    }
  }

  // addBeds is the one CREATE endpoint whose real response `data` is always
  // an array (BedResponse[], even for a single bed — see ipd.controller.ts's
  // addBeds: `beds.map(toBedResponse)`) — the optimistic response must match
  // that shape or callers typed against BedResponse[] (e.g. a future .map())
  // would silently receive a bare object instead.
  const responseData = plan.entityType === 'BED' ? [optimisticData] : optimisticData;
  return { status: 'success', data: responseData };
}

/**
 * Queues an offline-eligible mutation into the outbox, returning the
 * optimistic response body to show immediately, or null if this mutation
 * isn't eligible (not on either allowlist, its subject is an unsynced temp
 * id, its body touches a field outside the safe subset, or — critically —
 * for an UPDATE/APPEND, the user never actually fetched this record before
 * going offline, so there's no safe cached state to patch onto and
 * optimistically display).
 */
async function tryQueueOffline(
  endpointName: string,
  args: FetchArgs,
  state: RootState,
): Promise<BackendSuccess | null> {
  const session = getSessionFromToken(state.auth.token);
  if (!session) return null;

  const created = await tryQueueOfflineCreate(endpointName, args, state, session);
  if (created) return created;

  const plan = planOfflineMutation(endpointName, args);
  if (!plan) return null;

  const cached = findCachedEntityById(state, plan.idFieldForCacheLookup, plan.subjectId);
  if (!cached) return null;

  try {
    const key = await getOrCreateClientKey(session.tenantId, session.userId);
    const payloadCiphertext = await encryptClientField(JSON.stringify(plan.body), key);
    const db = await openOfflineDb(session.tenantId, session.userId);
    await enqueue(db, {
      tenantId:   session.tenantId,
      userId:     session.userId,
      entityType: plan.entityType,
      operation:  plan.operation,
      endpoint:   plan.url,
      method:     plan.method,
      payloadCiphertext,
    });
  } catch (err) {
    console.error('Failed to queue offline mutation', err);
    return null;
  }

  const optimisticData = applyOptimisticPatch(plan.entityType, cached, plan.body, { userId: session.userId });

  // Persist the optimistic edit into the read-through cache (not just the
  // transient mutation response) so a page refresh while still offline still
  // sees it — and flag it pendingSync so the offline patient list can keep it
  // at the top. Patient-only: the only entity type this ordering requirement
  // applies to. The flag self-clears the next time a real GET recaches this
  // record (cacheQueryResult builds a fresh record object without it) — e.g.
  // once the outbox syncs and processor.ts invalidates the 'Patient' tag.
  if (plan.entityType === 'PATIENT') {
    try {
      await cacheQueryResult('getPatientById', optimisticData, session, { pendingSync: true });
    } catch (err) {
      console.error('Failed to persist offline optimistic patient cache', err);
    }
  }

  return {
    status: 'success',
    data:   optimisticData,
  };
}

// Many GET endpoints' `query()` returns a bare URL string rather than a
// { url, method, body } object (fetchBaseQuery accepts either) — e.g.
// patientApi's getPatientById: `query: (patientId) => \`/api/patients/${patientId}\``.
// Both forms need to resolve to the same URL for cache matching.
function resolveRequestUrl(args: string | FetchArgs): string {
  return typeof args === 'string' ? args : args.url;
}

/**
 * Reads the IndexedDB read-through cache for an eligible query that just
 * failed at the transport level, returning a response shaped exactly like a
 * live `{status:'success', data:...}` body — or null if this endpoint isn't
 * cacheable or nothing is cached, in which case the caller preserves the
 * original error untouched.
 */
async function tryServeFromCache(
  endpointName: string,
  args: string | FetchArgs,
  state: RootState,
): Promise<BackendSuccess | null> {
  const session = getSessionFromToken(state.auth.token);
  if (!session) return null;

  try {
    const url = resolveRequestUrl(args);
    const data = isSingletonCacheEndpoint(endpointName)
      ? await readCachedSingletonQueryResult(endpointName, session, url)
      : await readCachedQueryResult(endpointName, { url }, session);
    if (data === null) return null;
    return { status: 'success', data };
  } catch (err) {
    console.error('Failed to read offline cache', err);
    return null;
  }
}

/** Fire-and-forget: persists a successful eligible query's response into the read-through cache. */
function cacheEligibleQueryResult(endpointName: string, rawBody: unknown, state: RootState, url: string): void {
  const body = rawBody as BackendSuccess | undefined;
  if (body?.status !== 'success') return;

  const session = getSessionFromToken(state.auth.token);
  if (!session) return;

  const write = isSingletonCacheEndpoint(endpointName)
    ? cacheSingletonQueryResult(endpointName, body.data, session, url)
    : cacheQueryResult(endpointName, body.data, session);
  write.catch((err) => {
    console.error('Failed to persist offline cache', err);
  });
}

const baseQueryWithToasts: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  const isEligibleMutation = api.type === 'mutation' && typeof args !== 'string';
  const isCacheableQuery = api.type === 'query'
    && (!!QUERY_CACHE_POLICIES[api.endpoint] || isSingletonCacheEndpoint(api.endpoint));

  // Skip waiting on a network timeout when the browser already knows it has
  // no connection — synthesize the same transport-level failure fetchBaseQuery
  // would eventually report, so everything below (offline queueing / cache
  // fallback, then the existing error-toast fallback) behaves identically
  // either way.
  const knownOffline = (isEligibleMutation || isCacheableQuery)
    && typeof navigator !== 'undefined' && navigator.onLine === false;

  const result = knownOffline
    ? ({ error: { status: 'FETCH_ERROR', error: 'Offline' } as FetchBaseQueryError })
    : await rawBaseQuery(args, api, extraOptions);

  // Offline mutation queueing (Phase D, unchanged) — and the offline GET
  // fallback below — only ever trigger on a transport-level failure
  // (FETCH_ERROR: the request never reached a server). A reachable backend
  // responding with a normal HTTP error status — including a 500/503 from a
  // downstream outage such as MongoDB being unreachable — is deliberately
  // NOT treated as "offline": it's a real application error and must keep
  // surfacing the existing error toast, not silently queue or serve stale
  // cached data. (Local testing note: disabling Wi-Fi on a machine where the
  // backend itself stays reachable over loopback/LAN, but the backend's own
  // MongoDB connection requires the internet, reproduces exactly this
  // reachable-backend-503 case — it will NOT trigger offline handling here,
  // by design; that requires the client's own request to the backend origin
  // to fail outright.)
  if (isEligibleMutation && 'error' in result && result.error && result.error.status === 'FETCH_ERROR') {
    const queued = await tryQueueOffline(api.endpoint, args as FetchArgs, api.getState() as RootState);
    if (queued) {
      toastSuccess('Saved offline', "This will sync automatically once you're back online.");
      return { data: queued };
    }
  }

  if (isCacheableQuery && 'error' in result && result.error && result.error.status === 'FETCH_ERROR') {
    const cached = await tryServeFromCache(api.endpoint, args, api.getState() as RootState);
    if (cached) return { data: cached };
  }

  if (api.type !== 'mutation') {
    if (isCacheableQuery && 'data' in result && result.data) {
      cacheEligibleQueryResult(api.endpoint, result.data, api.getState() as RootState, resolveRequestUrl(args));
    }
    return result;
  }

  if ('error' in result && result.error) {
    if (!quietErrorEndpoints.has(api.endpoint)) {
      toastError('Request failed', extractErrorMessage(result.error));
    }
    return result;
  }

  const data = result.data as BackendSuccess | undefined;
  if (data?.status === 'success' && !quietSuccessEndpoints.has(api.endpoint)) {
    toastSuccess(getSuccessMessage(api.endpoint, data));
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithToasts,
  tagTypes: [
    'Auth',
    'Tenant',
    'User',
    'Patient',
    'OPD',
    'IPD',
    'Lab',
    'Inventory',
    'Payment',
    'Notification',
    'Audit',
    'Dashboard',
    'PlatformSettings',
    'Package',
    'PackageAssignment',
    'Charge',
    'Bill',
    'StaffDocument',
    'StaffIdCard',
    'Department',
    'Attendance',
  ],
  endpoints: () => ({}),
});
