// Single source of truth for the fixed set of dashboard "shell" routes whose
// navigation document is safe to cache offline (see app/sw.ts's header
// comment on APP_SHELL_RUNTIME_CACHING for why: pure Client Components, no
// server-fetched/PHI data in the initial HTML). Shared between app/sw.ts
// (the service worker, a separate build target) and shell-cache.ts (the
// main-thread priming module) so the two can never drift out of sync.
//
// '/' is deliberately excluded — it's a server-side redirect() (always a
// 307; see app/page.tsx) to /dashboard, which a NetworkFirst strategy never
// caches (it only ever caches 200s). The PWA manifest's start_url points
// straight at /dashboard for the same reason (see manifest.ts).
//
// Every entry here is a top-level list page only — same rule as the original
// five (Dashboard/Patients/OPD/IPD/Lab): the route's own page.tsx must be a
// pure Client Component with no server-fetched data in its initial HTML/RSC
// payload, verified for each of these against app/(dashboard)/<route>/page.tsx
// before adding it. Nested/dynamic detail routes (e.g. /packages/[packageId],
// /profile/change-password) are deliberately excluded, same as /patients/[id]
// always was — they still require a fresh RSC fetch offline and fall back to
// app/(dashboard)/error.tsx's offline-aware message. This only makes each
// page's own UI/navigation reachable offline; it does not make any route's
// CRUD/API calls work offline.
export const APP_SHELL_ROUTES = [
  '/dashboard',
  '/patients',
  '/opd',
  '/ipd',
  '/lab',
  '/admin',
  '/staff',
  '/departments',
  '/attendance',
  '/inventory',
  '/wards',
  '/packages',
  '/payments',
  '/revenue',
  '/billing',
  '/audit',
  '/profile',
] as const;

// Must exactly match the `cacheName` NetworkFirst is given in app/sw.ts —
// shell-cache.ts writes into this same named cache directly via the Cache
// Storage API, independent of the service worker's own fetch-event routing.
export const APP_SHELL_CACHE_NAME = 'hms-app-shell-pages';
