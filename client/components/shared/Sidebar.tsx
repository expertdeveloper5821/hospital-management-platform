'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Users,
  HeartPulse,
  Stethoscope,
  Bed,
  FlaskConical,
  Package,
  CreditCard,
  FileText,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNavItems } from '@/lib/rbac-nav';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { useLogoutMutation } from '@/store/api/auth.api';
import type { UserRole } from '@/store/types';

const ICON_MAP: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'building-2':       Building2,
  'users':            Users,
  'heart-pulse':      HeartPulse,
  'stethoscope':      Stethoscope,
  'bed':              Bed,
  'flask-conical':    FlaskConical,
  'package':          Package,
  'credit-card':      CreditCard,
  'file-text':        FileText,
};

export function Sidebar() {
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const profile  = useAppSelector((s) => s.auth.profile);
  const branding = useAppSelector((s) => s.auth.branding);
  const [logout] = useLogoutMutation();

  if (!profile) return null;

  const navItems = getNavItems(profile.role as UserRole);
  const displayName = branding?.displayName ?? 'HMS';

  async function handleLogout() {
    await logout({ isSuperAdmin: profile?.role === 'SUPER_ADMIN' });
  }

  return (
    <aside
      data-testid="sidebar"
      className="flex flex-col h-full w-64 bg-sidebar text-sidebar-foreground border-r shrink-0"
    >
      {/* Branding header */}
      <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-accent/40 shrink-0">
        {branding?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding.logoUrl}
            alt={displayName}
            className="h-8 w-8 rounded object-contain shrink-0"
          />
        )}
        <span className="font-bold text-lg truncate">{displayName}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon    = ICON_MAP[item.icon] ?? LayoutDashboard;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="shrink-0 border-t border-sidebar-accent/40 p-4 space-y-1">
        <p className="text-xs text-sidebar-foreground/50 truncate">{profile.email}</p>
        <p className="text-xs text-sidebar-foreground/50">{profile.role}</p>
        <button
          onClick={handleLogout}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
