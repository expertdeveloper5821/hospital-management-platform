'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCheckInMutation,
  useCheckOutMutation,
  useGetMyAttendanceQuery,
  useListAttendanceQuery,
  useListEmployeeRosterQuery,
  useUpdateAttendanceMutation,
} from '@/store/api/attendance.api';
import { useAppSelector } from '@/store/hooks';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { cn } from '@/lib/utils';
import type { AttendanceRecord } from '@/store/types';
import {
  CalendarCheck,
  LogIn,
  LogOut,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Pencil,
  X,
  RefreshCw,
  ChevronDown,
  Search,
} from 'lucide-react';

// Roles that can check in/out for themselves *and* manage attendance for any employee.
const MANAGER_ROLES = new Set(['HOSPITAL_ADMIN', 'ADMIN', 'MANAGER', 'HR']);

// "Myself" sentinel for the employee filter — distinct from any real userId.
const MYSELF = '';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Hospital-local calendar month/year — deliberately local (not UTC) getters so
// this matches the browser's local clock (the hospital's IST timezone), the
// same assumption the rest of this file relies on (see getRecordDateParts,
// fromTimeLocal). Using UTC here would default to the wrong month for a
// request made just after midnight IST but before midnight UTC.
const now          = new Date();
const CURRENT_MONTH = now.getMonth() + 1;
const CURRENT_YEAR  = now.getFullYear();

function formatDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// Fixed size so every Status pill (Present / In Progress / Absent) renders at
// the same compact, balanced footprint — identical height, padding, font
// size, and border radius, with text centered regardless of label length.
const STATUS_PILL_BASE = 'inline-flex items-center justify-center h-6 w-24 rounded-full text-xs font-medium whitespace-nowrap';

function statusBadge(status: AttendanceRecord['status']) {
  const styles: Record<AttendanceRecord['status'], string> = {
    PRESENT:     'bg-green-500/10 text-green-700 dark:text-green-400',
    IN_PROGRESS: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    ABSENT:      'bg-muted text-muted-foreground',
  };
  const labels: Record<AttendanceRecord['status'], string> = {
    PRESENT: 'Present', IN_PROGRESS: 'In Progress', ABSENT: 'Absent',
  };
  return (
    <span className={`${STATUS_PILL_BASE} ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

// ─── Employee filter — searchable combobox ────────────────────────────────────

interface EmployeeOption {
  userId: string;
  name:   string;
}

interface EmployeeComboboxProps {
  id?:           string;
  employees:     EmployeeOption[]; // pre-sorted alphabetically, self already excluded
  value:         string;           // userId, or MYSELF
  onChange:      (userId: string) => void;
  includeMyself: boolean;
}

function EmployeeCombobox({ id, employees, value, onChange, includeMyself }: EmployeeComboboxProps) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const containerRef      = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const filtered = employees.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase()));

  const selectedLabel = value === MYSELF
    ? (includeMyself ? 'Myself' : 'Select employee…')
    : (employees.find((e) => e.userId === value)?.name ?? 'Select employee…');

  function select(userId: string) {
    onChange(userId);
    setOpen(false);
    setQuery('');
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        className="h-10 w-full sm:w-56 flex items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[240px] rounded-md border bg-background shadow-lg">
          <div className="relative p-2 border-b">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search employee…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
              className="h-8 pl-8"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {includeMyself && (
              <button
                type="button"
                onClick={() => select(MYSELF)}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-sm text-left hover:bg-muted transition-colors',
                  value === MYSELF && 'bg-muted font-medium',
                )}
              >
                Myself
              </button>
            )}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-muted-foreground">No employees found.</p>
            )}
            {filtered.map((e) => (
              <button
                key={e.userId}
                type="button"
                onClick={() => select(e.userId)}
                className={cn(
                  'flex w-full items-center px-3 py-2 text-sm text-left hover:bg-muted transition-colors',
                  value === e.userId && 'bg-muted font-medium',
                )}
              >
                {e.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Today Status Card (elapsed work timer + toggle check-in/out) ─────────────

// Only ticks while `enabled` — avoids a needless per-second re-render when there
// is no running session to time (before check-in / after check-out).
function useLiveClock(enabled: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Renders a decimal hours value (e.g. 7.83) as "7h 50m" — hours + minutes only,
// never decimals. Used for both the summary card and the per-row table column.
function formatHoursMinutes(decimalHours: number): string {
  const totalMinutes = Math.round(decimalHours * 60);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${pad2(minutes)}m`;
}

// e.g. formatDuration(8482000, true) -> "02h 21m 22s"; with seconds=false -> "02h 21m"
function formatDuration(ms: number, withSeconds: boolean): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return withSeconds
    ? `${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`
    : `${pad2(hours)}h ${pad2(minutes)}m`;
}

type PendingAction = 'check-in' | 'check-out' | null;

interface ConfirmActionModalProps {
  action:    'check-in' | 'check-out';
  isLoading: boolean;
  onCancel:  () => void;
  onConfirm: () => void;
}

function ConfirmActionModal({ action, isLoading, onCancel, onConfirm }: ConfirmActionModalProps) {
  const isCheckIn = action === 'check-in';
  const Icon = isCheckIn ? LogIn : LogOut;

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl border shadow-xl w-full max-w-sm p-6 space-y-5 text-center">
        <div className={cn(
          'mx-auto flex h-14 w-14 items-center justify-center rounded-full',
          isCheckIn ? 'bg-green-500/10' : 'bg-red-500/10',
        )}>
          <Icon className={cn('h-7 w-7', isCheckIn ? 'text-green-600' : 'text-red-600')} />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Are you sure?</h2>
          <p className="text-sm text-muted-foreground">
            Do you want to {isCheckIn ? 'check in' : 'check out'} now?
          </p>
        </div>
        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            className={cn('flex-1 text-white', isCheckIn ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700')}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Please wait…' : isCheckIn ? 'Yes, Check In' : 'Yes, Check Out'}
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}

interface TodayStatusCardProps {
  todayRow:    AttendanceRecord | undefined;
  onCheckIn:   () => void;
  onCheckOut:  () => void;
  checkingIn:  boolean;
  checkingOut: boolean;
}

function TodayStatusCard({ todayRow, onCheckIn, onCheckOut, checkingIn, checkingOut }: TodayStatusCardProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const hasCheckedIn  = !!todayRow?.checkIn;
  const hasCheckedOut = !!todayRow?.checkOut;
  const isBusy        = checkingIn || checkingOut;
  const isRunning      = hasCheckedIn && !hasCheckedOut;

  const clock = useLiveClock(isRunning);

  const statusText = hasCheckedOut
    ? `Checked Out at ${formatTime(todayRow?.checkOut ?? null)}`
    : hasCheckedIn
      ? `Checked In at ${formatTime(todayRow?.checkIn ?? null)}`
      : 'Not Checked In Today';

  const elapsedMs = isRunning && todayRow?.checkIn
    ? clock.getTime() - new Date(todayRow.checkIn).getTime()
    : hasCheckedOut && todayRow?.checkIn && todayRow?.checkOut
      ? new Date(todayRow.checkOut).getTime() - new Date(todayRow.checkIn).getTime()
      : 0;

  function handleConfirm() {
    if (pendingAction === 'check-in') onCheckIn();
    else if (pendingAction === 'check-out') onCheckOut();
    setPendingAction(null);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6 space-y-5">
      {/*
        Single horizontal row on desktop, stacked only on truly narrow (phone) widths.
        NB: `sm:` (640px) is a *viewport* breakpoint, not a container one — with the
        256px sidebar visible (md+, i.e. >=768px viewport) the card's actual available
        width can drop below 640px well before the viewport does, so `sm:flex-row`
        silently falls back to the stacked layout on ordinary laptop windows. Row is
        the default here; only viewports under 480px (true mobile) stack.
      */}
      <div className="flex flex-row flex-nowrap items-start justify-between gap-4 max-[480px]:flex-col max-[480px]:items-stretch">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</p>
          <p className="text-xl font-bold mt-0.5 truncate">{statusText}</p>
        </div>
        <button
          type="button"
          onClick={() => setPendingAction(hasCheckedIn ? 'check-out' : 'check-in')}
          disabled={hasCheckedOut || isBusy}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 self-start shrink-0 whitespace-nowrap h-9 px-5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            isRunning
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-white text-green-600 border border-green-600 hover:bg-green-50',
          )}
        >
          {isRunning ? <LogOut className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {checkingIn ? 'Checking in…' : checkingOut ? 'Checking out…' : isRunning ? 'Check Out' : 'Check In'}
        </button>
      </div>

      {/* Running elapsed timer / final worked duration — hidden before check-in */}
      {isRunning && (
        <div className="rounded-lg border border-slate-200 py-6 flex flex-col items-center justify-center">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748B' }}>Running Timer</p>
          <p
            className="mt-1 text-4xl sm:text-[42px] tabular-nums leading-none"
            style={{ color: '#000000', fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            {formatDuration(elapsedMs, true)}
          </p>
        </div>
      )}
      {hasCheckedOut && (
        <div className="rounded-lg border border-slate-200 py-6 flex flex-col items-center justify-center">
          <p className="text-xs font-medium uppercase tracking-wide" style={{ color: '#64748B' }}>Worked Today</p>
          <p
            className="mt-1 text-4xl sm:text-[42px] tabular-nums leading-none"
            style={{ color: '#000000', fontWeight: 700, letterSpacing: '-0.02em' }}
          >
            {formatDuration(elapsedMs, false)}
          </p>
        </div>
      )}

      {pendingAction && (
        <ConfirmActionModal
          action={pendingAction}
          isLoading={isBusy}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

// ─── Edit Modal (Hospital Admin / Admin / Manager / HR only) ──────────────────

interface DateParts {
  year:  number;
  month: number; // 0-based, matches Date constructor
  day:   number;
}

// The record's calendar day, fixed for the life of the modal — an attendance
// record belongs to a single day, so only its check-in/out *times* are editable.
// Derived from whichever timestamp already exists on the record (preserving the
// exact local day it was recorded on); falls back to the UTC-based attendanceDate
// key when neither timestamp is set yet.
function getRecordDateParts(record: AttendanceRecord): DateParts {
  const source = record.checkIn ?? record.checkOut;
  if (source) {
    const d = new Date(source);
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
  }
  const d = new Date(`${record.attendanceDate}T00:00:00.000Z`);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}

function toTimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Combines a fixed calendar day with an "HH:MM" time-of-day into a full ISO timestamp.
function fromTimeLocal(time: string, date: DateParts): string | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(date.year, date.month, date.day, hours, minutes, 0, 0).toISOString();
}

// A time <Input> with a themed clock glyph pinned to the right edge (the
// native browser icon is hidden via the `.time-input` rule in globals.css so
// only this one shows), matching the compact, single-icon look of the rest
// of the form controls.
//
// Selection is restricted to the native picker dialog — typing/arrow-key
// editing of the segments is blocked (see blockKeyboardEntry) and both the
// field and the icon call showPicker() on click, so the dialog is the only
// way to set a value. Enter/Space also open it, for keyboard-only users who
// tab to the field. onChange (fired by the native picker) is untouched, so
// state/validation/submit behavior is unchanged.
interface TimeFieldProps {
  id:       string;
  label:    string;
  value:    string;
  onChange: (value: string) => void;
}

function TimeField({ id, label, value, onChange }: TimeFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    try {
      el?.showPicker?.();
    } catch {
      // showPicker() throws if called outside a user gesture or if unsupported
      // (older Firefox/Safari) — the native indicator underneath the themed
      // icon (see .time-input in globals.css) still works as a fallback there.
    }
  }

  function blockKeyboardEntry(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') return; // keep keyboard focus navigation working
    e.preventDefault();
    if (e.key === 'Enter' || e.key === ' ') openPicker();
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          type="time"
          step={60}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={blockKeyboardEntry}
          onClick={openPicker}
          className="time-input pr-9 cursor-pointer caret-transparent"
        />
        <Clock3
          onClick={openPicker}
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground cursor-pointer"
        />
      </div>
    </div>
  );
}

interface EditAttendanceModalProps {
  record:  AttendanceRecord;
  onClose: () => void;
}

function EditAttendanceModal({ record, onClose }: EditAttendanceModalProps) {
  const dateParts = useMemo(() => getRecordDateParts(record), [record]);

  const [checkIn,  setCheckIn]  = useState(toTimeLocal(record.checkIn));
  const [checkOut, setCheckOut] = useState(toTimeLocal(record.checkOut));
  const [error, setError]       = useState<string | null>(null);
  const [updateAttendance, { isLoading }] = useUpdateAttendanceMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateAttendance({
        attendanceId: record.attendanceId!,
        checkIn:  fromTimeLocal(checkIn, dateParts),
        checkOut: fromTimeLocal(checkOut, dateParts),
      }).unwrap();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { data?: { message?: string } })?.data?.message;
      setError(msg ?? 'Failed to update attendance.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg border shadow-lg w-full max-w-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit Attendance — {formatDate(record.attendanceDate)}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <TimeField id="edit-checkin"  label="Check In"  value={checkIn}  onChange={setCheckIn} />
          <TimeField id="edit-checkout" label="Check Out" value={checkOut} onChange={setCheckOut} />

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving…' : 'Save Changes'}</Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const profile = useAppSelector((s) => s.auth.profile);
  const role    = profile?.role;

  // SUPER_ADMIN has no tenant/self attendance — this page is not in their nav and the
  // backend does not permit them to check in/out or self-report. If reached directly,
  // only the attendance-management view (filters/table/edit) is shown, defensively.
  const isSuperAdmin  = role === 'SUPER_ADMIN';
  const isManagerRole = !!role && MANAGER_ROLES.has(role);
  const canManageOthers = isManagerRole || isSuperAdmin;
  const showStatusCard  = !isSuperAdmin;

  const [month, setMonth] = useState(CURRENT_MONTH);
  const [year,  setYear]  = useState(CURRENT_YEAR);
  // Default employee = Myself for everyone; SUPER_ADMIN has no "self" so this is
  // re-pointed at the first employee once the roster loads (see effect below).
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(MYSELF);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);

  const { data: roster } = useListEmployeeRosterQuery(undefined, { skip: !canManageOthers });

  // Roster is already tenant-scoped, active-only, and alphabetical (see
  // userRepository.findActiveRoster) — just drop the current user, who is
  // represented by the separate "Myself" option.
  const employees = useMemo(() => {
    const list = roster ?? [];
    return list
      .filter((u) => u.userId !== profile?.userId)
      .map((u) => ({ userId: u.userId, name: u.name || u.email }));
  }, [roster, profile?.userId]);

  // SUPER_ADMIN can't select "Myself" — fall back to the first employee once loaded.
  useEffect(() => {
    if (isSuperAdmin && selectedEmployeeId === MYSELF && employees.length > 0) {
      setSelectedEmployeeId(employees[0].userId);
    }
  }, [isSuperAdmin, selectedEmployeeId, employees]);

  const isViewingOther = canManageOthers && selectedEmployeeId !== MYSELF;
  const isViewingSelf  = !isSuperAdmin && !isViewingOther;

  // Always fetched (current month) so Check In / Check Out buttons reflect *today*,
  // independent of whatever month the table filter is showing.
  const { data: todayData } = useGetMyAttendanceQuery(
    { month: CURRENT_MONTH, year: CURRENT_YEAR },
    { skip: isSuperAdmin },
  );

  const {
    data: selfData,
    isLoading: selfLoading,
    refetch: refetchSelf,
  } = useGetMyAttendanceQuery({ month, year }, { skip: !isViewingSelf });

  const {
    data: employeeData,
    isLoading: employeeLoading,
    refetch: refetchEmployee,
  } = useListAttendanceQuery(
    { userId: selectedEmployeeId, month, year },
    { skip: !isViewingOther },
  );

  const [checkIn,  { isLoading: checkingIn }]  = useCheckInMutation();
  const [checkOut, { isLoading: checkingOut }] = useCheckOutMutation();

  const monthData = isViewingOther ? employeeData : selfData;
  const isLoading = isViewingOther ? employeeLoading : selfLoading;
  const records   = monthData?.records ?? [];
  const summary   = monthData?.summary ?? { totalWorkingDays: 0, daysWorked: 0, presentDays: 0, totalWorkingHours: 0 };

  const todayRow = todayData?.records[todayData.records.length - 1];

  // Admins/HR/Managers (and, defensively, Super Admin) can correct any row shown —
  // their own or another employee's.
  const canEditRows = canManageOthers;

  function refetch() {
    if (isViewingOther) refetchEmployee();
    else refetchSelf();
  }

  const colSpan = 5 + (canEditRows ? 1 : 0);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">Attendance</h1>
            <p className="text-sm text-muted-foreground">
              {isSuperAdmin ? 'Manage attendance across employees' : 'Track daily check-ins and view monthly attendance'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Today's status — live clock, check-in/out times, single toggle action. Not applicable to Super Admin. */}
      {showStatusCard && (
        <TodayStatusCard
          todayRow={todayRow}
          onCheckIn={() => checkIn()}
          onCheckOut={() => checkOut()}
          checkingIn={checkingIn}
          checkingOut={checkingOut}
        />
      )}

      {/* Summary cards — part of the personal/employee attendance view, not shown in the
          Super Admin's management-only view. "Days Worked" is intentionally omitted:
          it duplicated "Present Days" 1:1, so only the latter is kept. */}
      {!isSuperAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard icon={CalendarDays}   label="Total Working Days"  value={summary.totalWorkingDays} />
          <StatCard icon={CheckCircle2}   label="Present Days"        value={summary.presentDays} />
          <StatCard icon={Clock3}         label="Total Working Hours" value={formatHoursMinutes(summary.totalWorkingHours)} />
        </div>
      )}

      {/* Filters */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <Label htmlFor="filter-month">Month</Label>
            <select
              id="filter-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-10 w-full sm:w-40 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>{name}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5 w-full sm:w-auto">
            <Label htmlFor="filter-year">Year</Label>
            <select
              id="filter-year"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-10 w-full sm:w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {canManageOthers && (
            <div className="flex flex-col gap-1.5 w-full sm:w-auto">
              <Label htmlFor="filter-employee">Employee</Label>
              <EmployeeCombobox
                id="filter-employee"
                employees={employees}
                value={selectedEmployeeId}
                onChange={setSelectedEmployeeId}
                includeMyself={!isSuperAdmin}
              />
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Check In</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Check Out</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Total Working Hours</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              {canEditRows && (
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-24" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-16" /></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><div className="h-4 bg-muted rounded w-12" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-muted rounded w-20" /></td>
                  {canEditRows && <td className="px-4 py-3" />}
                </tr>
              ))
            )}
            {!isLoading && records.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-muted-foreground">
                  {isSuperAdmin && selectedEmployeeId === MYSELF
                    ? 'Select an employee to view attendance.'
                    : 'No attendance records for this month yet.'}
                </td>
              </tr>
            )}
            {!isLoading && records.map((r) => (
              <tr key={`${r.userId}-${r.attendanceDate}`} className="border-b hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium">{formatDate(r.attendanceDate)}</td>
                <td className="px-4 py-3">{formatTime(r.checkIn)}</td>
                <td className="px-4 py-3">{formatTime(r.checkOut)}</td>
                <td className="px-4 py-3 hidden sm:table-cell">{r.totalHours != null ? formatHoursMinutes(r.totalHours) : '—'}</td>
                <td className="px-4 py-3">{statusBadge(r.status)}</td>
                {canEditRows && (
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      {r.attendanceId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditing(r)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditAttendanceModal record={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
