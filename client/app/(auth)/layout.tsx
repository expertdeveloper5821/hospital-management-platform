'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { UserRole } from '@/store/types';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();
  const isAuth   = useAppSelector((s) => s.auth.isAuthenticated);
  const profile  = useAppSelector((s) => s.auth.profile);

  useEffect(() => {
    if (!isAuth || !profile) return;

    if (profile.isFirstLogin) {
      // Must change password — only /change-password is allowed
      if (pathname !== '/change-password') {
        router.replace('/change-password');
      }
      return;
    }

    // Fully authenticated — send to the right home page
    if (profile.role === UserRole.SUPER_ADMIN) {
      router.replace('/super-admin');
    } else {
      router.replace('/dashboard');
    }
  }, [isAuth, profile, pathname, router]);

  // Already logged in → render nothing while the redirect fires (prevents flash)
  if (isAuth && profile) {
    const needsPasswordChange = profile.isFirstLogin;
    const onChangePassword    = pathname === '/change-password';
    if (!needsPasswordChange || !onChangePassword) return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40">
      <div className="w-full max-w-md px-4">{children}</div>
    </div>
  );
}
