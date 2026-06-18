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
  chiefComplaint: string;
  doctorIds?:     string[];
  visitDate?:     string; // YYYY-MM-DD, defaults to today
  notes?:         string;
}

export interface UpdateOPDVisitRequest {
  chiefComplaint?: string;
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

export interface OPDVisitResponse {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string;
  doctorIds:      string[];
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  chiefComplaint: string;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  createdAt:      Date;
  updatedAt:      Date;
}
