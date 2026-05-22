import { z } from 'zod';

// ─── AdmissionStatus ──────────────────────────────────────────────────────────
export const AdmissionStatus = {
  ADMITTED:   'ADMITTED',
  DISCHARGED: 'DISCHARGED',
} as const;

export type AdmissionStatus = typeof AdmissionStatus[keyof typeof AdmissionStatus];

// ─── ProgressNote (embedded subdocument) ─────────────────────────────────────
export interface ProgressNote {
  noteId:    string;
  doctorId:  string;
  note:      string;
  timestamp: Date;
}

// ─── Zod Validation Schemas ───────────────────────────────────────────────────

// wardId and bedId are MongoDB ObjectId strings (24-char hex) from U3-A models
const mongoIdSchema = (field: string) =>
  z.string().min(1, `${field} is required`);

export const CreateAdmissionSchema = z.object({
  patientId:        z.string().min(1, 'patientId is required'),
  wardId:           mongoIdSchema('wardId'),
  bedId:            mongoIdSchema('bedId'),
  assignedDoctorId: mongoIdSchema('assignedDoctorId'),
});

export type CreateAdmissionInput = z.infer<typeof CreateAdmissionSchema>;

export const AddProgressNoteSchema = z.object({
  note: z.string()
    .min(1, 'Note cannot be empty')
    .max(5000, 'Note cannot exceed 5000 characters')
    .trim(),
});

export type AddProgressNoteInput = z.infer<typeof AddProgressNoteSchema>;

export const ListAdmissionsQuerySchema = z.object({
  wardId: z.string().min(1).optional(),
  status: z.enum(['ADMITTED', 'DISCHARGED']).optional().default('ADMITTED'),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAdmissionsQuery = z.infer<typeof ListAdmissionsQuerySchema>;

// ─── Response Shapes ──────────────────────────────────────────────────────────
export interface AdmissionResponse {
  admissionId:      string;
  patientId:        string;
  fullName:         string | null;
  wardId:           string;
  wardName:         string;
  bedId:            string;
  bedNumber:        string;
  assignedDoctorId: string;
  status:           AdmissionStatus;
  admissionDate:    string;
  dischargeDate:    string | null;
  progressNotes:    ProgressNote[];
}

// Unified occupancy summary (U3-A name kept; replaces the truncated BedOccupancySummaryItem)
export interface WardOccupancySummary {
  wardId:    string;
  wardName:  string;
  floor:     string | null;
  total:     number;    // total beds in ward
  occupied:  number;    // beds with isOccupied === true
  available: number;    // total - occupied; invariant: total === occupied + available
}

// ─── U3-A Ward/Bed Request Types ──────────────────────────────────────────────
export interface CreateWardRequest {
  name:   string;
  floor?: string;
}

export interface AddBedsRequest {
  bedNumbers: string[];
}

// ─── Internal Types ───────────────────────────────────────────────────────────
export interface StatusUpdate {
  status:        AdmissionStatus;
  dischargeDate: Date;
}
