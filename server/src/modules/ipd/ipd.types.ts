import { z } from 'zod';
import { AgeUnit } from '../patient/patient.types';
import type { VitalsProfile } from '../department/department.model';
import { stripRichTextTags, sanitizeRichTextHtml } from '../../shared/utils/validation';

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

// Response shape only — staffName is resolved from the user collection at
// read time (via ProgressNote.doctorId, the creator's userId) and is never
// stored on the admission document itself.
export interface ProgressNoteResponse extends ProgressNote {
  staffName: string | null;
}

// ─── Zod Validation Schemas ───────────────────────────────────────────────────

// wardId and bedId are MongoDB ObjectId strings (24-char hex) from U3-A models
const mongoIdSchema = (field: string) =>
  z.string().min(1, `${field} is required`);

export const CreateAdmissionSchema = z.object({
  patientId:         z.string().min(1, 'patientId is required'),
  wardId:            mongoIdSchema('wardId'),
  bedId:             mongoIdSchema('bedId'),
  assignedDoctorIds: z.array(z.string().min(1)).optional(),
  // Department picked on the form — stored as-is (it decides the
  // admission's vitals set); omitted → the first doctor's department.
  departmentId:      z.string().min(1).optional(),
  // Optional. When sent, wardId must be the package's linked ward
  // (IPDService.createAdmission).
  packageId:         z.string().min(1).optional(),
});

export type CreateAdmissionInput = z.infer<typeof CreateAdmissionSchema>;

// Progress notes are stored as rich-text HTML (Tiptap) — the 5000-character
// limit applies to the visible text a user typed, not the wrapping markup,
// so the raw string is allowed a generous multiple of that for formatting
// overhead. sanitizeRichTextHtml strips any tag/CSS the editor itself would
// never produce, so a direct API request can't store unsupported HTML or CSS.
export const AddProgressNoteSchema = z.object({
  note: z.string()
    .min(1, 'Note cannot be empty')
    .max(30000, 'Note content is too large.')
    .trim()
    .refine((v) => stripRichTextTags(v).length <= 5000, 'Note cannot exceed 5000 characters')
    .transform(sanitizeRichTextHtml),
});

export type AddProgressNoteInput = z.infer<typeof AddProgressNoteSchema>;

// ─── IPD Prescription / Discharge Summary Notes ──────────────────────────────
// Plain-text clinical free-text (textarea input). Both are encrypted at rest
// (MEDICAL key — see ipd.model.ts's ENCRYPTED_IPD_FIELDS), so the length limit
// lives here on the plaintext rather than as a schema `maxlength`.
export const UpdatePrescriptionSchema = z.object({
  // Empty string clears the prescription back to null.
  prescription: z.string().trim().max(5000, 'Prescription cannot exceed 5000 characters'),
});

export type UpdatePrescriptionInput = z.infer<typeof UpdatePrescriptionSchema>;

export const DischargePatientSchema = z.object({
  dischargeSummaryNotes: z.string()
    .trim()
    .min(1, 'Discharge summary notes are required')
    .max(5000, 'Discharge summary notes cannot exceed 5000 characters'),
});

export type DischargePatientInput = z.infer<typeof DischargePatientSchema>;

// ─── IPD Vitals ──────────────────────────────────────────────────────────────
// Recorded from the IPD Admission View → Edit form only (not at admission
// creation, not on discharge) — mirrors OPD's vitals contract (see
// opd.types.ts's OPDVitals) field-for-field. Every field is independently
// optional/nullable, and any field can be cleared back to null. Units are
// fixed: weight/height/head circumference in kg/cm/cm, blood pressure as a
// "<systolic>/<diastolic>" string in mmHg, RBS (stored as sugar) in mg/dL,
// body temperature in °F, SpO2 in %, pulse in bpm and respiratory rate /min.
export interface IPDVitals {
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

export const ListAdmissionsQuerySchema = z.object({
  wardId: z.string().min(1).optional(),
  status: z.enum(['ADMITTED', 'DISCHARGED']).optional().default('ADMITTED'),
  search: z.string().max(200).trim().optional(),
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAdmissionsQuery = z.infer<typeof ListAdmissionsQuerySchema>;

// ─── Response Shapes ──────────────────────────────────────────────────────────
export interface AdmissionResponse {
  admissionId:       string;
  patientId:         string;
  fullName:          string | null;
  wardId:            string;
  wardName:          string;
  bedId:             string;
  bedNumber:         string;
  assignedDoctorIds: string[];
  departmentId:      string | null;
  status:            AdmissionStatus;
  admissionDate:     string;
  dischargeDate:     string | null;
  progressNotes:     ProgressNoteResponse[];
  vitals:            IPDVitals;
  prescription:          string | null;
  dischargeSummaryNotes: string | null;
  packageId:             string | null;
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
  status:                AdmissionStatus;
  dischargeDate:         Date;
  dischargeSummaryNotes: string;
  dischargedBy:          string;
}

// ─── Discharge Summary PDF — data contract ────────────────────────────────────
// Generated on demand (never persisted) from existing Patient/OPD/IPD/Lab/
// Payment/User/Audit records only. Any field the source data doesn't have is
// `null`/omitted here so the PDF builder can skip that line/section entirely
// rather than showing a placeholder.

export interface DischargeSummaryHospitalInfo {
  name:               string;
  logoUrl:            string | null;
  primaryColor:       string;
  address:            string | null;
  email:              string | null;
  registrationNumber: string | null; // GSTIN, from onboardingDocuments.gstNumber
}

export interface DischargeSummaryPatientInfo {
  patientId:        string;
  fullName:         string;
  age:              number;
  ageUnit:          AgeUnit;
  gender:           string;
  mobileNumber:     string;
  address:          string | null;
  registeredAt:     string;
  registeredByName: string | null;
}

export interface DischargeSummaryOpdVisit {
  visitId:        string;
  visitDate:      string;
  status:         string;
  departmentName: string | null;
  doctorNames:    string[];
  diagnosis:      string | null;
  prescription:   string | null;
  notesHtml:      string | null;
}

export interface DischargeSummaryProgressNote {
  authorName: string | null;
  authorRole: string | null;
  timestamp:  string;
  noteHtml:   string;
}

export interface DischargeSummaryAdmission {
  admissionId:          string;
  wardName:             string;
  bedNumber:             string;
  departmentName:       string | null;
  assignedDoctorNames:  string[];
  assignedNurseNames:   string[];
  admissionDate:        string;
  dischargeDate:        string;
  dischargedByName:     string | null;
  // Plain text entered at final discharge; null for admissions discharged
  // before this field existed (the PDF omits the section then).
  dischargeSummaryNotes: string | null;
  progressNotes:        DischargeSummaryProgressNote[];
  // The admission's recorded vitals; the PDF omits the section when absent
  // or when nothing was recorded.
  vitals?:              IPDVitals | null;
  // The admission department's vitals profile — picks the vitals set and
  // heading; null/absent for any other department (Non-Pediatric layout).
  vitalsProfile?:       VitalsProfile | null;
}

export interface DischargeSummaryLabRequest {
  requestId:       string;
  category:        'PATHOLOGY' | 'RADIOLOGY';
  type:            string;
  status:          string;
  priority:        string;
  requestedByName: string | null;
  departmentName:  string | null;
  requestedAt:     string;
  notesHtml:       string | null;
  reportUrl:       string | null;
}

export interface DischargeSummaryPayment {
  amount:        number;
  paymentMethod: string;
  status:        string;
  description:   string;
  createdAt:     string;
}

export interface DischargeSummaryBilling {
  payments: DischargeSummaryPayment[];
  total:    number; // sum of COMPLETED payments only
}

export interface DischargeSummaryData {
  hospital:    DischargeSummaryHospitalInfo;
  patient:     DischargeSummaryPatientInfo;
  opdVisits:   DischargeSummaryOpdVisit[];
  admission:   DischargeSummaryAdmission;
  labRequests: DischargeSummaryLabRequest[];
  billing:     DischargeSummaryBilling | null; // null: role lacks permission, or omitted at build time
  generatedAt: string;
}
