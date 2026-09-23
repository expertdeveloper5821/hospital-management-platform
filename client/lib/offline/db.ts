// Per-(tenantId, userId) IndexedDB database — the hard multi-tenant isolation
// boundary for the offline-sync layer. Every tenant/user pair gets its own
// physical database (`hms_offline_<tenantId>_<userId>`), so a query bug can
// never leak another tenant's cached data, outbox entries, or crypto key, and
// logout is a single `deleteOfflineDb` call that wipes all three together.

import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';
import type { OutboxEntry, SyncLogEntry, CachedRecord, CryptoKeyRecord } from './types';

const SCHEMA_VERSION = 3;

const CACHE_STORE_NAMES = [
  'cache_patients',
  'cache_opd_visits',
  'cache_ipd_admissions',
  'cache_lab_requests',
  'cache_departments',
  'cache_wards_beds',
  // Added in SCHEMA_VERSION 2 for offline navigation shell support (doctor/
  // nurse dropdowns on OPD/IPD/Lab pages) — additive, existing stores untouched.
  'cache_users',
  // Added in SCHEMA_VERSION 3 for offline data on the remaining dashboard
  // shell routes (Inventory/Packages/Payments/Billing/Audit Logs) — additive,
  // existing stores untouched. See query-cache.ts's QUERY_CACHE_POLICIES.
  'cache_inventory',
  'cache_packages',
  'cache_payments',
  'cache_charges',
  'cache_audit_logs',
  'cache_employee_roster',
] as const;

export type CacheStoreName = (typeof CACHE_STORE_NAMES)[number];

interface OfflineDBSchema extends DBSchema {
  meta: {
    key:   string;
    value: { key: string; value: unknown };
  };
  cryptoKeys: {
    key:   string;
    value: CryptoKeyRecord;
  };
  outbox: {
    key:     string;
    value:   OutboxEntry;
    indexes: { 'by-status': string };
  };
  syncLog: {
    key:   number;
    value: SyncLogEntry;
  };
  cache_patients:       { key: string; value: CachedRecord; indexes: { 'by-mobile': string } };
  cache_opd_visits:     { key: string; value: CachedRecord };
  cache_ipd_admissions: { key: string; value: CachedRecord };
  cache_lab_requests:   { key: string; value: CachedRecord };
  cache_departments:    { key: string; value: CachedRecord };
  cache_wards_beds:     { key: string; value: CachedRecord };
  cache_users:          { key: string; value: CachedRecord };
  cache_inventory:      { key: string; value: CachedRecord };
  cache_packages:       { key: string; value: CachedRecord };
  cache_payments:       { key: string; value: CachedRecord };
  cache_charges:        { key: string; value: CachedRecord };
  cache_audit_logs:     { key: string; value: CachedRecord };
  cache_employee_roster: { key: string; value: CachedRecord };
}

function dbNameFor(tenantId: string, userId: string): string {
  return `hms_offline_${tenantId}_${userId}`;
}

export function openOfflineDb(tenantId: string, userId: string): Promise<IDBPDatabase<OfflineDBSchema>> {
  return openDB<OfflineDBSchema>(dbNameFor(tenantId, userId), SCHEMA_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('cryptoKeys')) {
        db.createObjectStore('cryptoKeys', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'clientOpId' });
        outbox.createIndex('by-status', 'status');
      }
      if (!db.objectStoreNames.contains('syncLog')) {
        db.createObjectStore('syncLog', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('cache_patients')) {
        const patients = db.createObjectStore('cache_patients', { keyPath: 'id' });
        patients.createIndex('by-mobile', 'plaintextFields.mobileNumber');
      }
      for (const name of CACHE_STORE_NAMES) {
        if (name === 'cache_patients') continue;
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    },
  });
}

export async function deleteOfflineDb(tenantId: string, userId: string): Promise<void> {
  await deleteDB(dbNameFor(tenantId, userId));
}

export { CACHE_STORE_NAMES };
export type { OfflineDBSchema };
