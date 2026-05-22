'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, X, CheckCheck, Circle, Wifi, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { markAllRead, markRead as markReadSlice } from '@/store/slices/notification.slice';
import {
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkNotificationReadMutation,
} from '@/store/api/notification.api';
import type { NotificationMessage } from '@/store/types';

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function NotificationBell() {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef   = useRef<HTMLDivElement>(null);
  const dispatch   = useAppDispatch();

  const isAuth      = useAppSelector((s) => s.auth.isAuthenticated);
  const wsMessages  = useAppSelector((s) => s.notification.messages);
  const wsConnected = useAppSelector((s) => s.notification.connected);

  // Seed unread count from API on mount; WS-driven count takes over once connected
  const wsUnreadCount = useAppSelector((s) => s.notification.unreadCount);
  const { data: apiUnreadCount } = useGetUnreadCountQuery(undefined, { skip: !isAuth });
  const unreadCount = wsUnreadCount > 0 ? wsUnreadCount : (apiUnreadCount ?? 0);

  // Fetch notification history when panel is open
  const { data: apiNotifications = [], isFetching } = useListNotificationsQuery(
    { limit: 30 },
    { skip: !isAuth || !panelOpen },
  );

  const [markRead] = useMarkNotificationReadMutation();

  // Merge: WS messages first (newest), then API history (deduped by id)
  const notifications = useMemo<NotificationMessage[]>(() => {
    if (!panelOpen) return wsMessages;
    const wsIds = new Set(wsMessages.map((m) => m.id));
    const apiOnly = apiNotifications.filter((n) => !wsIds.has(n.id));
    return [...wsMessages, ...apiOnly];
  }, [panelOpen, wsMessages, apiNotifications]);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [panelOpen]);

  async function handleMarkRead(msg: NotificationMessage) {
    if (msg.read) return;
    dispatch(markReadSlice(msg.id));
    await markRead(msg.id).catch(() => { /* UI already updated */ });
  }

  async function handleMarkAllRead() {
    dispatch(markAllRead());
    // Fire-and-forget: mark each unread via API
    const unread = notifications.filter((m) => !m.read);
    await Promise.allSettled(unread.map((m) => markRead(m.id)));
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="relative p-2 rounded-md hover:bg-accent transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-out notification panel (FC-11) */}
      {panelOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 bg-black/20 z-40 sm:hidden"
            onClick={() => setPanelOpen(false)}
            aria-hidden="true"
          />
        <div
          className="fixed left-2 right-2 top-[4.5rem] z-50 rounded-xl border bg-card shadow-xl flex flex-col
                     sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:w-96"
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Notifications</span>
              {/* WS connection indicator */}
              {wsConnected ? (
                <span title="Live" className="flex items-center gap-1 text-[10px] text-emerald-500">
                  <Wifi className="h-3 w-3" /> Live
                </span>
              ) : (
                <span title="Disconnected" className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <WifiOff className="h-3 w-3" /> Offline
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setPanelOpen(false)}
                className="p-1 rounded hover:bg-muted transition-colors"
                aria-label="Close notifications"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Notification list */}
          <ul className="max-h-[55vh] sm:max-h-[460px] overflow-y-auto divide-y" role="list">
            {isFetching && notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                Loading…
              </li>
            )}
            {!isFetching && notifications.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" aria-hidden="true" />
                No notifications
              </li>
            )}
            {notifications.map((msg) => (
              <li
                key={msg.id}
                role="listitem"
                className={cn(
                  'flex gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors',
                  !msg.read && 'bg-primary/5',
                )}
                onClick={() => handleMarkRead(msg)}
              >
                {/* Unread dot */}
                <span className="mt-1 shrink-0">
                  {msg.read ? (
                    <Circle className="h-2 w-2 text-muted-foreground/40 fill-muted-foreground/20" />
                  ) : (
                    <Circle className="h-2 w-2 text-primary fill-primary" aria-label="Unread" />
                  )}
                </span>

                <div className="flex-1 min-w-0">
                  {/* Title */}
                  <p className={cn('text-sm truncate', !msg.read && 'font-semibold')}>
                    {msg.title}
                  </p>
                  {/* Message */}
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {msg.message}
                  </p>
                  {/* Meta row */}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-muted-foreground/70">
                      {formatRelativeTime(msg.timestamp)}
                    </span>
                    {msg.entityType && (
                      <span className="text-[10px] bg-muted rounded px-1 text-muted-foreground capitalize">
                        {msg.entityType.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Footer count */}
          {notifications.length > 0 && (
            <div className="px-4 py-2 border-t text-[11px] text-muted-foreground text-center shrink-0">
              {notifications.length} notification{notifications.length !== 1 ? 's' : ''}
              {unreadCount > 0 && ` · ${unreadCount} unread`}
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
