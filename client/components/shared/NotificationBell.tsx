'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { markAllRead, markRead } from '@/store/slices/notification.slice';
import type { NotificationMessage } from '@/store/types';

export function NotificationBell() {
  const [panelOpen, setPanelOpen] = useState(false);
  const dispatch      = useAppDispatch();
  const messages      = useAppSelector((s) => s.notification.messages);
  const unreadCount   = useAppSelector((s) => s.notification.unreadCount);

  function handleMarkAllRead() {
    dispatch(markAllRead());
  }

  function handleMarkRead(id: string) {
    dispatch(markRead(id));
  }

  return (
    <div className="relative">
      <button
        onClick={() => setPanelOpen((v) => !v)}
        className="relative p-2 rounded-md hover:bg-accent transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
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
        <div
          className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-card shadow-lg"
          role="dialog"
          aria-label="Notifications panel"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="max-h-80 overflow-y-auto divide-y">
            {messages.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No notifications
              </li>
            )}
            {messages.map((msg: NotificationMessage) => (
              <li
                key={msg.id}
                className={cn(
                  'px-4 py-3 text-sm cursor-pointer hover:bg-muted/50 transition-colors',
                  !msg.read && 'bg-primary/5 font-medium',
                )}
                onClick={() => handleMarkRead(msg.id)}
              >
                <p>{msg.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(msg.timestamp).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
