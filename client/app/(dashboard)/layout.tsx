'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { SearchOverlay } from '@/components/header/SearchOverlay';
import { ProfileDropdown } from '@/components/header/ProfileDropdown';
import { MobileNav } from '@/components/layout/MobileNav';
import { useAppSelector } from '@/store/hooks';
import { useGetPlatformSettingsQuery } from '@/store/api/platformSettings.api';
import { wsClient } from '@/lib/websocket-client';
import { Menu, Search } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router  = useRouter();
  const token   = useAppSelector((s) => s.auth.token);
  const profile = useAppSelector((s) => s.auth.profile);
  const isAuth  = useAppSelector((s) => s.auth.isAuthenticated);
  const [sidebarOpen,  setSidebarOpen]  = useState(false);
  const [searchOpen,   setSearchOpen]   = useState(false);

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

  // Ctrl+K / Cmd+K global shortcut
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setSearchOpen((v) => !v);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [handleGlobalKey]);

  // Guard — unauthenticated users go to login
  useEffect(() => {
    if (!isAuth) {
      router.replace('/login');
    }
  }, [isAuth, router]);

  // Guard — first-login users must change password before accessing the dashboard
  useEffect(() => {
    if (isAuth && profile?.isFirstLogin) {
      router.replace('/change-password');
    }
  }, [isAuth, profile, router]);

  // WebSocket lifecycle
  useEffect(() => {
    if (token) {
      wsClient.connect(token);
      return () => wsClient.disconnect();
    }
  }, [token]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, []);

  // Render nothing while redirecting (prevents flash of dashboard for wrong users)
  if (!isAuth || !profile || profile.isFirstLogin) return null;

  return (
    <BrandingProvider>
      <div className="flex h-screen overflow-hidden">
        {/* Mobile drawer — hidden on md+; MobileNav handles backdrop + transition */}
        <MobileNav open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Sidebar — static on md+ */}
        <div className="hidden md:block shrink-0">
          <Sidebar />
        </div>

        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <header className="flex items-center justify-between h-16 px-4 sm:px-6 border-b bg-background shrink-0">
            <button
              className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            {/* Header action bar */}
            <div className="ml-auto flex items-center gap-2">
              {/* Search trigger */}
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Open search (Ctrl+K)"
                className="hidden sm:flex items-center gap-2 h-8 rounded-md border bg-muted/50 px-3 text-xs text-muted-foreground hover:bg-muted transition-colors"
              >
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Search…</span>
                <kbd className="rounded border px-1 font-mono text-[10px] opacity-60">Ctrl K</kbd>
              </button>
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Open search"
                className="sm:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Search className="h-5 w-5" aria-hidden="true" />
              </button>

              <NotificationBell />
              <ProfileDropdown />
            </div>

            <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
