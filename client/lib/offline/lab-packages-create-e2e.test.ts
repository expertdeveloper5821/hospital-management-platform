/**
 * @jest-environment node
 *
 * Offline CREATE round trip for Pathology requests, Radiology requests and
 * Packages, against the REAL store singleton and the REAL offlineSyncProcessor
 * (same wiring as sync-e2e.test.ts), but with `fetch` routed to a small
 * in-memory fake backend instead of one-off mocked responses. The fake keeps
 * its own "DB" of records and honours `Idempotency-Key` the way
 * server/src/shared/middleware/idempotency.ts does, so each test can assert
 * the whole chain:
 *
 *   offline create -> optimistic row in the list UI + IndexedDB cache
 *   -> encrypted outbox entry -> reconnect -> processor sync
 *   -> record persisted exactly once in the backend "DB"
 *   -> list refetched (tag invalidation) -> cache holds the real row, no temp row.
 */
import 'fake-indexeddb/auto';
import { store } from '@/store';
import { baseApi } from '@/store/api/base.api';
import { tokenReceived, profileLoaded, logout } from '@/store/slices/auth.slice';
import { patientApi } from '@/store/api/patient.api';
import { userApi } from '@/store/api/user.api';
import { labApi } from '@/store/api/lab.api';
import { packagesApi } from '@/store/api/packages.api';
import { openOfflineDb } from './db';
import { offlineSyncProcessor } from './processor';
import { readCachedQueryResult } from './query-cache';

jest.mock('@/lib/toast', () => ({
  toastSuccess: jest.fn(),
  toastError:   jest.fn(),
}));

type Row = Record<string, unknown>;

function makeToken(tenantId: string, userId: string, role: string): string {
  const header = btoa(JSON.stringify({ alg: 'HS256' }));
  const body = btoa(JSON.stringify({ userId, tenantId, role, email: 'd@h.com', isFirstLogin: false }));
  return `${header}.${body}.sig`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function page(rows: Row[]) {
  return { status: 'success', data: { data: rows, total: rows.length, page: 1, limit: 20, totalPages: 1 } };
}

async function waitFor<T>(probe: () => T | Promise<T>, timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ─── Fake backend ────────────────────────────────────────────────────────────

class FakeBackend {
  online = true;
  // Simulates "the server committed the write but the response never made it
  // back" — the exact uncertain-outcome case Idempotency-Key exists for.
  dropNextPostResponse = false;
  patients:  Row[] = [];
  users:     Row[] = [];
  pathology: Row[] = [];
  radiology: Row[] = [];
  packages:  Row[] = [];
  posts: { path: string; idempotencyKey: string | null; body: Row }[] = [];
  private replays = new Map<string, { status: number; body: unknown }>();
  private seq = 0;

  constructor(private readonly tenantId: string, private readonly userId: string) {}

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!this.online) throw new TypeError('Failed to fetch');

    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'GET') return this.handleGet(path);

    const text = await req.text();
    const body = (text ? JSON.parse(text) : {}) as Row;
    const idempotencyKey = req.headers.get('Idempotency-Key');
    this.posts.push({ path, idempotencyKey, body });

    const replayKey = idempotencyKey ? `${path}|${idempotencyKey}` : null;
    const replay = replayKey ? this.replays.get(replayKey) : undefined;
    if (replay) return json(replay.body, replay.status);

    const { status, payload } = this.handlePost(path, body);
    if (replayKey && status < 400) this.replays.set(replayKey, { status, body: payload });

    if (this.dropNextPostResponse) {
      this.dropNextPostResponse = false;
      throw new TypeError('Failed to fetch');
    }
    return json(payload, status);
  };

  private handleGet(path: string): Response {
    if (path === '/api/lab/pathology') return json(page(this.sortedLab(this.pathology)));
    if (path === '/api/lab/radiology') return json(page(this.sortedLab(this.radiology)));
    if (path === '/api/packages')      return json(page(this.packages));
    if (path === '/api/users')         return json(page(this.users));
    const patient = /^\/api\/patients\/([^/]+)$/.exec(path);
    if (patient) {
      const found = this.patients.find((p) => p.patientId === patient[1]);
      return found ? json({ status: 'success', data: found }) : json({ message: 'Patient not found' }, 404);
    }
    return json({ message: `Unhandled GET ${path}` }, 500);
  }

  private handlePost(path: string, body: Row): { status: number; payload: unknown } {
    const now = new Date().toISOString();

    if (path === '/api/patients') {
      const created = { ...body, patientId: `PAT-REAL-${++this.seq}`, tenantId: this.tenantId, createdAt: now, updatedAt: now };
      this.patients.push(created);
      return { status: 201, payload: { status: 'success', data: created } };
    }

    if (path === '/api/lab/pathology' || path === '/api/lab/radiology') {
      // Mirrors lab.service.ts: an unknown patient is a 404 — so a request
      // that still carried an unresolved temp patientId would fail here.
      const patient = this.patients.find((p) => p.patientId === body.patientId);
      if (!patient) return { status: 404, payload: { status: 'error', message: 'Patient not found' } };
      const referredBy = String(body.referredBy ?? 'SELF');
      const doctor = this.users.find((u) => u.userId === referredBy);
      const created: Row = {
        requestId:       `REQ-REAL-${++this.seq}`,
        patientId:       body.patientId,
        fullName:        patient.fullName,
        tenantId:        this.tenantId,
        requestedBy:     this.userId,
        requestedByName: 'd@h.com',
        ...(path.endsWith('pathology') ? { testType: body.testType } : { imagingType: body.imagingType }),
        referredBy,
        referredByName:  referredBy === 'SELF' ? 'Self' : (doctor?.name ?? 'Self'),
        status:          'PENDING',
        priority:        'NORMAL',
        notes:           body.notes ?? null,
        reportUrl:       null,
        requestedAt:     now,
        updatedAt:       now,
      };
      (path.endsWith('pathology') ? this.pathology : this.radiology).push(created);
      return { status: 201, payload: { status: 'success', data: created } };
    }

    if (path === '/api/packages') {
      // Mirrors packages.service.ts: a duplicate name is a 409 — so a
      // retried create that bypassed idempotency replay would conflict.
      if (this.packages.some((p) => p.name === body.name)) {
        return { status: 409, payload: { status: 'error', message: 'A package with this name already exists' } };
      }
      const created = {
        packageId: `PKG-REAL-${++this.seq}`, tenantId: this.tenantId,
        name: body.name, description: body.description ?? null, price: body.price,
        includedServices: body.includedServices ?? [], status: 'ACTIVE', createdAt: now, updatedAt: now,
      };
      this.packages.push(created);
      return { status: 201, payload: { status: 'success', data: created } };
    }

    return { status: 500, payload: { message: `Unhandled POST ${path}` } };
  }

  private sortedLab(rows: Row[]): Row[] {
    return [...rows].sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const LAB_LIST_ARGS = { page: 1, limit: 20 };
const PACKAGE_LIST_ARGS = { status: undefined, page: 1, limit: 20 };

describe('offline CREATE for Pathology / Radiology / Packages — end to end', () => {
  const originalFetch = global.fetch;
  let errorSpy: jest.SpyInstance;
  let tenantId: string;
  let userId: string;
  let token: string;
  let backend: FakeBackend;

  function login(role: string) {
    tenantId = crypto.randomUUID();
    userId = crypto.randomUUID();
    token = makeToken(tenantId, userId, role);
    backend = new FakeBackend(tenantId, userId);
    global.fetch = backend.fetch as unknown as typeof fetch;
    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(tokenReceived(token));
    store.dispatch(profileLoaded({ userId, email: 'd@h.com', role, tenantId, isFirstLogin: false } as never));
  }

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    global.fetch = originalFetch;
    store.dispatch(baseApi.util.resetApiState());
    store.dispatch(logout());
  });

  test('Pathology: offline create -> top of list + encrypted cache/outbox -> reconnect -> persisted once -> list refreshed with the real id', async () => {
    login('DOCTOR');
    backend.patients.push({ patientId: 'PAT-1', fullName: 'Asha Verma', mobileNumber: '111' });
    backend.pathology.push({
      requestId: 'REQ-OLD', patientId: 'PAT-1', fullName: 'Asha Verma', tenantId, requestedBy: userId,
      testType: 'Lipid Profile', referredBy: 'SELF', referredByName: 'Self', status: 'COMPLETED',
      priority: 'NORMAL', notes: null, reportUrl: null,
      requestedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // ONLINE — the Lab page is open (list subscribed) and the patient was picked.
    await store.dispatch(patientApi.endpoints.getPatientById.initiate('PAT-1'));
    const listSub = store.dispatch(labApi.endpoints.listPathologyRequests.initiate(LAB_LIST_ARGS));
    await listSub;
    const db = await openOfflineDb(tenantId, userId);
    await waitFor(() => db.get('cache_lab_requests', 'pathology:REQ-OLD'));

    // OFFLINE — submit the New Pathology Request modal.
    backend.online = false;
    const createResult = await store.dispatch(labApi.endpoints.createPathologyRequest.initiate({
      patientId: 'PAT-1', testType: 'CBC', referredBy: 'SELF', notes: 'fasting sample',
    }));
    expect('error' in createResult).toBe(false);
    const created = (createResult as unknown as { data: Row }).data;
    const tempId = String(created.requestId);
    expect(tempId.startsWith('temp-')).toBe(true);
    expect(created).toMatchObject({
      patientId: 'PAT-1', fullName: 'Asha Verma', testType: 'CBC', status: 'PENDING', priority: 'NORMAL',
      referredBy: 'SELF', referredByName: 'Self', requestedByName: 'd@h.com', notes: 'fasting sample',
    });

    // Outbox: one encrypted CREATE, keyed by the temp id.
    const outbox = await db.getAll('outbox');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      clientOpId: tempId, entityType: 'PATHOLOGY_REQUEST', operation: 'CREATE',
      endpoint: '/api/lab/pathology', method: 'POST', status: 'PENDING', dependsOn: [],
    });
    expect(outbox[0].payloadCiphertext).toMatch(/^enc:client:v1:/);
    expect(outbox[0].payloadCiphertext).not.toContain('fasting');

    // Cache: pending row under the pathology prefix, notes only inside the encrypted blob.
    const cachedTemp = await db.get('cache_lab_requests', `pathology:${tempId}`);
    expect(cachedTemp?.pendingSync).toBe(true);
    expect(cachedTemp?.plaintextFields.notes).toBeUndefined();
    expect(cachedTemp?.encryptedFieldsCiphertext).toMatch(/^enc:client:v1:/);

    // UI: the subscribed list (refetched via the mutation's 'Lab' invalidation,
    // served from cache while offline) shows the new request first.
    const selectList = labApi.endpoints.listPathologyRequests.select(LAB_LIST_ARGS);
    const offlineList = await waitFor(() => {
      const rows = selectList(store.getState()).data?.data ?? [];
      return rows[0]?.requestId === tempId ? rows : null;
    });
    expect(offlineList.map((r) => r.requestId)).toEqual([tempId, 'REQ-OLD']);
    expect(backend.pathology).toHaveLength(1); // nothing reached the server yet

    // RECONNECT — processor drains the outbox.
    backend.online = true;
    await offlineSyncProcessor.triggerSync();

    const post = backend.posts.find((p) => p.path === '/api/lab/pathology');
    expect(post?.idempotencyKey).toBe(tempId);
    expect(post?.body).toEqual({ patientId: 'PAT-1', testType: 'CBC', referredBy: 'SELF', notes: 'fasting sample' });

    // Backend DB: persisted exactly once, with the submitted values.
    expect(backend.pathology).toHaveLength(2);
    const persisted = backend.pathology.find((r) => r.testType === 'CBC')!;
    expect(persisted).toMatchObject({ patientId: 'PAT-1', notes: 'fasting sample', status: 'PENDING' });
    const realId = String(persisted.requestId);

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_lab_requests', `pathology:${tempId}`)).toBeUndefined();
    const log = await db.getAll('syncLog');
    expect(log.find((l) => l.clientOpId === tempId)).toMatchObject({ result: 'SUCCESS', httpStatus: 201 });

    // Cache refresh: the processor's 'Lab' invalidation refetches the list,
    // which now carries the real id — and so does the read-through cache.
    await waitFor(() => {
      const ids = (selectList(store.getState()).data?.data ?? []).map((r) => r.requestId);
      return ids.includes(realId) && !ids.includes(tempId);
    });
    await waitFor(() => db.get('cache_lab_requests', `pathology:${realId}`));
    const cachedList = await readCachedQueryResult(
      'listPathologyRequests', { url: '/api/lab/pathology?page=1&limit=20' }, { tenantId, userId },
    ) as { data: Row[] };
    expect(cachedList.data.map((r) => r.requestId).sort()).toEqual([realId, 'REQ-OLD'].sort());

    listSub.unsubscribe();
  });

  test('Radiology: offline create for an offline-registered patient -> list isolated from Pathology -> reconnect -> patientId rewritten, persisted once', async () => {
    login('HOSPITAL_ADMIN');
    backend.users.push({ userId: 'DOC-9', name: 'Dr. Rao', email: 'rao@h.com', role: 'DOCTOR', isActive: true });

    // ONLINE — the modal's Referred By dropdown loaded the doctor list; the
    // Radiology tab is open.
    await store.dispatch(userApi.endpoints.listUsers.initiate({ role: 'DOCTOR', isActive: true, limit: 100 }));
    const listSub = store.dispatch(labApi.endpoints.listRadiologyRequests.initiate(LAB_LIST_ARGS));
    await listSub;

    // OFFLINE — register a patient, then request imaging for them.
    backend.online = false;
    const patientResult = await store.dispatch(patientApi.endpoints.createPatient.initiate({
      fullName: 'Ravi Kumar', dateOfBirth: '1985-05-05', gender: 'MALE', mobileNumber: '9999900000', address: 'Addr',
    } as never));
    const tempPatientId = String((patientResult as unknown as { data: Row }).data.patientId);
    expect(tempPatientId.startsWith('temp-')).toBe(true);

    const createResult = await store.dispatch(labApi.endpoints.createRadiologyRequest.initiate({
      patientId: tempPatientId, imagingType: 'Chest X-Ray', referredBy: 'DOC-9',
    }));
    expect('error' in createResult).toBe(false);
    const created = (createResult as unknown as { data: Row }).data;
    const tempId = String(created.requestId);
    expect(created).toMatchObject({
      patientId: tempPatientId, imagingType: 'Chest X-Ray', referredBy: 'DOC-9', referredByName: 'Dr. Rao', status: 'PENDING',
    });

    const db = await openOfflineDb(tenantId, userId);
    const entry = await db.get('outbox', tempId);
    expect(entry).toMatchObject({
      entityType: 'RADIOLOGY_REQUEST', operation: 'CREATE', endpoint: '/api/lab/radiology',
      dependsOn: [tempPatientId], tempIdRefs: [{ path: 'patientId', tempId: tempPatientId }],
    });

    // UI: shows in the Radiology list immediately…
    const selectList = labApi.endpoints.listRadiologyRequests.select(LAB_LIST_ARGS);
    await waitFor(() => (selectList(store.getState()).data?.data ?? [])[0]?.requestId === tempId);
    // …and never leaks into the Pathology list (shared store, separate prefix).
    const pathologyCached = await readCachedQueryResult(
      'listPathologyRequests', { url: '/api/lab/pathology?page=1&limit=20' }, { tenantId, userId },
    ) as { data: Row[] } | null;
    expect((pathologyCached?.data ?? []).some((r) => r.requestId === tempId)).toBe(false);

    // RECONNECT — patient syncs first, then the request with its real patientId.
    backend.online = true;
    await offlineSyncProcessor.triggerSync();

    expect(backend.patients).toHaveLength(1);
    const realPatientId = String(backend.patients[0].patientId);
    expect(backend.radiology).toHaveLength(1);
    expect(backend.radiology[0]).toMatchObject({ patientId: realPatientId, imagingType: 'Chest X-Ray', referredBy: 'DOC-9' });
    const post = backend.posts.find((p) => p.path === '/api/lab/radiology');
    expect(post?.idempotencyKey).toBe(tempId);
    expect(post?.body.patientId).toBe(realPatientId);

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_lab_requests', `radiology:${tempId}`)).toBeUndefined();

    const realId = String(backend.radiology[0].requestId);
    await waitFor(() => {
      const ids = (selectList(store.getState()).data?.data ?? []).map((r) => r.requestId);
      return ids.length === 1 && ids[0] === realId;
    });
    await waitFor(() => db.get('cache_lab_requests', `radiology:${realId}`));

    listSub.unsubscribe();
  });

  test('Packages: offline create -> top of list -> reconnect with a lost response -> retry replays via Idempotency-Key -> exactly one package in the DB', async () => {
    login('HOSPITAL_ADMIN');
    backend.packages.push({
      packageId: 'PKG-OLD', tenantId, name: 'Old Package', description: null, price: 100,
      includedServices: ['X'], status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // ONLINE — Packages list page loaded.
    const listSub = store.dispatch(packagesApi.endpoints.listPackages.initiate(PACKAGE_LIST_ARGS));
    await listSub;
    const db = await openOfflineDb(tenantId, userId);
    await waitFor(() => db.get('cache_packages', 'PKG-OLD'));

    // OFFLINE — submit /packages/new.
    backend.online = false;
    const createResult = await store.dispatch(packagesApi.endpoints.createPackage.initiate({
      name: 'Diabetes Care', description: 'Quarterly', price: 1500, includedServices: ['HbA1c', 'Consultation'],
    }));
    expect('error' in createResult).toBe(false);
    const tempId = String((createResult as unknown as { data: Row }).data.packageId);
    expect(tempId.startsWith('temp-')).toBe(true);

    const [entry] = await db.getAll('outbox');
    expect(entry).toMatchObject({ clientOpId: tempId, entityType: 'PACKAGE', operation: 'CREATE', endpoint: '/api/packages' });
    expect(entry.payloadCiphertext).toMatch(/^enc:client:v1:/);
    expect((await db.get('cache_packages', tempId))?.pendingSync).toBe(true);

    const selectList = packagesApi.endpoints.listPackages.select(PACKAGE_LIST_ARGS);
    const offlineList = await waitFor(() => {
      const rows = selectList(store.getState()).data?.data ?? [];
      return rows[0]?.packageId === tempId ? rows : null;
    });
    expect(offlineList.map((p) => p.packageId)).toEqual([tempId, 'PKG-OLD']);
    expect(offlineList[0]).toMatchObject({ name: 'Diabetes Care', price: 1500, status: 'ACTIVE' });

    // RECONNECT — the server commits the package but the response is lost.
    backend.online = true;
    backend.dropNextPostResponse = true;
    await offlineSyncProcessor.triggerSync();

    expect(backend.packages).toHaveLength(2);
    const pending = await db.get('outbox', tempId);
    expect(pending).toMatchObject({ status: 'PENDING', attempts: 1 });
    // Still visible as pending while its outcome is unknown.
    expect(await db.get('cache_packages', tempId)).toBeDefined();

    // Retry once the backoff window has elapsed — the same Idempotency-Key
    // replays the stored 201 instead of re-running the create (which would
    // otherwise 409 on the duplicate name, or worse, insert a second row).
    const realNow = Date.now();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60 * 1000);
    try {
      await offlineSyncProcessor.triggerSync();
    } finally {
      nowSpy.mockRestore();
    }

    const packagePosts = backend.posts.filter((p) => p.path === '/api/packages');
    expect(packagePosts).toHaveLength(2);
    expect(packagePosts.every((p) => p.idempotencyKey === tempId)).toBe(true);
    expect(backend.packages.filter((p) => p.name === 'Diabetes Care')).toHaveLength(1);

    expect(await db.getAll('outbox')).toHaveLength(0);
    expect(await db.get('cache_packages', tempId)).toBeUndefined();

    const realId = String(backend.packages.find((p) => p.name === 'Diabetes Care')!.packageId);
    await waitFor(() => {
      const ids = (selectList(store.getState()).data?.data ?? []).map((p) => p.packageId);
      return ids.includes(realId) && !ids.includes(tempId) && ids.length === 2;
    });
    await waitFor(() => db.get('cache_packages', realId));
    const cachedList = await readCachedQueryResult('listPackages', { url: '/api/packages?page=1&limit=20' }, { tenantId, userId }) as { data: Row[] };
    expect(cachedList.data.map((p) => p.packageId).sort()).toEqual([realId, 'PKG-OLD'].sort());

    listSub.unsubscribe();
  });
});
