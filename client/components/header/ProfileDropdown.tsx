'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter }                   from 'next/navigation';
import { User, KeyRound, LogOut }      from 'lucide-react';
import { cn }                          from '@/lib/utils';
import { useAppSelector }              from '@/store/hooks';
import { useLogoutMutation }           from '@/store/api/auth.api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(email: string): string {
  const [local] = email.split('@');
  const parts   = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function formatRole(role: string): string {
  return role.replace(/_/g, ' ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProfileDropdown() {
  const router  = useRouter();
  const profile = useAppSelector((s) => s.auth.profile);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [logout] = useLogoutMutation();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!profile) return null;

  const initials = getInitials(profile.email);

  async function handleLogout() {
    setOpen(false);
    await logout({ isSuperAdmin: profile?.role === 'SUPER_ADMIN' });
  }

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div className="relative" ref={wrapRef}>
      {/* Trigger — initials avatar */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="Profile menu"
          className={cn(
            'fixed right-4 top-[4.25rem] z-[200] w-56 rounded-xl border bg-card shadow-lg',
          )}
        >
          {/* Header — name + role */}
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-semibold truncate">{profile.email}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatRole(profile.role)}</p>
          </div>

          {/* Menu items */}
          <div className="py-1" role="none">
            <button
              role="menuitem"
              onClick={() => navigate('/profile')}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              My Profile
            </button>

            <button
              role="menuitem"
              onClick={() => navigate('/profile/change-password')}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Change Password
            </button>
          </div>

          <div className="border-t py-1" role="none">
            <button
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-muted transition-colors"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
