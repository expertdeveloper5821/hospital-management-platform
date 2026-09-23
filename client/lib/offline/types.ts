// Shared types for the offline-sync layer (client-side only). See
// aidlc-docs / the offline architecture plan for the full design — this file
// just defines the shapes stored in IndexedDB.

export type OutboxEntityType =
  | 'PATIENT'
  | 'OPD_VISIT'
  | 'IPD_ADMISSION'
  | 'IPD_PROGRESS_NOTE'
  | 'IPD_ADMISSION_VITALS'
  | 'LAB_REQUEST'
  | 'MANUAL_PAYMENT'
  | 'INVENTORY_ITEM'
  | 'WARD'
  | 'BED'
  | 'PACKAGE'
  | 'CHARGE';

export type OutboxOperation = 'CREATE' | 'UPDATE' | 'APPEND';

export type OutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'FAILED' | 'CONFLICT' | 'SYNCED';

// Points at a path in an outbox entry's payload that must be rewritten once
// the dependency identified by `tempId` has synced and produced a real id.
export interface TempIdRef {
  path:   string;
  tempId: string;
}

export interface OutboxEntry {
  clientOpId:        string;
  tenantId:          string;
  userId:            string;
  entityType:        OutboxEntityType;
  operation:         OutboxOperation;
  endpoint:          string;
  method:            'POST' | 'PATCH';
  // AES-256-GCM ciphertext (client key) of the JSON payload that will be sent
  // to `endpoint` — decrypted back to plaintext only in memory at dispatch time.
  payloadCiphertext: string;
  dependsOn:         string[];
  tempIdRefs:        TempIdRef[];
  status:            OutboxStatus;
  attempts:          number;
  lastAttemptAt:     number | null;
  lastError:         string | null;
  createdAt:         number;
}

export interface SyncLogEntry {
  id?:        number;
  clientOpId: string;
  result:     'SUCCESS' | 'FAILURE';
  httpStatus: number | null;
  timestamp:  number;
}

// A read-through cache row for one server entity. Non-sensitive fields stay
// plaintext for fast list/search/sort; sensitive sub-fields (mirroring the
// backend's own encrypted-field list for that entity) live only inside
// `encryptedFieldsCiphertext`, decrypted on demand for a detail view.
export interface CachedRecord<T = Record<string, unknown>> {
  id:                        string;
  plaintextFields:           T;
  encryptedFieldsCiphertext: string | null;
  version:                   string | null;
  cachedAt:                  number;
  // Set only when this row was written from an offline optimistic edit (not a
  // real GET response) — see query-cache.ts's cacheQueryResult `pendingSync`
  // option. Cleared automatically the next time a real GET recaches this row,
  // since that write builds a fresh record object without this flag.
  pendingSync?:              boolean;
}

export interface CryptoKeyRecord {
  id:        'primary';
  key:       CryptoKey;
  algorithm: string;
  createdAt: number;
}
