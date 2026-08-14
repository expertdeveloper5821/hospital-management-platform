import type { OPDVisitStatus } from '@/store/types';
import type { BadgeProps } from '@/components/ui/badge';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

// Single source of truth for how an OPD visit status is shown. The stored
// values stay as the API defines them (FR-07.1/07.3); only the presentation
// lives here, so the queue and the patient panel can never disagree.
//
// "OPEN" is deliberately not shown to users — it reads as a generic system
// state rather than a step in the OPD workflow.
const PRESENTATION: Record<OPDVisitStatus, { label: string; variant: BadgeVariant }> = {
  OPEN:        { label: 'Waiting',         variant: 'warning'     }, // orange — patient is in the queue
  IN_PROGRESS: { label: 'In Consultation', variant: 'info'        }, // blue   — doctor is seeing them now
  COMPLETED:   { label: 'Completed',       variant: 'success'     }, // green
  CANCELLED:   { label: 'Cancelled',       variant: 'destructive' }, // red
  NO_SHOW:     { label: 'No-show',         variant: 'secondary'   }, // grey   — day passed, never seen
};

const FALLBACK = { label: 'Unknown', variant: 'secondary' as BadgeVariant };

export function opdStatusLabel(status: OPDVisitStatus): string {
  return (PRESENTATION[status] ?? FALLBACK).label;
}

export function opdStatusVariant(status: OPDVisitStatus): BadgeVariant {
  return (PRESENTATION[status] ?? FALLBACK).variant;
}

/** A visit still on the live queue — the only states a user can act on. */
export function isOpdVisitActive(status: OPDVisitStatus): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS';
}
