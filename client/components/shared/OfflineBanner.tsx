'use client';

import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/lib/offline/use-online-status';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-900 shrink-0 print:hidden dark:bg-amber-950 dark:text-amber-200"
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      Offline — Showing cached data
    </div>
  );
}
