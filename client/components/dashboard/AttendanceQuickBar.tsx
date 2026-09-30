'use client';

import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import {
  useCheckInMutation,
  useCheckOutMutation,
  useGetMyAttendanceQuery,
} from '@/store/api/attendance.api';
import { Button } from '@/components/ui/button';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { cn } from '@/lib/utils';

// Compact Dashboard check-in/out row. Reuses the Attendance module's endpoints
// and the same "today's row" lookup as the Attendance page's TodayStatusCard
// (current-month self attendance; the backend range ends at today, so the last
// record is today's), so both screens always agree on the same saved record.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Same HH/MM/SS format as the Attendance page's timer, e.g. 15_912_000 -> "04h 25m 12s"
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Ticks only while a session is running, so nothing re-renders before
// check-in or after check-out.
function useLiveClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

export function AttendanceQuickBar() {
  const today = new Date();
  const { data, isLoading } = useGetMyAttendanceQuery({
    month: today.getMonth() + 1,
    year:  today.getFullYear(),
  });
  const [checkIn,  { isLoading: checkingIn }]  = useCheckInMutation();
  const [checkOut, { isLoading: checkingOut }] = useCheckOutMutation();
  const [confirming, setConfirming] = useState<'check-in' | 'check-out' | null>(null);

  const todayRow      = data?.records[data.records.length - 1];
  const checkInAt     = todayRow?.checkIn ?? null;
  const checkOutAt    = todayRow?.checkOut ?? null;
  const isRunning     = !!checkInAt && !checkOutAt;
  const hasCheckedOut = !!checkInAt && !!checkOutAt;
  const isBusy        = checkingIn || checkingOut;

  const now = useLiveClock(isRunning);

  // Elapsed time is always derived from the saved check-in timestamp, so a
  // reload resumes the counter where it really is instead of restarting it.
  const elapsedMs = isRunning
    ? now - new Date(checkInAt!).getTime()
    : hasCheckedOut
      ? new Date(checkOutAt!).getTime() - new Date(checkInAt!).getTime()
      : 0;

  function handleConfirm() {
    if (confirming === 'check-in') checkIn();
    else if (confirming === 'check-out') checkOut();
    setConfirming(null);
  }

  if (isLoading) {
    return <div className="h-[60px] rounded-xl border bg-muted animate-pulse" />;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full',
            isRunning ? 'bg-green-500 animate-pulse' : hasCheckedOut ? 'bg-slate-400' : 'bg-amber-400',
          )}
        />
        <p className="text-sm font-medium truncate">
          {isRunning ? (
            <>Working • <span className="tabular-nums font-semibold">{formatDuration(elapsedMs)}</span></>
          ) : hasCheckedOut ? (
            <>
              Worked <span className="tabular-nums font-semibold">{formatDuration(elapsedMs)}</span>
              <span className="text-muted-foreground"> • Checked out at {formatTime(checkOutAt!)}</span>
            </>
          ) : (
            'Not Checked In'
          )}
        </p>
      </div>

      {!hasCheckedOut && (
        <button
          type="button"
          onClick={() => setConfirming(isRunning ? 'check-out' : 'check-in')}
          disabled={isBusy}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap h-8 px-4 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            isRunning
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-white text-green-600 border border-green-600 hover:bg-green-50',
          )}
        >
          {isRunning ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {checkingIn ? 'Checking in…' : checkingOut ? 'Checking out…' : isRunning ? 'Check Out' : 'Check In'}
        </button>
      )}

      {confirming && (
        <DialogOverlay className="items-center justify-center bg-black/50 p-4">
          <div className="bg-background rounded-xl border shadow-xl w-full max-w-sm p-6 space-y-5 text-center">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Are you sure?</h2>
              <p className="text-sm text-muted-foreground">
                Do you want to {confirming === 'check-in' ? 'check in' : 'check out'} now?
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(null)} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                className={cn(
                  'flex-1 text-white',
                  confirming === 'check-in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700',
                )}
                onClick={handleConfirm}
                disabled={isBusy}
              >
                {confirming === 'check-in' ? 'Yes, Check In' : 'Yes, Check Out'}
              </Button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
