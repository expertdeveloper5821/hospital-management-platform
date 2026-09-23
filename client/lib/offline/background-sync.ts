// Optional Background Sync wiring. This module never touches IndexedDB,
// WebCrypto, or the outbox directly — it only (a) asks the browser to wake
// the service worker via Background Sync once connectivity returns, and
// (b) listens for the service worker's relay message (app/sw.ts) and re-runs
// the SAME foreground sync path (offlineSyncProcessor.triggerSync) already
// used for the `online` event. Foreground sync stays authoritative; this is
// a best-effort nudge for browsers that support the Background Sync API
// (Chrome/Edge/Android — Safari and Firefox never fire it, and everything
// still works via the `online` listener alone).
import { offlineSyncProcessor } from './processor';

// `ServiceWorkerRegistration.sync: SyncManager` is already declared globally
// by the `serwist` package (imported transitively via app/sw.ts, part of the
// same TS program) — Safari/Firefox lack the API at runtime regardless of
// what the ambient type claims, hence the `'sync' in registration` guard below.
export const BACKGROUND_SYNC_TAG = 'hms-outbox-flush';

/** No-op (and never throws) when Background Sync isn't supported or registration is rejected. */
export async function registerBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('sync' in registration)) return;
    await registration.sync.register(BACKGROUND_SYNC_TAG);
  } catch {
    // Best-effort only.
  }
}

/** Returns an unsubscribe function. Safe to call even when service workers aren't supported. */
export function listenForBackgroundSyncMessages(): () => void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return () => {};
  }

  const handleMessage = (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === BACKGROUND_SYNC_TAG) {
      offlineSyncProcessor.triggerSync();
    }
  };

  navigator.serviceWorker.addEventListener('message', handleMessage);
  return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
}
