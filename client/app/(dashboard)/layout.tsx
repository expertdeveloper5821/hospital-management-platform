'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { useAppSelector } from '@/store/hooks';
import { wsClient } from '@/lib/websocket-client';
import { Menu } from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router  = useRouter();
  const token   = useAppSelector((s) => s.auth.token);
  const profile = useAppSelector((s) => s.auth.profile);
  const isAuth  = useAppSelector((s) => s.auth.isAuthenticated);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar — drawer on mobile, static on md+ */}
        <div
          className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:relative md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } md:block`}
        >
          <Sidebar onClose={() => setSidebarOpen(false)} />
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
            <div className="ml-auto">
              <NotificationBell />
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
