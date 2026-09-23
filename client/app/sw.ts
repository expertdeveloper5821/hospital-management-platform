// Service worker source, compiled by @serwist/next (see next.config.mjs)
// into public/sw.js. Scope: installable-PWA + static app-shell caching only —
// see the header comment on APP_SHELL_RUNTIME_CACHING below for why this does
// NOT use @serwist/next/worker's defaultCache export.
//
// This file deliberately never touches IndexedDB, WebCrypto, or the offline
// outbox (client/lib/offline/*) — that logic lives entirely in the main
// thread (client/lib/offline/processor.ts), which stays the authoritative
// sync path. The Background Sync handler below is a pure relay: it only
// tells open tabs "connectivity may be back," never runs any sync itself.
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from 'serwist';
import { APP_SHELL_ROUTES, APP_SHELL_CACHE_NAME } from '../lib/offline/shell-routes';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Explicitly NOT @serwist/next/worker's `defaultCache`. Its stock rule set
 * includes a same-origin `/api/*` NetworkFirst cache AND a catch-all
 * `!sameOrigin` NetworkFirst cache (24h / 1h TTLs). This app's backend runs
 * on a separate origin from the Next.js frontend (NEXT_PUBLIC_API_URL) — that
 * catch-all would transparently cache every clinical GET response (patients,
 * OPD visits, lab requests, payments, …) in the Cache Storage API, which is
 * exactly the PHI-at-rest exposure this phase must not introduce.
 *
 * Only genuine build-time static assets are cached below: nothing dynamic,
 * nothing cross-origin, nothing under any `/api/` path (same-origin or not).
 * Anything not matched here is simply not intercepted — it goes to the
 * network exactly as if no service worker were installed.
 */
const APP_SHELL_ROUTES_SET = new Set<string>(APP_SHELL_ROUTES);

const APP_SHELL_RUNTIME_CACHING: RuntimeCaching[] = [
  {
    matcher: /\/_next\/static\/.+\.js$/i,
    handler: new CacheFirst({
      cacheName: 'hms-next-static-js',
      plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  {
    matcher: /\/_next\/static\/.+\.css$/i,
    handler: new StaleWhileRevalidate({
      cacheName: 'hms-next-static-css',
      plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  {
    // next/font (used for Inter in app/layout.tsx) self-hosts Google Fonts at
    // build time under _next/static/media — this never makes a runtime
    // request to fonts.googleapis.com/fonts.gstatic.com in the first place.
    matcher: /\/_next\/static\/media\/.+\.(?:woff2?|ttf|otf|eot)$/i,
    handler: new CacheFirst({
      cacheName: 'hms-next-static-fonts',
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    // Our own PWA icons (client/public/icons) — static app assets, never patient data.
    matcher: /\/icons\/.+\.png$/i,
    handler: new CacheFirst({
      cacheName: 'hms-app-icons',
      plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    // manifest.ts's generated /manifest.webmanifest — static, non-sensitive
    // PWA metadata (name/icons/colors), fetched by the browser's own
    // installability checks. Previously uncached, so it 404'd/ERR_FAILED
    // offline (visible in DevTools even though the app itself doesn't
    // depend on it to render). StaleWhileRevalidate so it's available
    // offline immediately after being served once, while still refreshing
    // opportunistically online.
    matcher: /\/manifest\.webmanifest$/i,
    handler: new StaleWhileRevalidate({
      cacheName: 'hms-manifest',
      plugins: [new ExpirationPlugin({ maxEntries: 1, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    // App-shell navigation documents for the fixed set of top-level dashboard
    // list pages only (see APP_SHELL_ROUTES in shell-routes.ts for the exact
    // list). These are all pure Client Components with no server-fetched data
    // in their initial HTML/RSC payload (every data fetch happens
    // client-side afterwards, through the RTK Query layer above — see
    // base.api.ts), so the cached document is exactly as free of PHI as the
    // JS bundle itself.
    //
    // This rule alone only ever catches a genuine `mode: 'navigate'` browser
    // navigation (hard load / typed URL / hard refresh) — it never fires for
    // Next's own <Link> client-side transitions, which fetch an RSC payload
    // via a plain `fetch()` call, never `mode: 'navigate'`. That means normal
    // in-app browsing (clicking the Sidebar while online) would otherwise
    // never populate this cache for anything but whichever route happened to
    // be the session's first hard load — lib/offline/shell-cache.ts's
    // primeAppShellCache() is what actually guarantees all 5 routes are
    // cached, by writing straight into this same-named cache from the main
    // thread; this runtime rule is what then answers a later hard refresh /
    // relaunch, and opportunistically refreshes the cache on any hard nav
    // that does happen. NetworkFirst (not CacheFirst) so an online visit
    // always gets the latest deployed shell; the cache is only a fallback
    // when the network genuinely doesn't answer in time.
    //
    // Deliberately excludes every dynamic detail route (/patients/[id],
    // /opd/[visitId], …) — those still depend on a fresh RSC fetch offline,
    // by design (see aidlc-docs's offline architecture plan); a route not
    // in this set that fails offline is caught by
    // app/(dashboard)/error.tsx's offline-aware fallback instead.
    matcher: ({ request, url, sameOrigin }) =>
      request.mode === 'navigate' &&
      sameOrigin &&
      APP_SHELL_ROUTES_SET.has(url.pathname),
    handler: new NetworkFirst({
      cacheName: APP_SHELL_CACHE_NAME,
      networkTimeoutSeconds: 3,
      plugins: [new ExpirationPlugin({ maxEntries: APP_SHELL_ROUTES_SET.size, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: APP_SHELL_RUNTIME_CACHING,
});

serwist.addEventListeners();

// ─── Background Sync (optional, best-effort) ─────────────────────────────
// `SyncEvent` / `ServiceWorkerGlobalScopeEventMap.sync` are already declared
// globally by the `serwist` package itself (src/lib/backgroundSync) — no
// additional ambient typing needed here.
export const HMS_BACKGROUND_SYNC_TAG = 'hms-outbox-flush';

self.addEventListener('sync', (event) => {
  if (event.tag !== HMS_BACKGROUND_SYNC_TAG) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: HMS_BACKGROUND_SYNC_TAG });
      }
    }),
  );
});
