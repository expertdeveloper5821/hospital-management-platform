'use client';

import { APP_SHELL_ROUTES, APP_SHELL_CACHE_NAME } from './shell-routes';

// Populates the service worker's app-shell navigation cache (app/sw.ts's
// `hms-app-shell-pages` NetworkFirst cache) directly from the main thread,
// independent of however the user actually navigates.
//
// Why this exists: app/sw.ts's own runtime-caching rule only intercepts a
// genuine `mode: 'navigate'` browser navigation (hard load / typed URL /
// hard refresh). Next's App Router <Link> — the normal way a user moves
// between Dashboard/Patients/OPD/IPD/Lab while online — instead performs a
// client-side transition: a plain `fetch()` for the route's RSC payload,
// carrying Next's own `RSC`/`Next-Router-State-Tree` headers, which is never
// `mode: 'navigate'`. So a session where the user only ever clicked around
// the Sidebar (never hard-reloaded a second route) would leave every route
// but the first uncached — exactly the `sw.js → ERR_FAILED` bug this fixes.
//
// The fix: fetch each shell route with a plain, headerless GET (which the
// service worker does NOT specially intercept, since its mode isn't
// 'navigate' either — the request just passes straight to the network) and
// write the response straight into the exact cache name the SW's own
// NetworkFirst rule reads from via the Cache Storage API. A headerless GET
// to one of these routes is indistinguishable, server-side, from a real
// navigation — Next has no reason to treat it as an RSC-flight request — so
// this always gets back the same full HTML document a hard navigation would,
// never an RSC/`text/x-component` payload. No `/api/*` call is made, no PHI
// is touched — this only ever fetches the 5 fixed, data-free shell routes.
let priming: Promise<void> | null = null;

export function primeAppShellCache(): Promise<void> {
  if (priming) return priming;
  if (typeof window === 'undefined' || !('caches' in window)) return Promise.resolve();
  if (navigator.onLine === false) return Promise.resolve();

  priming = (async () => {
    try {
      const cache = await caches.open(APP_SHELL_CACHE_NAME);
      await Promise.all(APP_SHELL_ROUTES.map(async (route) => {
        try {
          const response = await fetch(route, { credentials: 'same-origin' });
          if (response.ok) await cache.put(route, response.clone());
        } catch {
          // Best-effort per route — a route that fails to prime here simply
          // falls back to whatever the navigate-mode runtime rule manages
          // to cache on its own (unchanged from before this existed).
        }
      }));
    } catch {
      // Cache Storage can throw in some contexts (private browsing, quota) —
      // never let priming break the rest of the app.
    } finally {
      priming = null;
    }
  })();

  return priming;
}
