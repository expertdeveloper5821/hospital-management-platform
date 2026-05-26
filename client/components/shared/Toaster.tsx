'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOAST_EVENT, type ToastPayload } from '@/lib/toast';

type ToastItem = Required<Pick<ToastPayload, 'id'>> & ToastPayload;

const TOAST_DURATION_MS = 4000;

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<ToastPayload>).detail;
      const id = detail.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const nextToast = { ...detail, id };

      setToasts((current) => [nextToast, ...current].slice(0, 4));
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, TOAST_DURATION_MS);
    }

    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed right-4 top-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 sm:right-6 sm:top-6"
    >
      {toasts.map((toast) => {
        const isSuccess = toast.variant === 'success';
        const Icon = isSuccess ? CheckCircle2 : XCircle;

        return (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'flex items-start gap-3 rounded-md border bg-background p-4 text-sm shadow-lg',
              isSuccess ? 'border-emerald-200' : 'border-destructive/30',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 h-5 w-5 shrink-0',
                isSuccess ? 'text-emerald-600' : 'text-destructive',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{toast.title}</p>
              {toast.description && (
                <p className="mt-1 text-muted-foreground">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
