/**
 * @jest-environment node
 *
 * Full round-trip integration test using the REAL app store singleton
 * (`@/store`) and the REAL (unmocked) offlineSyncProcessor — every previous
 * offline test either built its own isolated store (base.api.offline.test.ts)
 * or mocked `@/store`/`@/store/api/base.api` entirely (processor.test.ts).
 * Neither exercises the actual wiring app/(dashboard)/layout.tsx relies on:
 * a mutation queued through base.api.ts's tryQueueOffline, later drained by
 * processor.ts reading from the SAME global store singleton. This test
 * exists specifically to catch a break point that only shows up when both
 * halves run against the real singleton, as they do in the browser.
 */
import 'fake-indexeddb/auto';
import { store } from '@/store';
import { baseApi } from '@/store/api/base.api';
import { tokenReceived, profileLoaded, logout } from '@/store/slices/auth.slice';
import { patientApi } from '@/store/api/patient.api';
import { opdApi } from '@/store/api/opd.api';
import { paymentApi } from '@/store/api/payment.api';
import { inventoryApi } from '@/store/api/inventory.api';
import { ipdApi } from '@/store/api/ipd.api';
import { chargesApi } from '@/store/api/charges.api';
import { packagesApi } from '@/store/api/packages.api';
import { openOfflineDb } from './db';
import { offlineSyncProcessor } from './processor';

jest.mock('@/lib/toast', () => ({
  toastSuccess: jest.fn(),
  toastError:   jest.fn(),
}));

function makeToken(tenantId: string, userId: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify({ userId, tenantId, role: 'DOCTOR', email: 'd@h.com', isFirstLogin: false }));
  return `${header}.${body}.sig`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('offline edit -> reconnect -> sync, end to end, against the real store singleton', () => {
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
    store.dispatch(logout());
  });

  test('load online -> edit offline -> outbox PENDING -> reconnect -> processor syncs -> outbox cleared, Idempotency-Key sent, correct payload', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));

    // 1. ONLINE — patient loads (populates RTK Query's in-memory cache AND,
    //    via base.api.ts's cacheEligibleQueryResult, the IndexedDB read-through cache).
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'Old Name', mobileNumber: '111' } }),
    );
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));

    // 2. OFFLINE — edit and save.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const editResult = await store.dispatch(
      patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-1', fullName: 'New Name' }),
    );
    expect('error' in editResult).toBe(false);

    const db = await openOfflineDb(tenantId, userId);
    const queuedBefore = await db.getAll('outbox');
    expect(queuedBefore).toHaveLength(1);
    expect(queuedBefore[0].status).toBe('PENDING');
    expect(queuedBefore[0].entityType).toBe('PATIENT');
    expect(queuedBefore[0].endpoint).toBe('/api/patients/PAT-1');
    expect(queuedBefore[0].method).toBe('PATCH');
    // Payload must not be plaintext at rest.
    expect(queuedBefore[0].payloadCiphertext).toMatch(/^enc:client:v1:/);
    const clientOpId = queuedBefore[0].clientOpId;

    // 3. RECONNECT — processor drains the queue.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-1', fullName: 'New Name', mobileNumber: '111' } }),
    );
    await offlineSyncProcessor.triggerSync();

    const syncCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/patients/PAT-1'));
    expect(syncCall).toBeDefined();
    const [, init] = syncCall as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.method).toBe('PATCH');
    expect(init.headers['Idempotency-Key']).toBe(clientOpId);
    expect(init.headers['Authorization']).toBe(`Bearer ${token}`);
    expect(JSON.parse(init.body as string)).toEqual({ fullName: 'New Name' });

    const queuedAfter = await db.getAll('outbox');
    expect(queuedAfter).toHaveLength(0);

    const log = await db.getAll('syncLog');
    const entry = log.find((l) => l.clientOpId === clientOpId);
    expect(entry?.result).toBe('SUCCESS');
    expect(entry?.httpStatus).toBe(200);
  });

  test('conflict (409) leaves the outbox entry terminal (CONFLICT), not retried on a second triggerSync', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'success', data: { patientId: 'PAT-2', fullName: 'Old' } }));
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-2'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await store.dispatch(patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-2', fullName: 'New' }));

    const db = await openOfflineDb(tenantId, userId);
    const [queued] = await db.getAll('outbox');

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'error', message: 'conflict' }, 409));
    await offlineSyncProcessor.triggerSync();

    const afterFirstSync = await db.get('outbox', queued.clientOpId);
    expect(afterFirstSync?.status).toBe('CONFLICT');

    fetchMock.mockClear();
    await offlineSyncProcessor.triggerSync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('offline create -> outbox PENDING (CREATE) -> reconnect -> processor syncs -> real id resolved, Idempotency-Key sent', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));

    // OFFLINE — create a new patient.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const createResult = await store.dispatch(
      patientApi.endpoints.createPatient.initiate({
        fullName: 'New Patient', dateOfBirth: '1990-01-01', gender: 'MALE',
        mobileNumber: '9999999997', address: 'Addr',
      } as never),
    );
    expect('error' in createResult).toBe(false);
    const tempId = (createResult as unknown as { data: { patientId: string } }).data.patientId;
    expect(tempId.startsWith('temp-')).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    const queuedBefore = await db.getAll('outbox');
    expect(queuedBefore).toHaveLength(1);
    expect(queuedBefore[0].entityType).toBe('PATIENT');
    expect(queuedBefore[0].operation).toBe('CREATE');
    expect(queuedBefore[0].endpoint).toBe('/api/patients');
    expect(queuedBefore[0].clientOpId).toBe(tempId);
    expect(await db.get('cache_patients', tempId)).toBeDefined();

    // RECONNECT — processor drains the queue; server assigns the real id.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-REAL-99', fullName: 'New Patient' } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    const syncCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/patients') && !url.includes('PAT-'));
    expect(syncCall).toBeDefined();
    const [, init] = syncCall as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toBe(tempId);

    const queuedAfter = await db.getAll('outbox');
    expect(queuedAfter).toHaveLength(0);
    // Temp-id cache row is gone — superseded by the real id once refetched.
    expect(await db.get('cache_patients', tempId)).toBeUndefined();

    const log = await db.getAll('syncLog');
    const entry = log.find((l) => l.clientOpId === tempId);
    expect(entry?.result).toBe('SUCCESS');
    expect(entry?.httpStatus).toBe(201);
  });

  test('offline Paid OPD create -> reconnect -> visit and its payment both sync in one pass, referenceId resolved to the real visit id', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));

    // OFFLINE — create the visit, then its mandatory payment, exactly like
    // NewVisitModal's submit sequence in opd/page.tsx.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const visitResult = await store.dispatch(
      opdApi.endpoints.createOPDVisit.initiate({ patientId: 'PAT-1' } as never),
    );
    const visitTempId = (visitResult as unknown as { data: { visitId: string } }).data.visitId;
    expect(visitTempId.startsWith('temp-')).toBe(true);

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const paymentResult = await store.dispatch(
      paymentApi.endpoints.createManualPayment.initiate({
        patientId: 'PAT-1', amount: 500, paymentMethod: 'CASH',
        description: 'OPD Consultation', referenceType: 'OPD_VISIT', referenceId: visitTempId,
      } as never),
    );
    expect('error' in paymentResult).toBe(false);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(2);

    // RECONNECT — one triggerSync() drains both in dependency order (visit
    // before its payment), rewriting the payment's referenceId from the
    // visit's temp id to its real, server-assigned one before sending it.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { visitId: 'OPD-REAL-1', queueNumber: 4 } }, 201),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { paymentId: 'PAY-REAL-1', referenceId: 'OPD-REAL-1' } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    const paymentCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/api/payments/manual'),
    );
    expect(paymentCall).toBeDefined();
    const [, paymentInit] = paymentCall as [string, RequestInit];
    expect(JSON.parse(paymentInit.body as string).referenceId).toBe('OPD-REAL-1');
    // Each CREATE keeps its own distinct Idempotency-Key — a retry of the
    // payment alone can never be conflated with the visit's own replay guard.
    const visitCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === 'string' && url.includes('/api/opd/visits'),
    );
    const [, visitInit] = visitCall as [string, RequestInit & { headers: Record<string, string> }];
    expect((paymentInit as RequestInit & { headers: Record<string, string> }).headers['Idempotency-Key'])
      .not.toBe(visitInit.headers['Idempotency-Key']);

    expect(await db.getAll('outbox')).toHaveLength(0);
    const log = await db.getAll('syncLog');
    expect(log.filter((l) => l.result === 'SUCCESS')).toHaveLength(2);
  });

  test('offline create Inventory item -> shows at the top of the cached list immediately -> reconnect -> syncs, temp row cleaned up', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    // Clears any RTK Query subscriptions/cache left by earlier tests in this
    // file (they share the real store singleton) — otherwise an unrelated
    // dangling subscription's tag-triggered auto-refetch can silently
    // consume one of this test's queued fetch mocks out of order.
    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'MANAGER', tenantId, isFirstLogin: false } as never));

    // Prime the list cache the way a real visit to the Inventory page would,
    // with subscribe: false so this dispatch doesn't itself leave a lasting
    // subscription behind for a later test to trip over.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'success',
      data: { data: [{ itemId: 'ITEM-OLD', name: 'Bandages', category: 'Consumables', quantity: 100, lowStockThreshold: 10, isLowStock: false, createdAt: '2026-01-01T00:00:00.000Z' }], total: 1, page: 1, limit: 20, totalPages: 1 },
    }));
    await store.dispatch(inventoryApi.endpoints.listInventoryItems.initiate({}, { subscribe: false }));

    // OFFLINE — create a new item.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const createResult = await store.dispatch(
      inventoryApi.endpoints.createInventoryItem.initiate({
        name: 'Gloves', category: 'Consumables', unit: 'box', quantity: 3, lowStockThreshold: 5,
      } as never),
    );
    expect('error' in createResult).toBe(false);
    const tempId = (createResult as unknown as { data: { itemId: string } }).data.itemId;
    expect(tempId.startsWith('temp-')).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(1);

    // Immediately visible offline, at the top of the list — this is the exact
    // read-through cache the Inventory page's own useListInventoryItemsQuery
    // falls back to (verified directly against IndexedDB, the same
    // ground-truth the query-cache unit tests check the sort order against,
    // rather than a second RTK Query dispatch — avoids re-triggering the
    // same cross-test subscription/auto-refetch fragility this test already
    // works around above).
    const cachedNew = await db.get('cache_inventory', tempId);
    expect(cachedNew).toBeDefined();
    expect(cachedNew?.pendingSync).toBe(true);
    expect(cachedNew?.plaintextFields).toMatchObject({ itemId: tempId, name: 'Gloves' });

    // RECONNECT.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { itemId: 'ITEM-REAL-1', name: 'Gloves', isLowStock: true } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    expect(await db.getAll('outbox')).toHaveLength(0);
    // The temp row is gone — the next real fetch (triggered by invalidateTags)
    // recaches it under its real id, so leaving it would show it twice.
    expect(await db.get('cache_inventory', tempId)).toBeUndefined();
    const log = await db.getAll('syncLog');
    expect(log.find((l) => l.clientOpId === tempId)?.result).toBe('SUCCESS');
  });

  test('offline create Ward -> reconnect -> syncs, prefixed temp row (ward:<tempId>) cleaned up', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'ADMIN', tenantId, isFirstLogin: false } as never));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const createResult = await store.dispatch(
      ipdApi.endpoints.createWard.initiate({ name: 'General Ward', floor: '2' } as never),
    );
    expect('error' in createResult).toBe(false);
    const tempId = (createResult as unknown as { data: { wardId: string } }).data.wardId;

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.get('cache_wards_beds', `ward:${tempId}`)).toBeDefined();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { wardId: 'WARD-REAL-1', name: 'General Ward' } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_wards_beds', `ward:${tempId}`)).toBeUndefined();
  });

  test('offline create Package -> appears in the cached list AND its own detail query -> reconnect -> syncs, temp row cleaned up', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'HOSPITAL_ADMIN', tenantId, isFirstLogin: false } as never));

    // OFFLINE — create, exactly as packages/new/page.tsx does before
    // router.push('/packages').
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const createResult = await store.dispatch(
      packagesApi.endpoints.createPackage.initiate({
        name: 'Basic Checkup', price: 500, includedServices: ['Consultation'],
      } as never),
    );
    expect('error' in createResult).toBe(false);
    const tempId = (createResult as unknown as { data: { packageId: string } }).data.packageId;
    expect(tempId.startsWith('temp-')).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(1);

    // 1. The Packages list (packages/page.tsx's useListPackagesQuery) must
    //    show the new package immediately, offline.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const listResult = await store.dispatch(
      packagesApi.endpoints.listPackages.initiate({ page: 1, limit: 20 }, { subscribe: false }),
    );
    const listData = (listResult as unknown as { data: { data: { packageId: string; name: string }[] } }).data;
    expect(listData.data.some((p) => p.packageId === tempId && p.name === 'Basic Checkup')).toBe(true);

    // 2. Opening that same package's own detail page (packages/[packageId]/page.tsx's
    //    useGetPackageQuery) must also resolve offline — this is the query-cache
    //    policy that was previously missing entirely, so this query used to fail
    //    outright instead of falling back to the cache like every other detail page.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const detailResult = await store.dispatch(
      packagesApi.endpoints.getPackage.initiate(tempId, { subscribe: false }),
    );
    expect('error' in detailResult).toBe(false);
    const detailData = (detailResult as unknown as { data: { packageId: string; name: string; price: number } }).data;
    expect(detailData).toMatchObject({ packageId: tempId, name: 'Basic Checkup', price: 500 });

    // RECONNECT.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { packageId: 'PKG-REAL-1', name: 'Basic Checkup', price: 500, includedServices: ['Consultation'], status: 'ACTIVE' } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_packages', tempId)).toBeUndefined();
  });

  test('offline Add Bed to an existing (real-id) ward -> reconnect -> syncs, prefixed temp row (bed:<tempId>) cleaned up', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'ADMIN', tenantId, isFirstLogin: false } as never));

    // OFFLINE — add a single bed to an already-synced ward, exactly as
    // wards/page.tsx's AddBedsModal does.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const addResult = await store.dispatch(
      ipdApi.endpoints.addBeds.initiate({ wardId: 'WARD-REAL-1', bedNumbers: ['101'] } as never),
    );
    expect('error' in addResult).toBe(false);
    const beds = (addResult as unknown as { data: { bedId: string; wardId: string; bedNumber: string }[] }).data;
    expect(Array.isArray(beds)).toBe(true);
    const tempId = beds[0].bedId;
    expect(tempId.startsWith('temp-')).toBe(true);
    expect(beds[0]).toMatchObject({ wardId: 'WARD-REAL-1', bedNumber: '101', isOccupied: false });

    const db = await openOfflineDb(tenantId, userId);
    const outboxBefore = await db.getAll('outbox');
    expect(outboxBefore).toHaveLength(1);
    expect(outboxBefore[0].entityType).toBe('BED');
    expect(outboxBefore[0].endpoint).toBe('/api/ipd/wards/WARD-REAL-1/beds');

    // Immediately visible under the correct ward, offline — the exact
    // read-through cache WardRow's own useListBedsQuery(ward.wardId) falls
    // back to.
    const cachedNew = await db.get('cache_wards_beds', `bed:${tempId}`);
    expect(cachedNew).toBeDefined();
    expect(cachedNew?.pendingSync).toBe(true);
    expect(cachedNew?.plaintextFields).toMatchObject({ bedId: tempId, wardId: 'WARD-REAL-1', bedNumber: '101' });

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const listBedsResult = await store.dispatch(
      ipdApi.endpoints.listBeds.initiate('WARD-REAL-1', { subscribe: false }),
    );
    const listBedsData = (listBedsResult as unknown as { data: { bedId: string }[] }).data;
    expect(listBedsData.some((b) => b.bedId === tempId)).toBe(true);

    // A bed added to a DIFFERENT ward must never leak into this one's list.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const otherWardResult = await store.dispatch(
      ipdApi.endpoints.listBeds.initiate('WARD-REAL-2', { subscribe: false }),
    );
    const otherWardData = (otherWardResult as unknown as { data: { bedId: string }[] }).data;
    expect(otherWardData.some((b) => b.bedId === tempId)).toBe(false);

    // RECONNECT.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: [{ bedId: 'BED-REAL-1', wardId: 'WARD-REAL-1', bedNumber: '101', isOccupied: false, currentAdmissionId: null }] }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    const syncCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/ipd/wards/WARD-REAL-1/beds'));
    expect(syncCall).toBeDefined();
    const [, syncInit] = syncCall as [string, RequestInit];
    expect(JSON.parse(syncInit.body as string)).toEqual({ wardId: 'WARD-REAL-1', bedNumbers: ['101'] });
    expect((syncInit.headers as Record<string, string>)['Idempotency-Key']).toBe(outboxBefore[0].clientOpId);

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_wards_beds', `bed:${tempId}`)).toBeUndefined();
  });

  test('offline Add Bed rejects a multi-bed submission (falls back to the normal online-only error, never partially queues)', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'ADMIN', tenantId, isFirstLogin: false } as never));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const addResult = await store.dispatch(
      ipdApi.endpoints.addBeds.initiate({ wardId: 'WARD-REAL-1', bedNumbers: ['101', '102'] } as never),
    );
    expect('error' in addResult).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline Add Bed to a ward that is itself still an unsynced temp id is refused (no URL-embedded temp-id substitution)', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'ADMIN', tenantId, isFirstLogin: false } as never));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const addResult = await store.dispatch(
      ipdApi.endpoints.addBeds.initiate({ wardId: 'temp-unsynced-ward', bedNumbers: ['101'] } as never),
    );
    expect('error' in addResult).toBe(true);

    const db = await openOfflineDb(tenantId, userId);
    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline create Charge for an offline-created (temp-id) patient -> reconnect -> patientId rewritten to the real id before sending', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'RECEPTIONIST', tenantId, isFirstLogin: false } as never));

    // 1. Create the patient offline first.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const patientResult = await store.dispatch(
      patientApi.endpoints.createPatient.initiate({
        fullName: 'Offline Patient', dateOfBirth: '1990-01-01', gender: 'MALE',
        mobileNumber: '9999999996', address: 'Addr',
      } as never),
    );
    const patientTempId = (patientResult as unknown as { data: { patientId: string } }).data.patientId;

    // 2. Add a charge for that same still-unsynced patient.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const chargeResult = await store.dispatch(
      chargesApi.endpoints.addCharge.initiate({
        patientId: patientTempId, category: 'CONSULTATION', description: 'Consult fee', amount: 500,
      } as never),
    );
    expect('error' in chargeResult).toBe(false);
    const chargeData = (chargeResult as unknown as { data: Record<string, unknown> }).data;
    expect(chargeData.status).toBe('UNPAID');

    const db = await openOfflineDb(tenantId, userId);
    const outboxBefore = await db.getAll('outbox');
    expect(outboxBefore).toHaveLength(2);
    const chargeEntry = outboxBefore.find((e) => e.entityType === 'CHARGE')!;
    expect(chargeEntry.dependsOn).toEqual([patientTempId]);

    // RECONNECT — patient syncs first, then the charge with its patientId rewritten.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { patientId: 'PAT-REAL-77', fullName: 'Offline Patient' } }, 201),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ status: 'success', data: { chargeId: 'CHG-REAL-1', patientId: 'PAT-REAL-77' } }, 201),
    );
    await offlineSyncProcessor.triggerSync();

    const chargeCall = fetchMock.mock.calls.find(([url]) => typeof url === 'string' && url.includes('/api/charges'));
    expect(chargeCall).toBeDefined();
    const [, chargeInit] = chargeCall as [string, RequestInit];
    expect(JSON.parse(chargeInit.body as string).patientId).toBe('PAT-REAL-77');

    expect(await db.getAll('outbox')).toHaveLength(0);
  });

  test('offline create standalone Manual Payment (not via OPD/IPD) shows at the top of the cached Payments list immediately', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'RECEPTIONIST', tenantId, isFirstLogin: false } as never));

    // Prime the Payments page's own cached list, as a real visit would
    // (subscribe: false so this dispatch doesn't leave a lasting subscription).
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'success',
      data: { data: [{ paymentId: 'PAY-OLD', amount: 200, status: 'COMPLETED', createdAt: '2026-01-01T00:00:00.000Z' }], total: 1, page: 1, limit: 10, totalPages: 1 },
    }));
    await store.dispatch(paymentApi.endpoints.listPayments.initiate({}, { subscribe: false }));

    // OFFLINE — record a manual payment directly from the Payments page (no
    // OPD/IPD visit involved — patientId picked via PatientSearchInput).
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const paymentResult = await store.dispatch(
      paymentApi.endpoints.createManualPayment.initiate({
        patientId: 'PAT-1', amount: 750, paymentMethod: 'UPI', description: 'Registration fee',
      } as never),
    );
    expect('error' in paymentResult).toBe(false);
    const tempId = (paymentResult as unknown as { data: { paymentId: string } }).data.paymentId;

    // Immediately visible offline, at the top of the payments list — checked
    // directly against IndexedDB, the same ground truth listPayments' own
    // offline fallback reads from (see the note on the Inventory test above
    // for why this avoids a second RTK Query dispatch here).
    const db = await openOfflineDb(tenantId, userId);
    const cachedNew = await db.get('cache_payments', tempId);
    expect(cachedNew).toBeDefined();
    expect(cachedNew?.pendingSync).toBe(true);
    expect(cachedNew?.plaintextFields).toMatchObject({ paymentId: tempId, amount: 750 });
  });

  test('a network failure mid-sync leaves the entry PENDING with an incremented attempt count for later retry', async () => {
    const tenantId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = makeToken(tenantId, userId);

    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role: 'DOCTOR', tenantId, isFirstLogin: false } as never));

    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'success', data: { patientId: 'PAT-3', fullName: 'Old' } }));
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-3'));

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await store.dispatch(patientApi.endpoints.updatePatient.initiate({ patientId: 'PAT-3', fullName: 'New' }));

    const db = await openOfflineDb(tenantId, userId);
    const [queued] = await db.getAll('outbox');

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await offlineSyncProcessor.triggerSync();

    const afterFailedSync = await db.get('outbox', queued.clientOpId);
    expect(afterFailedSync?.status).toBe('PENDING');
    expect(afterFailedSync?.attempts).toBe(1);
  });
});
