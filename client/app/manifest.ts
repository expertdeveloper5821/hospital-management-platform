import type { MetadataRoute } from 'next';

// Next.js App Router special file — automatically served at
// /manifest.webmanifest and linked from every page's <head>.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Hospital Management Platform',
    short_name: 'HMS',
    description: 'Multi-tenant hospital management system',
    // '/' is a server-side redirect() (always a 307) to /dashboard — the
    // offline app-shell cache in app/sw.ts can only serve 200 responses, so
    // a redirect can never be served offline. Pointing start_url straight at
    // /dashboard means relaunching the installed PWA works offline too,
    // instead of failing at the very first navigation.
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563EB',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
