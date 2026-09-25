import withSerwistInit from '@serwist/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
    ],
  },
};

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  // Disabled in dev — a production build is what generates and can be used
  // to verify the actual service worker; running one during `next dev` mostly
  // just adds cache-invalidation friction against HMR.
  disable: process.env.NODE_ENV === 'development',
  // No extra route caching on next/link navigation, and no reload-on-reconnect —
  // client/lib/offline/processor.ts's `online` listener (wired in
  // app/(dashboard)/layout.tsx) is the authoritative reconnect-sync path;
  // an automatic full-page reload here would fight it and could drop
  // whatever a front-desk user is mid-typing when connectivity returns.
  cacheOnNavigation: false,
  reloadOnOnline: false,
  // @serwist/next's automatic public/-folder precache scan (used when this
  // is left undefined) builds each entry's URL with `path.posix.join(...)`
  // over the raw glob match — but on Windows, `globSync` can return matches
  // with '\' separators (e.g. 'icons\icon-192.png'), and `path.posix.join`
  // does not normalize embedded backslashes. The result is a precache entry
  // literally requesting '/icons\icon-192.png', which 404s and makes the
  // whole service worker install hang forever (Workbox precaching aborts the
  // install if any single entry fails) — breaking the PWA/offline feature
  // entirely on a Windows build. public/icons/*.png are already covered by
  // the CacheFirst runtime-caching rule in app/sw.ts (cached lazily on first
  // request instead), so nothing needs precaching from public/ at all.
  additionalPrecacheEntries: [],
});

export default withSerwist(nextConfig);
