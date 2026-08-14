export const OPDVisitStatus = {
  OPEN:        'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
  CANCELLED:   'CANCELLED',
} as const;

export type OPDVisitStatus = typeof OPDVisitStatus[keyof typeof OPDVisitStatus];

export const TERMINAL_STATUSES: ReadonlySet<OPDVisitStatus> = new Set([
  OPDVisitStatus.COMPLETED,
  OPDVisitStatus.CANCELLED,
]);

export interface CreateOPDVisitRequest {
  patientId:      string;
  doctorIds?:     string[];
  visitDate?:     string; // YYYY-MM-DD, defaults to today
  notes?:         string;
}

export interface UpdateOPDVisitRequest {
  doctorIds?:      string[];
  visitDate?:      string; // YYYY-MM-DD — triggers queue number recalculation
  diagnosis?:      string;
  prescription?:   string;
  notes?:          string;
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
  validUntil:         Date | null; // last calendar day the latest payment covers (inclusive)
  validityDays:       number;
}

export interface OPDVisitResponse {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string;
  doctorIds:      string[];
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  createdAt:      Date;
  updatedAt:      Date;
}
