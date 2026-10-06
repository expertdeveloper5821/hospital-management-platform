'use client';

import { useEffect, useRef } from 'react';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { Button } from '@/components/ui/button';
import { X, AlertTriangle } from 'lucide-react';

// ─── Doctor Active Patients Dialog ────────────────────────────────────────────
// Rendered when a doctor role change is rejected with the structured 409
// (details.code === 'DOCTOR_ACTIVE_PATIENTS', see UserService.updateUserRole
// and doctor_role_restriction_guide.md). Shows who is blocked, why (count +
// per-source breakdown), and offers Close (retry later) or View Patients
// (reassignment screen). Rendered through the shared portal-based
// DialogOverlay — never a hand-rolled fixed inset-0 div.

export interface BlockedRoleChange {
  userId:         string;
  userName:       string;
  requestedRole:  string;
  activePatients: number;
  breakdown:      { opd: number; ipd: number };
}

interface DoctorActivePatientsDialogProps {
  blocked:        BlockedRoleChange;
  onClose:        () => void;
  onGoToPatients: () => void;
}

export function DoctorActivePatientsDialog({ blocked, onClose, onGoToPatients }: DoctorActivePatientsDialogProps) {
  // Escape closes regardless of where focus sits — a portal-rendered overlay
  // cannot rely on keydown bubbling from the backdrop. Focus lands on Close so
  // keyboard users can dismiss immediately without stepping over content.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <DialogOverlay
      className="items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="doctor-block-title"
        className="bg-background rounded-lg border shadow-lg w-full max-w-md p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="doctor-block-title" className="text-base font-semibold flex items-center gap-2">
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
          <span className="font-medium text-foreground">{blocked.userName}</span> still has{' '}
          <span className="font-medium text-foreground">{blocked.activePatients}</span> active patient
          {blocked.activePatients !== 1 ? 's' : ''} and cannot be changed from{' '}
          <span className="font-mono">DOCTOR</span> to{' '}
          <span className="font-mono">{blocked.requestedRole}</span> yet.
        </p>

        <ul className="text-sm text-muted-foreground list-inside list-disc space-y-1">
          <li>
            OPD visits in queue: <span className="font-medium text-foreground tabular-nums">{blocked.breakdown.opd}</span>
          </li>
          <li>
            IPD admissions: <span className="font-medium text-foreground tabular-nums">{blocked.breakdown.ipd}</span>
          </li>
        </ul>

        <p className="text-sm text-muted-foreground">
          Reassign these patients to another doctor, then retry the role change.
        </p>

        <div className="flex justify-end gap-3">
          <Button ref={closeRef} variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={onGoToPatients}>
            View Patients
          </Button>
        </div>
      </div>
    </DialogOverlay>
  );
}
