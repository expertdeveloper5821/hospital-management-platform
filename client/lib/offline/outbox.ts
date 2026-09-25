import type { IDBPDatabase } from 'idb';
import type { OfflineDBSchema } from './db';
import type { OutboxEntry, OutboxEntityType, OutboxOperation, TempIdRef } from './types';
import { computeBackoffDelayMs } from './backoff';
import { topologicalOrder } from './topological-sort';

export interface NewOutboxEntryInput {
  tenantId:          string;
  userId:            string;
  entityType:        OutboxEntityType;
  operation:         OutboxOperation;
  endpoint:          string;
  method:            'POST' | 'PATCH';
  payloadCiphertext: string;
  dependsOn?:        string[];
  tempIdRefs?:       TempIdRef[];
  // CREATE entries only: lets the caller mint the id up front and use the
  // same value both as the entry's clientOpId (and thus its sync
  // Idempotency-Key) and as the entity's temp id shown in the optimistic UI
  // — so a dependent CREATE queued afterwards can declare `dependsOn`
  // directly against that same string, with no separate id-to-entry lookup
  // required. Defaults to a fresh random id, as before, when omitted.
  clientOpId?:       string;
}

/** Queues a new offline mutation. Returns the stored entry (its `clientOpId` doubles as the sync Idempotency-Key). */
export async function enqueue(
  db: IDBPDatabase<OfflineDBSchema>,
  input: NewOutboxEntryInput,
): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    clientOpId:        input.clientOpId ?? crypto.randomUUID(),
    tenantId:          input.tenantId,
    userId:            input.userId,
    entityType:        input.entityType,
    operation:         input.operation,
    endpoint:          input.endpoint,
    method:            input.method,
    payloadCiphertext: input.payloadCiphertext,
    dependsOn:         input.dependsOn ?? [],
    tempIdRefs:        input.tempIdRefs ?? [],
    status:            'PENDING',
    attempts:          0,
    lastAttemptAt:     null,
    lastError:         null,
    createdAt:         Date.now(),
  };
  await db.put('outbox', entry);
  return entry;
}

/**
 * PENDING entries for this (tenantId, userId), topologically ordered so a
 * dependency always comes before whatever queued after it referenced it.
 * IN_FLIGHT/CONFLICT/FAILED entries are excluded — the first is already being
 * processed (guards against a second concurrent processor run picking it up
 * again), the latter two are terminal and need manual resolution.
 */
export async function getReadyToSync(
  db: IDBPDatabase<OfflineDBSchema>,
  tenantId: string,
  userId: string,
): Promise<OutboxEntry[]> {
  const pending = await db.getAllFromIndex('outbox', 'by-status', 'PENDING');
  const owned = pending.filter((e) => e.tenantId === tenantId && e.userId === userId);
  return topologicalOrder(owned);
}

/** True once an entry's backoff window (based on its prior attempt count) has elapsed. */
export function isRetryDue(entry: OutboxEntry, now: number = Date.now()): boolean {
  if (entry.attempts === 0 || entry.lastAttemptAt === null) return true;
  return now - entry.lastAttemptAt >= computeBackoffDelayMs(entry.attempts - 1);
}

export async function markInFlight(db: IDBPDatabase<OfflineDBSchema>, clientOpId: string): Promise<void> {
  const entry = await db.get('outbox', clientOpId);
  if (!entry) return;
  await db.put('outbox', { ...entry, status: 'IN_FLIGHT' });
}

/** A successful sync removes the entry — its outcome lives on in syncLog, not the active queue. */
export async function markSynced(db: IDBPDatabase<OfflineDBSchema>, clientOpId: string): Promise<void> {
  await db.delete('outbox', clientOpId);
}

/** A network failure of uncertain outcome — stays PENDING so it's picked up again once its backoff elapses. */
export async function markRetryable(
  db: IDBPDatabase<OfflineDBSchema>,
  clientOpId: string,
  errorMessage: string,
): Promise<void> {
  const entry = await db.get('outbox', clientOpId);
  if (!entry) return;
  await db.put('outbox', {
    ...entry,
    status:        'PENDING',
    attempts:      entry.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError:     errorMessage,
  });
}

/** A definitive validation/conflict response (409/422) — never blind-retried; needs manual review. */
export async function markTerminal(
  db: IDBPDatabase<OfflineDBSchema>,
  clientOpId: string,
  status: 'CONFLICT' | 'FAILED',
  errorMessage: string,
): Promise<void> {
  const entry = await db.get('outbox', clientOpId);
  if (!entry) return;
  await db.put('outbox', {
    ...entry,
    status,
    attempts:      entry.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError:     errorMessage,
  });
}

export async function appendSyncLog(
  db: IDBPDatabase<OfflineDBSchema>,
  clientOpId: string,
  result: 'SUCCESS' | 'FAILURE',
  httpStatus: number | null,
): Promise<void> {
  await db.add('syncLog', { clientOpId, result, httpStatus, timestamp: Date.now() });
}
