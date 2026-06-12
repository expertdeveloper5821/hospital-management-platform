'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { ProfileDropdown } from '@/components/header/ProfileDropdown';
import { MobileNav } from '@/components/layout/MobileNav';
import { useAppSelector } from '@/store/hooks';
import { useGetPlatformSettingsQuery } from '@/store/api/platformSettings.api';
import { useGetMyProfileQuery } from '@/store/api/user.api';
import { wsClient } from '@/lib/websocket-client';
import { Menu } from 'lucide-react';

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour >= 5  && hour < 12) return 'Good Morning';
  if (hour >= 12 && hour < 17) return 'Good Afternoon';
  if (hour >= 17 && hour < 21) return 'Good Evening';
  return 'Good Night';
}

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

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, []);

  // Render nothing until hydration completes (prevents flash and premature redirects)
  if (!hydrated || !isAuth || !profile || profile.isFirstLogin) return null;

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
            {/* Left: hamburger (mobile) + greeting (desktop) */}
            <div className="flex items-center gap-3">
              <button
                className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              {!isSuperAdmin && (
                <p className="hidden md:block text-sm font-medium text-foreground">
                  Hi, {getTimeGreeting()}{myProfile?.name ? `, ${myProfile.name}` : ''}.
                </p>
              )}
            </div>
            {/* Right: notification + profile */}
            <div className="flex items-center gap-2">
              <NotificationBell />
              <ProfileDropdown />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
