/** @jest-environment node */
import 'fake-indexeddb/auto';
import { openOfflineDb } from './db';
import {
  enqueue,
  getReadyToSync,
  isRetryDue,
  markInFlight,
  markSynced,
  markRetryable,
  markTerminal,
  appendSyncLog,
} from './outbox';

async function freshDb() {
  return openOfflineDb('tenant-1', crypto.randomUUID());
}

describe('outbox', () => {
  test('enqueue assigns a clientOpId and starts PENDING with zero attempts', async () => {
    const db = await freshDb();

    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'enc:client:v1:xxx',
    });

    expect(entry.clientOpId).toBeTruthy();
    expect(entry.status).toBe('PENDING');
    expect(entry.attempts).toBe(0);
    expect(entry.dependsOn).toEqual([]);

    const stored = await db.get('outbox', entry.clientOpId);
    expect(stored).toEqual(entry);
  });

  test('enqueue honors an explicit clientOpId when provided (CREATE entries mint their own, as their temp id)', async () => {
    const db = await freshDb();

    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'enc:client:v1:xxx',
      clientOpId: 'temp-fixed-id-1',
    });

    expect(entry.clientOpId).toBe('temp-fixed-id-1');
    expect(await db.get('outbox', 'temp-fixed-id-1')).toEqual(entry);
  });

  test('enqueue stores dependsOn/tempIdRefs when provided', async () => {
    const db = await freshDb();

    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'OPD_VISIT', operation: 'CREATE',
      endpoint: '/api/opd/visits', method: 'POST', payloadCiphertext: 'p1',
      dependsOn: ['temp-patient-1'],
      tempIdRefs: [{ path: 'patientId', tempId: 'temp-patient-1' }],
    });

    expect(entry.dependsOn).toEqual(['temp-patient-1']);
    expect(entry.tempIdRefs).toEqual([{ path: 'patientId', tempId: 'temp-patient-1' }]);
  });

  test('getReadyToSync only returns PENDING entries for the given (tenantId, userId), topologically ordered', async () => {
    const db = await freshDb();

    const patient = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'p1',
    });
    const payment = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'MANUAL_PAYMENT', operation: 'CREATE',
      endpoint: '/api/payments/manual', method: 'POST', payloadCiphertext: 'p2',
      dependsOn: [patient.clientOpId],
    });
    // Different user — must not show up.
    await enqueue(db, {
      tenantId: 'tenant-1', userId: 'other-user', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'p3',
    });
    // In flight — must be excluded from the ready set.
    const inFlight = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'OPD_VISIT', operation: 'UPDATE',
      endpoint: '/api/opd/visits/v1', method: 'PATCH', payloadCiphertext: 'p4',
    });
    await markInFlight(db, inFlight.clientOpId);

    const ready = await getReadyToSync(db, 'tenant-1', 'user-1');

    expect(ready.map((e) => e.clientOpId)).toEqual([patient.clientOpId, payment.clientOpId]);
  });

  test('markSynced removes the entry from the outbox', async () => {
    const db = await freshDb();
    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'p1',
    });

    await markSynced(db, entry.clientOpId);

    expect(await db.get('outbox', entry.clientOpId)).toBeUndefined();
  });

  test('markRetryable keeps the entry PENDING and increments attempts/lastError', async () => {
    const db = await freshDb();
    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'CREATE',
      endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'p1',
    });

    await markRetryable(db, entry.clientOpId, 'network timeout');

    const updated = await db.get('outbox', entry.clientOpId);
    expect(updated?.status).toBe('PENDING');
    expect(updated?.attempts).toBe(1);
    expect(updated?.lastError).toBe('network timeout');
    expect(updated?.lastAttemptAt).not.toBeNull();
  });

  test('markTerminal moves the entry to CONFLICT/FAILED and out of getReadyToSync', async () => {
    const db = await freshDb();
    const entry = await enqueue(db, {
      tenantId: 'tenant-1', userId: 'user-1', entityType: 'PATIENT', operation: 'UPDATE',
      endpoint: '/api/patients/PAT-1', method: 'PATCH', payloadCiphertext: 'p1',
    });

    await markTerminal(db, entry.clientOpId, 'CONFLICT', 'server record changed since this edit');

    const updated = await db.get('outbox', entry.clientOpId);
    expect(updated?.status).toBe('CONFLICT');

    const ready = await getReadyToSync(db, 'tenant-1', 'user-1');
    expect(ready).toEqual([]);
  });

  test('appendSyncLog records the outcome', async () => {
    const db = await freshDb();

    await appendSyncLog(db, 'op-1', 'SUCCESS', 201);

    const log = await db.getAll('syncLog');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ clientOpId: 'op-1', result: 'SUCCESS', httpStatus: 201 });
  });
});

describe('isRetryDue', () => {
  const base = {
    clientOpId: 'op-1', tenantId: 't1', userId: 'u1', entityType: 'PATIENT' as const,
    operation: 'CREATE' as const, endpoint: '/x', method: 'POST' as const,
    payloadCiphertext: 'x', dependsOn: [], tempIdRefs: [], status: 'PENDING' as const,
    createdAt: 0, lastError: null,
  };

  test('is always due before the first attempt', () => {
    expect(isRetryDue({ ...base, attempts: 0, lastAttemptAt: null })).toBe(true);
  });

  test('is not due before its backoff window elapses', () => {
    const now = 1_000_000;
    expect(isRetryDue({ ...base, attempts: 1, lastAttemptAt: now - 1_000 }, now)).toBe(false);
  });

  test('is due once its backoff window has elapsed', () => {
    const now = 1_000_000;
    expect(isRetryDue({ ...base, attempts: 1, lastAttemptAt: now - 15_000 }, now)).toBe(true);
  });
});
