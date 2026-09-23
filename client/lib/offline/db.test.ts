/** @jest-environment node */
import 'fake-indexeddb/auto';
import { openOfflineDb, deleteOfflineDb, CACHE_STORE_NAMES } from './db';
import type { OutboxEntry, CachedRecord } from './types';

describe('offline db', () => {
  test('creates every expected object store on first open', async () => {
    const db = await openOfflineDb('tenant-1', 'user-1');

    expect(db.objectStoreNames.contains('meta')).toBe(true);
    expect(db.objectStoreNames.contains('cryptoKeys')).toBe(true);
    expect(db.objectStoreNames.contains('outbox')).toBe(true);
    expect(db.objectStoreNames.contains('syncLog')).toBe(true);
    for (const name of CACHE_STORE_NAMES) {
      expect(db.objectStoreNames.contains(name)).toBe(true);
    }

    db.close();
  });

  test('different (tenantId, userId) pairs get physically separate databases', async () => {
    const dbA = await openOfflineDb('tenant-a', 'user-a');
    const dbB = await openOfflineDb('tenant-b', 'user-b');

    const record: CachedRecord = {
      id: 'PAT-1', plaintextFields: { fullName: 'Tenant A Patient' },
      encryptedFieldsCiphertext: null, version: null, cachedAt: Date.now(),
    };
    await dbA.put('cache_patients', record);

    const seenInB = await dbB.get('cache_patients', 'PAT-1');
    expect(seenInB).toBeUndefined();

    const seenInA = await dbA.get('cache_patients', 'PAT-1');
    expect(seenInA).toEqual(record);

    dbA.close();
    dbB.close();
  });

  test('outbox entries can be queried by status via the by-status index', async () => {
    const db = await openOfflineDb('tenant-1', 'user-2');

    const pending: OutboxEntry = {
      clientOpId: 'op-1', tenantId: 'tenant-1', userId: 'user-2',
      entityType: 'PATIENT', operation: 'CREATE', endpoint: '/api/patients', method: 'POST',
      payloadCiphertext: 'enc:client:v1:xxx', dependsOn: [], tempIdRefs: [],
      status: 'PENDING', attempts: 0, lastAttemptAt: null, lastError: null, createdAt: Date.now(),
    };
    const synced: OutboxEntry = { ...pending, clientOpId: 'op-2', status: 'SYNCED' };

    await db.put('outbox', pending);
    await db.put('outbox', synced);

    const pendingOnly = await db.getAllFromIndex('outbox', 'by-status', 'PENDING');
    expect(pendingOnly.map((e) => e.clientOpId)).toEqual(['op-1']);

    db.close();
  });

  test('cache_patients can be looked up by mobile number', async () => {
    const db = await openOfflineDb('tenant-1', 'user-3');

    const record: CachedRecord = {
      id: 'PAT-2', plaintextFields: { fullName: 'Jane Doe', mobileNumber: '9998887777' },
      encryptedFieldsCiphertext: null, version: null, cachedAt: Date.now(),
    };
    await db.put('cache_patients', record);

    const found = await db.getFromIndex('cache_patients', 'by-mobile', '9998887777');
    expect(found?.id).toBe('PAT-2');

    db.close();
  });

  test('deleteOfflineDb removes the database and everything in it', async () => {
    const db = await openOfflineDb('tenant-1', 'user-4');
    await db.put('meta', { key: 'lastSyncedAt', value: Date.now() });
    db.close();

    await deleteOfflineDb('tenant-1', 'user-4');

    const reopened = await openOfflineDb('tenant-1', 'user-4');
    const meta = await reopened.get('meta', 'lastSyncedAt');
    expect(meta).toBeUndefined();

    reopened.close();
  });
});
