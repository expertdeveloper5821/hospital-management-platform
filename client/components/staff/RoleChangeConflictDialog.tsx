'use client';

import { useEffect, useRef, useState } from 'react';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { Button } from '@/components/ui/button';
import { X, AlertTriangle } from 'lucide-react';

// ─── Role Change Conflict Dialog (generic) ────────────────────────────────────
// Rendered when ANY role change / deactivation is rejected with the structured
// 409 payload (details.code, see UserService.updateUserRole / deactivateUser).
// Companion to DoctorActivePatientsDialog, which keeps the doctor-specific
// affordance (View Patients); this one covers every other guard:
//   NURSE_ACTIVE_ENTRIES, WARD_ROSTER_CONFLICT, PATHOLOGY_ACTIVE_REQUEST,
//   RADIOLOGY_ACTIVE_REQUEST, FINANCE_UNRECONCILED, OPEN_PAYMENT_LEASE,
//   STAFF_ACTIVE_SESSION, LAST_ADMIN_CONFLICT, USER_INACTIVE.
// Displays the exact conflict details the backend returned — active counts,
// per-source breakdown, ids, and the stable error code — never a generic
// "something went wrong". Detail rows are data-driven: recognized fields get
// human labels, and any additional primitive detail the backend adds is
// appended automatically instead of being silently dropped.

export interface RoleChangeConflict {
  userName:      string;
  code:          string;
  message:       string;
  details:       Record<string, unknown>;
  /** Present for role changes; absent for deactivation blocks. */
  requestedRole: string | null;
}

interface DetailRow {
  label: string;
  value: string;
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

// Well-known detail keys → human labels, in the order they should appear.
// `breakdown` and `unpaidPayment` are handled specially below.
const LABELLED_KEYS: ReadonlyArray<[string, string]> = [
  ['activePatients', 'Active patients'],
  ['activeEntries',  'Active duty entries'],
  ['activeWards',    'Active ward rosters'],
  ['activeRequests', 'Active requests'],
  ['openPayments',   'Open payments'],
  ['attendanceId',   'Open attendance session'],
  ['userId',         'User ID'],
];

function buildDetailRows(conflict: RoleChangeConflict): DetailRow[] {
  const d    = conflict.details;
  const rows: DetailRow[] = [];
  const used  = new Set<string>(['code', 'userId', 'currentRole', 'requestedRole', 'stack']);

  const breakdown = d['breakdown'] as { opd?: unknown; ipd?: unknown } | undefined;
  if (breakdown && (typeof breakdown === 'object')) {
    used.add('breakdown');
    rows.push({ label: 'Breakdown', value: `OPD ${formatValue(breakdown.opd ?? 0)} · IPD ${formatValue(breakdown.ipd ?? 0)}` });
  }

  const unpaid = d['unpaidPayment'];
  if (typeof unpaid === 'boolean') {
    used.add('unpaidPayment');
    rows.push({ label: 'Any active request unpaid', value: unpaid ? 'Yes' : 'No' });
  }

  for (const [key, label] of LABELLED_KEYS) {
    if (key in d && !used.has(key)) {
      const formatted = formatValue(d[key]);
      if (formatted !== '') {
        used.add(key);
        rows.push({ label, value: formatted });
      }
    }
  }

  // Fail-visible fallback: surface any additional primitive detail the backend
  // includes rather than hiding it — the dialog must always explain itself.
  for (const [key, value] of Object.entries(d)) {
    if (used.has(key)) continue;
    const formatted = formatValue(value);
    if (formatted !== '') {
      rows.push({
        label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()),
        value: formatted,
      });
    }
  }
  return rows;
}

interface RoleChangeConflictDialogProps {
  conflict: RoleChangeConflict;
  onClose:  () => void;
}

export function RoleChangeConflictDialog({ conflict, onClose }: RoleChangeConflictDialogProps) {
  // Escape closes regardless of where focus sits — same contract as
  // DoctorActivePatientsDialog. Focus lands on Close so keyboard users can
  // dismiss immediately without stepping over content.
  //
  // DialogOverlay renders null on the first commit and mounts its portal in
  // its own effect, so a plain mount effect would run while closeRef is still
  // null (focus silently never lands). Key the effect on our own mounted
  // flag: it flips in the commit AFTER the portal's, when the ref exists.
  const closeRef = useRef<HTMLButtonElement>(null);
  const [portalMounted, setPortalMounted] = useState(false);
  useEffect(() => { setPortalMounted(true); }, []);
  useEffect(() => {
    if (!portalMounted) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [portalMounted, onClose]);

  const currentRole = formatValue(conflict.details['currentRole']);
  const rows        = buildDetailRows(conflict);

  return (
    <DialogOverlay
      className="items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="role-conflict-title"
        className="bg-background rounded-lg border shadow-lg w-full max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="role-conflict-title" className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Role change blocked
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{conflict.userName}</span>
          {currentRole !== '' && (
            <>
              {' '}(<span className="font-mono">{currentRole}</span>)
            </>
          )}
          {conflict.requestedRole ? (
            <>
              {' '}cannot be changed to <span className="font-mono">{conflict.requestedRole}</span> yet.
            </>
          ) : (
            ' cannot be deactivated.'
          )}
        </p>

        <p className="text-sm text-muted-foreground">{conflict.message}</p>

        <div className="rounded-md border bg-muted/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Conflict code</span>
            <code className="text-xs font-mono bg-background border rounded px-1.5 py-0.5" data-testid="conflict-code">
              {conflict.code}
            </code>
          </div>
          {rows.length > 0 && (
            <ul className="text-sm text-muted-foreground space-y-1">
              {rows.map((row) => (
                <li key={row.label} className="flex items-baseline justify-between gap-3">
                  <span>{row.label}</span>
                  <span className="font-medium text-foreground tabular-nums text-right break-all">{row.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}
