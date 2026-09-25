// Drains the outbox once connectivity returns. Mirrors the wsClient singleton
// pattern (client/lib/websocket-client.ts) — a plain module-level instance
// driven directly against the imported store, wired up from
// app/(dashboard)/layout.tsx alongside the WebSocket lifecycle.
import { store } from '@/store';
import { baseApi } from '@/store/api/base.api';
import { getSessionFromToken } from './session';
import { openOfflineDb } from './db';
import { getOrCreateClientKey, decryptClientField } from './crypto';
import {
  getReadyToSync,
  isRetryDue,
  markInFlight,
  markSynced,
  markRetryable,
  markTerminal,
  appendSyncLog,
} from './outbox';
import { resolveTempIdRefs, UnresolvedTempIdError } from './temp-id';
import { CACHE_STORE_BY_ENTITY, CACHE_STORE_KEY_PREFIX_BY_ENTITY } from './query-cache';
import type { OutboxEntityType, OutboxEntry } from './types';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

type OfflineTagType = 'Patient' | 'OPD' | 'IPD' | 'Lab' | 'Payment' | 'Inventory' | 'Package' | 'Charge' | 'Bill';

const ENTITY_TAGS: Record<OutboxEntityType, OfflineTagType[]> = {
  PATIENT:              ['Patient'],
  OPD_VISIT:            ['OPD'],
  IPD_ADMISSION:        ['IPD'],
  IPD_PROGRESS_NOTE:    ['IPD'],
  IPD_ADMISSION_VITALS: ['IPD'],
  LAB_REQUEST:          ['Lab'],
  MANUAL_PAYMENT:       ['Payment'],
  INVENTORY_ITEM:       ['Inventory'],
  WARD:                 ['IPD'],
  BED:                  ['IPD'],
  PACKAGE:              ['Package'],
  // Matches addCharge's own invalidatesTags (charges.api.ts) — a new charge
  // also affects the patient's bill total.
  CHARGE:               ['Charge', 'Bill'],
};

// The response field holding a CREATE entry's server-assigned real id —
// used to populate resolvedIds so a dependent entry's tempIdRefs can be
// rewritten later in the same sync pass (see resolveTempIdRefs below).
const CREATE_ID_FIELD_BY_ENTITY: Partial<Record<OutboxEntityType, string>> = {
  PATIENT:        'patientId',
  OPD_VISIT:      'visitId',
  IPD_ADMISSION:  'admissionId',
  MANUAL_PAYMENT: 'paymentId',
};

/** Best-effort extraction of `{message}` from a non-ok JSON error response — used to give terminal outbox entries (409/4xx) a specific, useful lastError instead of a generic status-code string. */
async function extractErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : null;
  } catch {
    return null;
  }
}

class OfflineSyncProcessor {
  private running = false;

  /**
   * Safe to call anytime (mount, `online` event, tab focus/visibility, a
   * periodic poll, a manual "Sync now") — a no-op if already running or
   * unauthenticated. Deliberately does NOT bail out on `navigator.onLine
   * === false`: that flag is driven by the same OS/browser network-change
   * notification that misses Wi-Fi radio toggles on Windows (see
   * app/(dashboard)/layout.tsx), so a stale `false` value would otherwise
   * defeat every trigger at once, including the periodic poll meant as an
   * `online`-event-independent backstop. Genuinely-offline runs still fail
   * fast and safely per entry (fetch rejects → markRetryable), gated only by
   * each entry's own backoff window (isRetryDue), so this never spams the
   * network.
   */
  async triggerSync(): Promise<void> {
    if (this.running) return;

    const token = store.getState().auth.token;
    const session = getSessionFromToken(token);
    if (!token || !session) return;

    this.running = true;
    try {
      await this.processQueue(session.tenantId, session.userId, token);
    } finally {
      this.running = false;
    }
  }

  private async processQueue(tenantId: string, userId: string, token: string): Promise<void> {
    const db = await openOfflineDb(tenantId, userId);
    const key = await getOrCreateClientKey(tenantId, userId);
    const entries = await getReadyToSync(db, tenantId, userId);

    // tempId (== the CREATE entry's own clientOpId — see outbox.ts's
    // enqueue) -> the real, server-assigned id it resolved to. Populated as
    // CREATE entries succeed, in topological order, so a dependent entry
    // later in this same pass (e.g. an OPD visit created for a patient
    // created earlier in this pass) can have its temp-id reference rewritten
    // before it's sent.
    const resolvedIds = new Map<string, string>();

    for (const entry of entries) {
      if (!isRetryDue(entry)) continue;

      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await decryptClientField(entry.payloadCiphertext, key));
      } catch {
        // Corrupted/tampered ciphertext — no safe way to replay this entry.
        await markTerminal(db, entry.clientOpId, 'FAILED', 'Failed to decrypt queued payload');
        await appendSyncLog(db, entry.clientOpId, 'FAILURE', null);
        continue;
      }

      if (entry.tempIdRefs.length > 0) {
        try {
          body = resolveTempIdRefs(body, entry.tempIdRefs, resolvedIds);
        } catch (err) {
          if (err instanceof UnresolvedTempIdError) {
            // The dependency this entry references hasn't synced yet this
            // pass — either it's genuinely later in topological order (won't
            // happen given getReadyToSync's ordering, but is possible if its
            // own sync attempt above failed/errored) or it became terminal
            // (CONFLICT/FAILED, so it's no longer PENDING/in `entries` at
            // all) — either way, this entry must never be sent with an
            // unresolved temp id. Leave it untouched; it's retried again
            // next sync pass once its dependency actually resolves.
            continue;
          }
          throw err;
        }
      }

      await markInFlight(db, entry.clientOpId);

      let response: Response;
      try {
        response = await fetch(`${BASE_URL}${entry.endpoint}`, {
          method: entry.method,
          headers: {
            'Content-Type':    'application/json',
            'Authorization':   `Bearer ${token}`,
            'Idempotency-Key': entry.clientOpId,
          },
          body: JSON.stringify(body),
        });
      } catch {
        // Network-level failure — connectivity most likely dropped again
        // mid-run. Stop here; everything else stays PENDING for next time.
        await markRetryable(db, entry.clientOpId, 'Network error while syncing');
        await appendSyncLog(db, entry.clientOpId, 'FAILURE', null);
        break;
      }

      if (response.ok) {
        await markSynced(db, entry.clientOpId);
        await appendSyncLog(db, entry.clientOpId, 'SUCCESS', response.status);
        if (entry.operation === 'CREATE') {
          await this.handleCreateSynced(db, entry, response, resolvedIds);
        }
        store.dispatch(baseApi.util.invalidateTags(ENTITY_TAGS[entry.entityType]));
        continue;
      }

      const errorMessage = await extractErrorMessage(response);
      await appendSyncLog(db, entry.clientOpId, 'FAILURE', response.status);
      if (response.status === 409) {
        await markTerminal(db, entry.clientOpId, 'CONFLICT', errorMessage ?? 'Sync conflict (409)');
      } else if (response.status >= 400 && response.status < 500) {
        await markTerminal(db, entry.clientOpId, 'FAILED', errorMessage ?? `Sync rejected (${response.status})`);
      } else {
        // 5xx / 503 — transient server-side issue, worth retrying.
        await markRetryable(db, entry.clientOpId, errorMessage ?? `Server error (${response.status})`);
      }
    }
  }

  /**
   * Records the real id a synced CREATE resolved to (so a dependent entry
   * later in this pass can have its tempIdRefs rewritten) and removes the
   * temp-id optimistic row from the read-through cache — the next fetch of
   * this entity (triggered by the invalidateTags call right after this)
   * will recache it under its real id, so leaving the temp row in place
   * would otherwise show the same record twice.
   */
  private async handleCreateSynced(
    db: Awaited<ReturnType<typeof openOfflineDb>>,
    entry: OutboxEntry,
    response: Response,
    resolvedIds: Map<string, string>,
  ): Promise<void> {
    // Only entity types something else can depend on (patientId, referenceId,
    // …) are in CREATE_ID_FIELD_BY_ENTITY — but the cache cleanup below must
    // run for every entity type with a CACHE_STORE_BY_ENTITY entry regardless,
    // so this never early-returns past it (that used to silently skip cleanup
    // for any CREATE type with no dependents — see the WARD case below).
    const idField = CREATE_ID_FIELD_BY_ENTITY[entry.entityType];
    if (idField) {
      try {
        const parsed = await response.json() as { data?: Record<string, unknown> };
        const realId = parsed.data?.[idField];
        if (typeof realId === 'string') {
          resolvedIds.set(entry.clientOpId, realId);
        }
      } catch {
        // Response wasn't valid JSON — nothing to resolve; dependents will
        // simply stay PENDING until a later sync pass re-derives this.
      }
    }

    const cacheStore = CACHE_STORE_BY_ENTITY[entry.entityType];
    if (cacheStore) {
      // WARD's store is shared with beds under a key prefix (see
      // CACHE_STORE_KEY_PREFIX_BY_ENTITY's doc comment) — the temp row was
      // written as `ward:${tempId}`, not the bare tempId, so the delete must
      // use the same prefixed key or it silently no-ops and the temp row
      // never gets cleaned up.
      const prefix = CACHE_STORE_KEY_PREFIX_BY_ENTITY[entry.entityType] ?? '';
      try {
        await db.delete(cacheStore, `${prefix}${entry.clientOpId}`);
      } catch {
        // Best-effort cleanup only — a stale temp row left behind is
        // cosmetic (superseded on next real fetch), never a correctness bug.
      }
    }
  }
}

export const offlineSyncProcessor = new OfflineSyncProcessor();
