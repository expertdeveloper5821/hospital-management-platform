'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '@/lib/offline/use-online-status';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isOnline = useOnlineStatus();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // A route this tab hasn't loaded before (so nothing is cached — see the
  // shell-route list in client/app/sw.ts and the offline query-cache in
  // client/lib/offline/query-cache.ts) fails here while offline instead of
  // showing a generic "something went wrong", since that's not what happened.
  if (!isOnline) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <WifiOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-foreground">This page isn&apos;t available offline.</p>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs">
          You haven&apos;t opened it yet on this device, so there&apos;s no cached data to show. Reconnect and try again.
        </p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => reset()}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-sm font-medium text-destructive">Something went wrong. Please try again.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        If this keeps happening, refresh the page or contact your administrator.
      </p>
      <Button size="sm" variant="outline" className="mt-4" onClick={() => reset()}>
        <RefreshCw className="h-3.5 w-3.5 mr-2" />
        Try again
      </Button>
    </div>
  );
}
