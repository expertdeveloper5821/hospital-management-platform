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
  Settings,
  LogOut,
  X,
  FileBadge,
  Receipt,
  FolderOpen,
  Gift,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getNavItems } from '@/lib/rbac-nav';
import { useAppSelector } from '@/store/hooks';
import { useLogoutMutation } from '@/store/api/auth.api';
import { useGetPlatformSettingsQuery } from '@/store/api/platformSettings.api';
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
  'settings':         Settings,
  'file-badge':       FileBadge,
  'receipt':          Receipt,
  'folder-open':      FolderOpen,
  'gift':             Gift,
};

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname();
  const profile  = useAppSelector((s) => s.auth.profile);
  const branding = useAppSelector((s) => s.auth.branding);
  const [logout] = useLogoutMutation();
  const { data: platformSettings } = useGetPlatformSettingsQuery();

  if (!profile) return null;

  const isSuperAdmin = profile.role === 'SUPER_ADMIN';
  const navItems     = getNavItems(profile.role as UserRole);

  // Super Admin has no tenant branding — fall back to platform settings
  const headerLogoUrl  = isSuperAdmin ? platformSettings?.logoUrl    : branding?.logoUrl;
  const headerTitle    = isSuperAdmin
    ? (platformSettings?.platformTitle ?? 'HMS')
    : (branding?.displayName ?? 'HMS');

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
        {headerLogoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={headerLogoUrl}
            alt={headerTitle}
            className="h-16 w-16 rounded object-contain shrink-0"
          />
        )}
        <span className="font-bold text-lg truncate flex-1">{headerTitle}</span>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        )}
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
              onClick={onClose}
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

      {/* Platform logo — shown when set by Super Admin */}
      {platformSettings?.logoUrl && (
        <div className="shrink-0 border-t border-sidebar-accent/40 px-4 py-3 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={platformSettings.logoUrl}
            alt={platformSettings.platformTitle ?? 'Platform'}
            className="h-12 w-auto max-w-[80px] object-contain opacity-80 shrink-0"
          />
          {/* {platformSettings.platformTitle && (
            <span className="text-xs text-sidebar-foreground/60 truncate">
              {platformSettings.platformTitle}
            </span>
          )} */}
        </div>
      )}
    </aside>
  );
}
