'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/shared/Sidebar';
import { NotificationBell } from '@/components/shared/NotificationBell';
import { BrandingProvider } from '@/components/shared/BrandingProvider';
import { useAppSelector } from '@/store/hooks';
import { wsClient } from '@/lib/websocket-client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const token    = useAppSelector((s) => s.auth.token);
  const profile  = useAppSelector((s) => s.auth.profile);
  const isAuth   = useAppSelector((s) => s.auth.isAuthenticated);

  // Guard — redirect unauthenticated users to login
  useEffect(() => {
    if (!isAuth) {
      router.replace('/login');
    }
  }, [isAuth, router]);

  // Guard — redirect first-login users to change-password
  useEffect(() => {
    if (isAuth && profile?.isFirstLogin) {
      router.replace('/change-password');
    }
  }, [isAuth, profile, router]);

  // Connect WebSocket on mount; disconnect on unmount or logout
  useEffect(() => {
    if (token) {
      wsClient.connect(token);
      return () => wsClient.disconnect();
    }
  }, [token]);

  if (!isAuth || !profile) return null;

  return (
    <BrandingProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Top bar */}
          <header className="flex items-center justify-end h-16 px-6 border-b bg-background shrink-0">
            <NotificationBell />
          </header>
          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </BrandingProvider>
  );
}
