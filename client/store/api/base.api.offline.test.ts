/**
 * @jest-environment node
 *
 * Integration test for the offline-queueing branch added to
 * baseQueryWithToasts (base.api.ts). Exercises real RTK Query endpoints
 * (patientApi, opdApi) against a real Redux store, with `fetch` mocked to
 * simulate both normal responses and transport-level (offline) failures —
 * see client/lib/offline/{crypto,db}.test.ts for why this needs the "node"
 * environment rather than jsdom (WebCrypto + IndexedDB's structuredClone).
 */
import 'fake-indexeddb/auto';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { tokenReceived, profileLoaded } from '../slices/auth.slice';
import { baseApi } from './base.api';
import { patientApi } from './patient.api';
import { opdApi } from './opd.api';
import { ipdApi } from './ipd.api';
import { paymentApi } from './payment.api';
import { dashboardApi } from './dashboard.api';
import { attendanceApi } from './attendance.api';
import { openOfflineDb } from '@/lib/offline/db';
import { toastSuccess, toastError } from '@/lib/toast';

jest.mock('@/lib/toast', () => ({
  toastSuccess: jest.fn(),
  toastError:   jest.fn(),
}));

function makeToken(tenantId: string, userId: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify({ userId, tenantId, role: 'DOCTOR', email: 'd@h.com', isFirstLogin: false }));
  return `${header}.${body}.sig`;
}

function buildStore(tenantId: string, userId: string) {
  const store = configureStore({
    reducer: { auth: authReducer, [baseApi.reducerPath]: baseApi.reducer },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
  store.dispatch(tokenReceived(makeToken(tenantId, userId)));
  store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));
  return store;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// The read-through cache write (base.api.ts's cacheEligibleQueryResult) is
// deliberately fire-and-forget — it must never delay the response already
// handed back to the UI. Tests that rely on a prior GET's write having
// landed in IndexedDB before the next dispatch need to flush past it first.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe('base.api offline integration', () => {
  let fetchMock: jest.Mock;
  let errorSpy: jest.SpyInstance;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // A successful offline-queued mutation still fires its endpoint's normal
    // invalidatesTags, which can trigger a background refetch of an
    // already-subscribed query — expected RTK Query behavior, harmless here
    // since fetchMock has nothing queued for it; just silence the noise.
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    global.fetch = originalFetch;
  });

  test('online success path is unaffected — normal success toast, nothing queued', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'New Name' } }),
    );

    const result = await store.dispatch(
      patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-1', fullName: 'New Name' }),
    );

    expect('data' in result).toBe(true);
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline + eligible + previously cached — queues the mutation and returns an optimistic success', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    // A prior successful GET is the realistic precondition for editing a
    // record's detail view — it populates the cache this lookup relies on.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'Old Name', mobileNumber: '111' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await store.dispatch(
      patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-1', fullName: 'New Name' }),
    );

    expect('error' in result).toBe(false);
    expect((result as unknown as { data: Record<string, unknown> }).data).toMatchObject({
      fullName: 'New Name', patientId: 'PAT-1', mobileNumber: '111',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Saved offline', expect.any(String));
    expect(toastError).not.toHaveBeenCalled();

    const db = await openOfflineDb(tenantId, userId);
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entityType: 'PATIENT', operation: 'UPDATE', endpoint: '/api/patients/PAT-1', method: 'PATCH', status: 'PENDING',
    });
  });

  test('offline + eligible but never fetched before — falls back to a normal error (nothing safe to patch onto)', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await store.dispatch(
      patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-999', fullName: 'New Name' }),
    );

    expect('error' in result).toBe(true);
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline + endpoint not on any allowlist (createRazorpayOrder) — falls back to a normal error, nothing queued', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await store.dispatch(
      paymentApi.endpoints.createRazorpayOrder.initiate({ patientId: 'PAT-1', amount: 100, paymentMethod: 'UPI', description: 'x' } as never),
    );

    expect('error' in result).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline + createPatient (CREATE) — queues with a temp id and an optimistic pendingSync patient shown immediately', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await store.dispatch(
      patientApi.endpoints.createPatient.initiate({
        fullName: 'New Patient', dateOfBirth: '1990-01-01', gender: 'MALE',
        mobileNumber: '9999999999', address: 'Addr',
      } as never),
    );

    expect('error' in result).toBe(false);
    const data = (result as unknown as { data: Record<string, unknown> }).data;
    expect(data.fullName).toBe('New Patient');
    expect(typeof data.patientId).toBe('string');
    expect((data.patientId as string).startsWith('temp-')).toBe(true);
    expect(toastSuccess).toHaveBeenCalledWith('Saved offline', expect.any(String));

    const db = await openOfflineDb(tenantId, userId);
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entityType: 'PATIENT', operation: 'CREATE', endpoint: '/api/patients', method: 'POST', status: 'PENDING',
    });
    expect(outbox[0].clientOpId).toBe(data.patientId);

    // Persisted into the read-through cache too, pendingSync, so it survives
    // a refresh while still offline.
    const cached = await db.get('cache_patients', data.patientId as string);
    expect(cached?.pendingSync).toBe(true);
  });

  test('offline + createOPDVisit (CREATE) for an offline-created (temp-id) patient records the dependency', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    // 1. Create the patient offline first.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const patientResult = await store.dispatch(
      patientApi.endpoints.createPatient.initiate({
        fullName: 'Offline Patient', dateOfBirth: '1990-01-01', gender: 'MALE',
        mobileNumber: '9999999998', address: 'Addr',
      } as never),
    );
    const patientTempId = (patientResult as unknown as { data: Record<string, unknown> }).data.patientId as string;

    // 2. Create an OPD visit for that same (still-unsynced) patient.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const visitResult = await store.dispatch(
      opdApi.endpoints.createOPDVisit.initiate({ patientId: patientTempId } as never),
    );

    expect('error' in visitResult).toBe(false);
    const visitData = (visitResult as unknown as { data: Record<string, unknown> }).data;
    expect(visitData.patientId).toBe(patientTempId);
    expect(visitData.queueNumber).toBe(-1); // PENDING_QUEUE_NUMBER — never guessed offline

    const db = await openOfflineDb(tenantId, userId);
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(2);
    const visitEntry = outbox.find((e) => e.entityType === 'OPD_VISIT')!;
    expect(visitEntry.dependsOn).toEqual([patientTempId]);
    expect(visitEntry.tempIdRefs).toEqual([{ path: 'patientId', tempId: patientTempId }]);
  });

  test('offline + Paid OPD visit create: createManualPayment for that same offline-created visit records the dependency', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    // 1. Create the OPD visit offline (patient already synced — only the
    // visit, then its mandatory payment, are created while offline here).
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const visitResult = await store.dispatch(
      opdApi.endpoints.createOPDVisit.initiate({ patientId: 'PAT-1' } as never),
    );
    const visitData = (visitResult as unknown as { data: Record<string, unknown> }).data;
    const visitTempId = visitData.visitId as string;
    expect(visitTempId.startsWith('temp-')).toBe(true);

    // 2. Record the mandatory payment for that same still-unsynced visit —
    // mirrors NewVisitModal's submit sequence in opd/page.tsx.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const paymentResult = await store.dispatch(
      paymentApi.endpoints.createManualPayment.initiate({
        patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH',
        description: 'OPD Consultation', referenceType: 'OPD_VISIT', referenceId: visitTempId,
      } as never),
    );

    expect('error' in paymentResult).toBe(false);
    const paymentData = (paymentResult as unknown as { data: Record<string, unknown> }).data;
    expect((paymentData.paymentId as string).startsWith('temp-')).toBe(true);
    expect(paymentData.referenceId).toBe(visitTempId);
    expect(paymentData.status).toBe('COMPLETED');
    expect(toastSuccess).toHaveBeenCalledWith('Saved offline', expect.any(String));

    const db = await openOfflineDb(tenantId, userId);
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(2);
    const paymentEntry = outbox.find((e) => e.entityType === 'MANUAL_PAYMENT')!;
    expect(paymentEntry.dependsOn).toEqual([visitTempId]);
    expect(paymentEntry.tempIdRefs).toEqual([{ path: 'referenceId', tempId: visitTempId }]);
    expect(paymentEntry.endpoint).toBe('/api/payments/manual');
    // Distinct idempotency keys — each CREATE's own clientOpId doubles as its
    // sync-time Idempotency-Key (see processor.ts), so a retry of one entry
    // can never be mistaken for (or dedup against) the other's.
    const visitEntry = outbox.find((e) => e.entityType === 'OPD_VISIT')!;
    expect(paymentEntry.clientOpId).not.toBe(visitEntry.clientOpId);
  });

  test('offline + createAdmission (CREATE) for an already-synced (real-id) patient queues with no dependency', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(
      ipdApi.endpoints.createAdmission.initiate({ patientId: 'PAT-1', wardId: 'W-1', bedId: 'B-1' } as never),
    );

    expect('error' in result).toBe(false);
    const data = (result as unknown as { data: Record<string, unknown> }).data;
    expect(data.status).toBe('ADMITTED');
    expect((data.admissionId as string).startsWith('temp-')).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ entityType: 'IPD_ADMISSION', operation: 'CREATE', dependsOn: [] });
  });

  test('offline + a field outside the safe subset (doctorIds) — falls back to a normal error', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'success', data: { visitId: 'OPD-1', diagnosis: 'x' } }));
    await store.dispatch(opdApi.endpoints.getOPDVisitById.initiate('OPD-1'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(
      opdApi.endpoints.updateOPDVisit.initiate({ visitId: 'OPD-1', doctorIds: ['doc-1'] }),
    );

    expect('error' in result).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('when navigator.onLine is false, the mutation is queued without ever attempting the network', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-2', fullName: 'Cached', mobileNumber: '222' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-2'));
    fetchMock.mockClear();

    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

    try {
      const result = await store.dispatch(
        patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-2', fullName: 'Updated' }),
      );
      expect('error' in result).toBe(false);

      // The mutation itself must never have reached the network — it's
      // queued straight from the fast path. A background refetch of the
      // still-subscribed getPatientById query (triggered by updatePatient's
      // own invalidatesTags: ['Patient'], exactly as it would after a real
      // online save) may still fire and fail harmlessly; that's a separate,
      // already-accepted side effect, not what this test is checking.
      const patchCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patchCalls).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });
});

describe('base.api offline GET fallback / read-through cache', () => {
  let fetchMock: jest.Mock;
  let errorSpy: jest.SpyInstance;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    global.fetch = originalFetch;
  });

  test('a successful eligible GET persists into the IndexedDB read-through cache', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'Jane', aadhaarNumber: '123456789012' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));
    await flush();

    const db = await openOfflineDb(tenantId, userId);
    const record = await db.get('cache_patients', 'PAT-1');
    expect(record).toBeDefined();
    expect(record?.plaintextFields).toMatchObject({ patientId: 'PAT-1', fullName: 'Jane' });
    expect(record?.encryptedFieldsCiphertext).not.toBeNull();
  });

  test('offline (FETCH_ERROR) with a prior cache hit serves cached data instead of erroring', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'Jane' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));
    await flush();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(
      patientApi.endpoints.getPatientById.initiate('PAT-1', { forceRefetch: true }),
    );

    expect('error' in result).toBe(false);
    expect((result as unknown as { data: Record<string, unknown> }).data).toMatchObject({ patientId: 'PAT-1', fullName: 'Jane' });
  });

  test('offline (FETCH_ERROR) with no prior cache preserves the existing error behavior', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-999'));

    expect('error' in result).toBe(true);
    expect((result as unknown as { error: { status: string } }).error.status).toBe('FETCH_ERROR');
  });

  test('a reachable backend 503 is NOT treated as offline — no cache fallback, normal error surfaces', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    // Prime the cache so a fallback WOULD be available if (incorrectly) attempted.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'Cached Jane' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));
    await flush();

    // Backend reachable, but returns 503 (e.g. MongoDB down) — a real HTTP response, not a transport failure.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'error', message: 'Database temporarily unavailable' }, 503),
    );
    const result = await store.dispatch(
      patientApi.endpoints.getPatientById.initiate('PAT-1', { forceRefetch: true }),
    );

    // Queries never toast (unchanged pre-existing behavior — toasts are
    // mutation-only) — what matters here is that the 503 was NOT treated as
    // an offline signal: the cache entry primed above must be ignored and
    // the real error status must surface untouched.
    expect('error' in result).toBe(true);
    expect((result as unknown as { error: { status: number; data: unknown } }).error.status).toBe(503);
  });

  test('array-shaped list fallback (getOPDQueue) serves the previously cached queue while offline', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: [{ visitId: 'OPD-1', diagnosis: 'flu' }] }),
    );
    await store.dispatch(opdApi.endpoints.getOPDQueue.initiate({}));
    await flush();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(opdApi.endpoints.getOPDQueue.initiate({}, { forceRefetch: true }));

    expect('error' in result).toBe(false);
    expect((result as unknown as { data: unknown[] }).data).toEqual([
      expect.objectContaining({ visitId: 'OPD-1', diagnosis: 'flu' }),
    ]);
  });

  test(
    'end-to-end regression: patient list loaded online, then edited from that list while offline ' +
    '(no separate detail-page fetch — the originally reported bug)',
    async () => {
      const tenantId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const store = buildStore(tenantId, userId);

      // 1. ONLINE — the patient list loads (the modal reads the row straight
      //    from this cached list, exactly like patients/page.tsx does; no
      //    getPatientById call ever happens in this flow).
      fetchMock.mockResolvedValueOnce(jsonResponse({
        status: 'success',
        data: { data: [{ patientId: 'PAT-1', fullName: 'Jane', mobileNumber: '111' }], total: 1, page: 1, limit: 20 },
      }));
      await store.dispatch(patientApi.endpoints.searchPatients.initiate({}));

      // 2. OFFLINE — user edits that same patient from the list.
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await store.dispatch(
        patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-1', fullName: 'Jane Edited Offline' }),
      );

      expect('error' in result).toBe(false);
      expect((result as unknown as { data: Record<string, unknown> }).data).toMatchObject({
        patientId: 'PAT-1', fullName: 'Jane Edited Offline', mobileNumber: '111',
      });

      const db = await openOfflineDb(tenantId, userId);
      const outbox = await db.getAll('outbox');
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({ entityType: 'PATIENT', operation: 'UPDATE', status: 'PENDING' });
    },
  );

  test('singleton fallback (getDashboardStats) serves the previously cached stats while offline', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { lastUpdated: '2026-09-22T00:00:00.000Z', totalPatients: 42 } }),
    );
    await store.dispatch(dashboardApi.endpoints.getDashboardStats.initiate());
    await flush();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(
      dashboardApi.endpoints.getDashboardStats.initiate(undefined, { forceRefetch: true }),
    );

    expect('error' in result).toBe(false);
    expect((result as unknown as { data: Record<string, unknown> }).data).toMatchObject({ totalPatients: 42 });
  });

  test('wrapped list fallback (listPayments) serves the previously cached page while offline', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'success',
      data: { data: [{ paymentId: 'PAY-1', amount: 500, status: 'COMPLETED', description: 'OPD Consultation' }], total: 1, page: 1, limit: 20 },
    }));
    await store.dispatch(paymentApi.endpoints.listPayments.initiate({}));
    await flush();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await store.dispatch(paymentApi.endpoints.listPayments.initiate({}, { forceRefetch: true }));

    expect('error' in result).toBe(false);
    expect((result as unknown as { data: { data: unknown[] } }).data.data).toEqual([
      expect.objectContaining({ paymentId: 'PAY-1', amount: 500, description: 'OPD Consultation' }),
    ]);
  });

  test('keyed singleton fallback (getMyAttendance) — two different months stay distinct offline, neither overwrites the other', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const store = buildStore(tenantId, userId);

    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'success', data: { summary: { totalWorkingDays: 20, daysWorked: 18, presentDays: 18, totalWorkingHours: 144 }, records: [{ attendanceDate: '2026-03-01' }] },
    }));
    await store.dispatch(attendanceApi.endpoints.getMyAttendance.initiate({ month: 3, year: 2026 }));
    await flush();

    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'success', data: { summary: { totalWorkingDays: 22, daysWorked: 20, presentDays: 20, totalWorkingHours: 160 }, records: [{ attendanceDate: '2026-04-01' }] },
    }));
    await store.dispatch(attendanceApi.endpoints.getMyAttendance.initiate({ month: 4, year: 2026 }));
    await flush();

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const marchOffline = await store.dispatch(
      attendanceApi.endpoints.getMyAttendance.initiate({ month: 3, year: 2026 }, { forceRefetch: true }),
    );
    expect('error' in marchOffline).toBe(false);
    expect((marchOffline as unknown as { data: { records: unknown[] } }).data.records).toEqual([{ attendanceDate: '2026-03-01' }]);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const aprilOffline = await store.dispatch(
      attendanceApi.endpoints.getMyAttendance.initiate({ month: 4, year: 2026 }, { forceRefetch: true }),
    );
    expect('error' in aprilOffline).toBe(false);
    expect((aprilOffline as unknown as { data: { records: unknown[] } }).data.records).toEqual([{ attendanceDate: '2026-04-01' }]);
  });
});
