import { PaginatedResult } from '../../shared/types/common.types';

// Stored values are deliberately unchanged from FR-07.1/07.3 (`OPEN`,
// `COMPLETED`) — the queue UI relabels them (Waiting / In Consultation) without
// a data migration. NO_SHOW is the resolution for a visit nobody ever attended:
// see OPDService.expireStaleVisits.
export const OPDVisitStatus = {
  OPEN:        'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
  CANCELLED:   'CANCELLED',
  NO_SHOW:     'NO_SHOW',
} as const;

export type OPDVisitStatus = typeof OPDVisitStatus[keyof typeof OPDVisitStatus];

export const TERMINAL_STATUSES: ReadonlySet<OPDVisitStatus> = new Set([
  OPDVisitStatus.COMPLETED,
  OPDVisitStatus.CANCELLED,
  OPDVisitStatus.NO_SHOW,
]);

// Statuses a visit can still move out of — i.e. it is on the live queue. A
// visit left in one of these after its visit date has passed is stale and gets
// swept to NO_SHOW.
export const ACTIVE_STATUSES: readonly OPDVisitStatus[] = [
  OPDVisitStatus.OPEN,
  OPDVisitStatus.IN_PROGRESS,
];

export interface CreateOPDVisitRequest {
  patientId:      string;
  doctorIds?:     string[];
  nurseIds?:      string[]; // optional OPD nurse assignment(s) — see OPDService.createVisit
  // Department picked on the form — stored as-is (Pediatric / Non-Pediatric
  // pick the vitals set); omitted → resolved from the first doctor.
  departmentId?:  string;
  visitDate?:     string; // YYYY-MM-DD, defaults to today
  notes?:         string;
}

// ─── OPD Vitals ──────────────────────────────────────────────────────────────
// Recorded from the OPD View → Edit form only (not at visit creation, not on
// Complete). Every field is independently optional/nullable — a doctor/nurse
// may record only some of them, and any field can be cleared back to null.
// Vitals retain one stable API/storage shape for both age categories.
// Pediatric-only values are respiratoryRate (/min) and headCircumference (cm);
// RBS remains stored as `sugar` for compatibility. Units: weight/height/head
// circumference in kg/cm/cm, blood pressure as "<systolic>/<diastolic>" mmHg,
// RBS in mg/dL, temperature in °F, SpO2 in %, and pulse in bpm.
export interface OPDVitals {
  weight:          number | null;
  height:          number | null;
  bloodPressure:   string | null;
  sugar:           number | null;
  bodyTemperature: number | null;
  spo2:            number | null;
  pulse:           number | null;
  respiratoryRate: number | null;
  headCircumference: number | null;
}

export interface UpdateOPDVisitRequest {
  patientId?:      string;   // Receptionist-only (see opd.controller.ts)
  doctorIds?:      string[];
  nurseIds?:       string[]; // Receptionist-only (see opd.controller.ts)
  departmentId?:   string;   // explicit department change — wins over doctor re-resolution
  visitDate?:      string; // YYYY-MM-DD — triggers queue number recalculation
  diagnosis?:      string;
  prescription?:   string;
  notes?:          string;
  // Partial by design — OPDService.updateVisit merges only the sub-fields
  // present here onto the visit's existing vitals, so recording just one
  // reading never wipes out the others.
  vitals?:         Partial<OPDVitals>;
}

export interface CompleteOPDVisitRequest {
  diagnosis:     string;
  prescription?: string;
  notes?:        string;
}

// ─── OPD Payment Validity ───────────────────────────────────────────────────
// Computed by OPDService.getPaymentValidity — the authoritative answer to
// "does this patient need to pay for OPD again right now?", derived from the
// patient's latest COMPLETED OPD payment + the tenant's configured
// opdSettings.validityDays. Never derived on the frontend.
export const OPDPaymentValidityReason = {
  NO_PAYMENT:       'NO_PAYMENT',       // patient has no prior completed OPD payment at all — existing manual payment flow applies
  EXPIRED:          'EXPIRED',          // latest payment for the requested doctor(s) has passed its validity window — a new payment is required
  VALID:            'VALID',            // latest payment for the requested doctor(s) still covers today — no new payment required
  DIFFERENT_DOCTOR: 'DIFFERENT_DOCTOR', // patient has a completed OPD payment, but none tied to the requested doctor(s) — a new payment is required regardless of any other doctor's validity window
} as const;

export type OPDPaymentValidityReason = typeof OPDPaymentValidityReason[keyof typeof OPDPaymentValidityReason];

export interface OPDPaymentValidityResponse {
  patientId:         string;
  paymentRequired:   boolean;
  reason:             OPDPaymentValidityReason;
  latestPaymentId:    string | null;
  latestPaymentDate:  Date | null;
  validUntil:         Date | null; // 00:00 IST of the last calendar day the latest payment covers (inclusive)
  validityDays:       number;
}

export interface OPDVisitResponse {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string;
  doctorIds:      string[];
  nurseIds:       string[];
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  vitals:         OPDVitals;
  validTill?:     Date | null; // slip Valid Till — see OPDService.getVisitValidTill
  createdAt:      Date;
  updatedAt:      Date;
}

// GET /api/opd/visits — one page of the queue, plus Open/Completed counts
// across every visit matching the filters (not just this page).
export interface OPDQueueResult<T> extends PaginatedResult<T> {
  openCount:      number;
  completedCount: number;
}

// ─── OPD Nurse Assignment ───────────────────────────────────────────────────

export interface AvailableOpdNurseResponse {
  userId: string;
  name:   string;
  email:  string;
}

// One nurse already mapped to a doctor for OPD duty. isAvailable is false
// when that nurse has since been assigned to an IPD ward — the frontend uses
// it to flag the suggestion as stale rather than letting it be silently reused.
export interface AssignedOpdNurse {
  nurseId:     string;
  nurseName:   string | null;
  isAvailable: boolean;
}

// All nurses currently mapped to a doctor for OPD duty (a doctor can have
// more than one). Empty `nurses` means the doctor has no existing mapping.
export interface DoctorNurseAssignmentsResponse {
  doctorId: string;
  nurses:   AssignedOpdNurse[];
}
