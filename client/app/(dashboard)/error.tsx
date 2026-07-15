'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

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
