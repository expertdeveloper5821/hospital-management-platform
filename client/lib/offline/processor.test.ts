/** @jest-environment node */
import 'fake-indexeddb/auto';

jest.mock('@/store', () => ({
  store: { getState: jest.fn(), dispatch: jest.fn() },
}));
jest.mock('@/store/api/base.api', () => ({
  baseApi: { util: { invalidateTags: jest.fn((tags: unknown) => ({ type: 'invalidateTags', tags })) } },
}));

import { store } from '@/store';
import { baseApi } from '@/store/api/base.api';
import { offlineSyncProcessor } from './processor';
import { openOfflineDb } from './db';
import { getOrCreateClientKey, encryptClientField } from './crypto';
import { enqueue } from './outbox';

const mockGetState = store.getState as jest.Mock;
const mockDispatch = store.dispatch as jest.Mock;

function makeToken(tenantId: string, userId: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify({ userId, tenantId, role: 'DOCTOR', email: 'd@h.com', isFirstLogin: false }));
  return `${header}.${body}.sig`;
}

async function queueOneEntry(tenantId: string, userId: string, endpoint = '/api/patients/PAT-1') {
  const db = await openOfflineDb(tenantId, userId);
  const key = await getOrCreateClientKey(tenantId, userId);
  const payloadCiphertext = await encryptClientField(JSON.stringify({ fullName: 'New Name' }), key);
  return enqueue(db, {
    tenantId, userId, entityType: 'PATIENT', operation: 'UPDATE',
    endpoint, method: 'PATCH', payloadCiphertext,
  });
}

describe('offlineSyncProcessor', () => {
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('does nothing when there is no token', async () => {
    mockGetState.mockReturnValue({ auth: { token: null } });
    await offlineSyncProcessor.triggerSync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('does nothing when there is nothing queued, even if navigator.onLine is stale/false', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      await offlineSyncProcessor.triggerSync();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('still attempts a queued entry even when navigator.onLine is stale/false (Windows Wi-Fi toggles do not reliably update it)', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await queueOneEntry(tenantId, userId);
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { status: 200 }));

    const originalNavigator = (globalThis as { navigator?: unknown }).navigator;
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      await offlineSyncProcessor.triggerSync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true });
    }
  });

  test('successfully syncs a queued entry: sends Idempotency-Key, removes it from the outbox, invalidates tags', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const entry = await queueOneEntry(tenantId, userId);
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { status: 200 }));

    await offlineSyncProcessor.triggerSync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/patients/PAT-1');
    expect(init.method).toBe('PATCH');
    expect(init.headers['Idempotency-Key']).toBe(entry.clientOpId);
    expect(JSON.parse(init.body)).toEqual({ fullName: 'New Name' });

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.get('outbox', entry.clientOpId)).toBeUndefined();

    const log = await db.getAll('syncLog');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ clientOpId: entry.clientOpId, result: 'SUCCESS', httpStatus: 200 });

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ tags: ['Patient'] }));
    expect(baseApi.util.invalidateTags).toHaveBeenCalledWith(['Patient']);
  });

  test('a 409 response marks the entry CONFLICT and does not retry it', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const entry = await queueOneEntry(tenantId, userId);
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'error' }), { status: 409 }));

    await offlineSyncProcessor.triggerSync();

    const db = await openOfflineDb(tenantId, userId);
    const stored = await db.get('outbox', entry.clientOpId);
    expect(stored?.status).toBe('CONFLICT');

    // A second trigger must not attempt to resync a terminal entry.
    fetchMock.mockClear();
    await offlineSyncProcessor.triggerSync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a network failure mid-sync leaves the entry PENDING for a later retry', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const entry = await queueOneEntry(tenantId, userId);
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await offlineSyncProcessor.triggerSync();

    const db = await openOfflineDb(tenantId, userId);
    const stored = await db.get('outbox', entry.clientOpId);
    expect(stored?.status).toBe('PENDING');
    expect(stored?.attempts).toBe(1);
  });

  test('a CREATE success resolves the real id, deletes the temp cache row, and rewrites a dependent entry queued after it', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);

    // Seed the temp-id optimistic patient row a real tryQueueOffline call
    // would have written — so we can assert it's cleaned up on sync.
    await db.put('cache_patients', {
      id: 'temp-patient-1', plaintextFields: { patientId: 'temp-patient-1' },
      encryptedFieldsCiphertext: null, version: null, cachedAt: Date.now(), pendingSync: true,
    });

    const patientPayload = await encryptClientField(JSON.stringify({ fullName: 'Jane' }), key);
    await enqueue(db, {
      tenantId, userId, entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: patientPayload,
      clientOpId: 'temp-patient-1',
    });

    const visitPayload = await encryptClientField(JSON.stringify({ patientId: 'temp-patient-1' }), key);
    await enqueue(db, {
      tenantId, userId, entityType: 'OPD_VISIT', operation: 'CREATE',
      endpoint: '/api/opd/visits', method: 'POST', payloadCiphertext: visitPayload,
      dependsOn: ['temp-patient-1'],
      tempIdRefs: [{ path: 'patientId', tempId: 'temp-patient-1' }],
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { patientId: 'PAT-REAL-1' } }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success', data: { visitId: 'OPD-REAL-1' } }), { status: 201 }));

    await offlineSyncProcessor.triggerSync();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First call is the patient create.
    const [, patientInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(patientInit.body)).toEqual({ fullName: 'Jane' });
    // Second call is the OPD visit create — its temp patientId reference must
    // have been rewritten to the patient's real, server-assigned id.
    const [, visitInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(visitInit.body)).toEqual({ patientId: 'PAT-REAL-1' });

    expect(await db.getAll('outbox')).toHaveLength(0);
    // The temp-id optimistic cache row is gone (superseded by the real fetch).
    expect(await db.get('cache_patients', 'temp-patient-1')).toBeUndefined();
  });

  test('a dependent entry is never sent while its parent CREATE has not synced — stays PENDING', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);

    // The parent patient CREATE is deliberately NOT queued (e.g. it already
    // failed/errored in an earlier pass and was removed) — only the
    // dependent visit entry remains, still referencing the unresolved tempId.
    const visitPayload = await encryptClientField(JSON.stringify({ patientId: 'temp-patient-orphan' }), key);
    const visitEntry = await enqueue(db, {
      tenantId, userId, entityType: 'OPD_VISIT', operation: 'CREATE',
      endpoint: '/api/opd/visits', method: 'POST', payloadCiphertext: visitPayload,
      dependsOn: ['temp-patient-orphan'],
      tempIdRefs: [{ path: 'patientId', tempId: 'temp-patient-orphan' }],
    });

    await offlineSyncProcessor.triggerSync();

    expect(fetchMock).not.toHaveBeenCalled();
    const stored = await db.get('outbox', visitEntry.clientOpId);
    expect(stored?.status).toBe('PENDING');
    expect(stored?.attempts).toBe(0);
  });

  test('a 409 on a CREATE (e.g. duplicate patient) captures the server message as lastError', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);
    const payload = await encryptClientField(JSON.stringify({ fullName: 'Jane', mobileNumber: '9999999999' }), key);
    const entry = await enqueue(db, {
      tenantId, userId, entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: payload,
    });

    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ status: 'error', message: 'A patient with this name and mobile number already exists.' }),
      { status: 409 },
    ));

    await offlineSyncProcessor.triggerSync();

    const stored = await db.get('outbox', entry.clientOpId);
    expect(stored?.status).toBe('CONFLICT');
    expect(stored?.lastError).toBe('A patient with this name and mobile number already exists.');
  });

  test('a WARD CREATE success deletes the prefixed temp cache row (ward:<tempId>), not the bare tempId', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);

    // Seed the temp-id optimistic ward row exactly as base.api.ts's
    // wrapForCacheWrite + cacheQueryResult would have written it — under the
    // listWards policy's 'ward:' storeKeyPrefix, not the bare tempId.
    await db.put('cache_wards_beds', {
      id: 'ward:temp-ward-1', plaintextFields: { wardId: 'temp-ward-1', name: 'General' },
      encryptedFieldsCiphertext: null, version: null, cachedAt: Date.now(), pendingSync: true,
    });

    const payload = await encryptClientField(JSON.stringify({ name: 'General' }), key);
    await enqueue(db, {
      tenantId, userId, entityType: 'WARD', operation: 'CREATE',
      endpoint: '/api/ipd/wards', method: 'POST', payloadCiphertext: payload,
      clientOpId: 'temp-ward-1',
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'success', data: { wardId: 'WARD-REAL-1', name: 'General' } }), { status: 201 }),
    );

    await offlineSyncProcessor.triggerSync();

    expect(await db.getAll('outbox')).toHaveLength(0);
    // The prefixed temp row must be gone — a delete keyed on the bare
    // tempId (no prefix) would silently miss it and leave a ghost ward
    // behind forever (nothing else ever cleans up cache_wards_beds).
    expect(await db.get('cache_wards_beds', 'ward:temp-ward-1')).toBeUndefined();
    expect(baseApi.util.invalidateTags).toHaveBeenCalledWith(['IPD']);
  });

  test('a CHARGE CREATE success invalidates both Charge and Bill tags (a new charge changes the patient\'s bill total)', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);
    const payload = await encryptClientField(
      JSON.stringify({ patientId: 'PAT-1', category: 'CONSULTATION', description: 'Consult', amount: 500 }),
      key,
    );
    await enqueue(db, {
      tenantId, userId, entityType: 'CHARGE', operation: 'CREATE',
      endpoint: '/api/charges', method: 'POST', payloadCiphertext: payload,
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'success', data: { chargeId: 'CHG-REAL-1' } }), { status: 201 }),
    );

    await offlineSyncProcessor.triggerSync();

    expect(baseApi.util.invalidateTags).toHaveBeenCalledWith(['Charge', 'Bill']);
  });

  test('processes independent entries in dependency order and stops the run on a network failure', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const first = await queueOneEntry(tenantId, userId, '/api/patients/PAT-1');
    const second = await queueOneEntry(tenantId, userId, '/api/patients/PAT-2');
    mockGetState.mockReturnValue({ auth: { token: makeToken(tenantId, userId) } });

    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'success' }), { status: 200 }));

    await offlineSyncProcessor.triggerSync();

    // Only the first entry was attempted before the run aborted.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const db = await openOfflineDb(tenantId, userId);
    expect((await db.get('outbox', first.clientOpId))?.status).toBe('PENDING');
    expect((await db.get('outbox', second.clientOpId))?.status).toBe('PENDING');
  });
});
