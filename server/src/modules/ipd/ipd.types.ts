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

export const CreateAdmissionSchema = z.object({
  patientId:        z.string().uuid('patientId must be a UUID'),
  wardId:           z.string().uuid('wardId must be a UUID'),
  bedId:            z.string().uuid('bedId must be a UUID'),
  assignedDoctorId: z.string().uuid('assignedDoctorId must be a UUID'),
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
  wardId: z.string().uuid().optional(),
  status: z.enum(['ADMITTED', 'DISCHARGED']).optional().default('ADMITTED'),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAdmissionsQuery = z.infer<typeof ListAdmissionsQuerySchema>;

// ─── Response Shapes ──────────────────────────────────────────────────────────
export interface AdmissionResponse {
  admissionId:      string;
  patientId:        string;
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

export interface BedOccupancySummaryItem {
  wardId:    string;
  wardName:  string;
  total:     number;
  occupied:  number;
  available: number;
}

// ─── Internal Types ───────────────────────────────────────────────────────────
export interface StatusUpdate {
  status:        AdmissionStatus;
  dischargeDate: Date;
}
