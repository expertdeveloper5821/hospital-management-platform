'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { ProfileDropdown } from '@/components/header/ProfileDropdown';
import { MobileNav } from '@/components/layout/MobileNav';
import { useAppSelector } from '@/store/hooks';
import { useGetPlatformSettingsQuery } from '@/store/api/platformSettings.api';
import { useGetMyProfileQuery } from '@/store/api/user.api';
import { wsClient } from '@/lib/websocket-client';
import { offlineSyncProcessor } from '@/lib/offline/processor';
import { registerBackgroundSync, listenForBackgroundSyncMessages } from '@/lib/offline/background-sync';
import { primeAppShellCache } from '@/lib/offline/shell-cache';
import { Menu } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router  = useRouter();
  const token    = useAppSelector((s) => s.auth.token);
  const profile  = useAppSelector((s) => s.auth.profile);
  const isAuth   = useAppSelector((s) => s.auth.isAuthenticated);
  const hydrated = useAppSelector((s) => s.auth.hydrated);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';
  const { data: myProfile } = useGetMyProfileQuery(undefined, { skip: !profile || isSuperAdmin });

  const { data: platformSettings } = useGetPlatformSettingsQuery();

  useEffect(() => {
    if (!platformSettings) return;
    if (platformSettings.platformTitle) {
      document.title = platformSettings.platformTitle;
    }
    if (platformSettings.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = platformSettings.faviconUrl;
    }
  }, [platformSettings]);

  // Guard — unauthenticated users go to login (wait for hydration to avoid false redirect on refresh)
  useEffect(() => {
    if (hydrated && !isAuth) {
      router.replace('/login');
    }
  }, [hydrated, isAuth, router]);

  // Guard — first-login users must change password before accessing the dashboard
  useEffect(() => {
    if (hydrated && isAuth && profile?.isFirstLogin) {
      router.replace('/change-password');
    }
  }, [hydrated, isAuth, profile, router]);

  // WebSocket lifecycle
  useEffect(() => {
    if (token) {
      wsClient.connect(token);
      return () => wsClient.disconnect();
    }
  }, [token]);

  // Offline outbox sync — attempt a flush on mount (catches anything queued
  // from a previous session), whenever the browser fires `online`, whenever
  // the tab regains focus/visibility (the moment a user actually notices
  // "oh, Wi-Fi's back" and switches back in), and on a periodic fallback
  // poll. The `online` event is well-documented as unreliable across
  // browsers/OSes — notably Chromium on Windows often does not fire it for a
  // Wi-Fi radio toggle specifically (as opposed to unplugging a cable).
  // Critically, `navigator.onLine` itself is driven by that same OS
  // notification, so triggerSync() no longer gates on it (see processor.ts)
  // — otherwise every trigger here, including this poll, would keep
  // short-circuiting on a stale `false` value and the outbox would sit
  // PENDING indefinitely with no way to self-correct. triggerSync() is a
  // cheap no-op whenever the outbox is empty or a run is already in
  // progress, so firing it from several listeners at once is safe — only
  // one run executes at a time, and duplicate calls simply see `running`
  // and return immediately.
  useEffect(() => {
    if (!token) return;
    offlineSyncProcessor.triggerSync();
    const handleOnline = () => offlineSyncProcessor.triggerSync();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') offlineSyncProcessor.triggerSync();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    const pollId = setInterval(() => offlineSyncProcessor.triggerSync(), 20_000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('focus', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(pollId);
    };
  }, [token]);

  // Background Sync (optional, best-effort) — registers the wake-up tag so a
  // supporting browser (Chrome/Edge/Android) can nudge a sync even if this
  // tab isn't focused right when connectivity returns, and listens for the
  // service worker's relay message. Purely additive to the effect above: the
  // `online` listener there remains the authoritative reconnect-sync trigger.
  useEffect(() => {
    if (!token) return;
    registerBackgroundSync();
    const unsubscribe = listenForBackgroundSyncMessages();
    const handleOnline = () => registerBackgroundSync();
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      unsubscribe();
    };
  }, [token]);

  // App-shell offline cache priming — see shell-cache.ts's docstring for why
  // this is needed at all: the service worker's own navigate-mode runtime
  // rule never fires for Next's <Link> client-side transitions, so without
  // this, normal in-app browsing (as opposed to hard reloads) would leave
  // every dashboard shell route but the first uncached for offline use.
  // Runs once per authenticated session and again on reconnect, so the
  // cached shell never goes stale for long after a deploy.
  useEffect(() => {
    if (!token) return;
    primeAppShellCache();
    const handleOnline = () => primeAppShellCache();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [token]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, []);

  // Render nothing until hydration completes (prevents flash and premature redirects)
  if (!hydrated || !isAuth || !profile || profile.isFirstLogin) return null;

  return (
    <BrandingProvider>
      <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
        {/* Mobile drawer — hidden on md+; MobileNav handles backdrop + transition */}
        <div className="print:hidden">
          <MobileNav open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        </div>

        {/* Sidebar — static on md+; hidden entirely when printing */}
        <div className="hidden md:block shrink-0 print:hidden">
          <Sidebar />
        </div>

        <div className="flex flex-col flex-1 overflow-hidden min-w-0 print:block print:overflow-visible print:w-full">
          <OfflineBanner />
          <header className="flex items-center justify-between h-12 px-4 sm:px-6 border-b bg-background shrink-0 print:hidden">
            {/* Left: hamburger (mobile) + greeting (desktop) */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* {!isSuperAdmin && (
                <p className="hidden md:block text-sm font-medium text-foreground truncate">
                  Hi{myProfile?.name ? `, ${myProfile.name}` : ''}.
                </p>
              )} */}
            </div>
            {/* Right: notification + profile */}
            <div className="flex items-center gap-2">
              <NotificationBell />
              <ProfileDropdown />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 print:overflow-visible print:p-0">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
