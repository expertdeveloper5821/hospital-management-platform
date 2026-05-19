'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { useAppSelector } from '@/store/hooks';
import { wsClient } from '@/lib/websocket-client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router  = useRouter();
  const token   = useAppSelector((s) => s.auth.token);
  const profile = useAppSelector((s) => s.auth.profile);
  const isAuth  = useAppSelector((s) => s.auth.isAuthenticated);

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

  // Render nothing while redirecting (prevents flash of dashboard for wrong users)
  if (!isAuth || !profile || profile.isFirstLogin) return null;

  return (
    <BrandingProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-end h-16 px-6 border-b bg-background shrink-0">
            <NotificationBell />
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
