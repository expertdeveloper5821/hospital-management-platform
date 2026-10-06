import { z } from 'zod';
import { stripRichTextTags, sanitizeRichTextHtml } from '../../shared/utils/validation';

// Notes are stored as rich-text HTML (Tiptap) — the 2000-character limit
// applies to the visible text a user typed, not the wrapping markup, so the
// raw string is allowed a generous multiple of that for formatting overhead.
// sanitizeRichTextHtml strips any tag/CSS the editor itself would never
// produce, so a direct API request can't store unsupported HTML or CSS.
const notesMaxCheck = (v: string) => stripRichTextTags(v).length <= 2000;
const NOTES_TOO_LONG = 'Notes cannot exceed 2000 characters.';

// ─── LabRequestStatus ─────────────────────────────────────────────────────────
export const LabRequestStatus = {
  PENDING:     'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
} as const;

export type LabRequestStatus = typeof LabRequestStatus[keyof typeof LabRequestStatus];

// ─── LabRequestPriority ───────────────────────────────────────────────────────
export const LabRequestPriority = {
  NORMAL: 'NORMAL',
  URGENT: 'URGENT',
} as const;

export type LabRequestPriority = typeof LabRequestPriority[keyof typeof LabRequestPriority];

// ─── Referred By ──────────────────────────────────────────────────────────────
// 'SELF' means the requesting patient/staff referred themselves (no doctor
// referral); 'OTHER:<name>' is a free-text external referrer typed in by
// staff; any other value is the referring doctor's userId.
export const LAB_REFERRED_BY_SELF = 'SELF';
export const LAB_REFERRED_BY_OTHER_PREFIX = 'OTHER:';

// The typed referrer name for an 'OTHER:<name>' value, else null.
export function labOtherReferrerName(referredBy: string): string | null {
  return referredBy.startsWith(LAB_REFERRED_BY_OTHER_PREFIX)
    ? referredBy.slice(LAB_REFERRED_BY_OTHER_PREFIX.length).trim()
    : null;
}
const referredBySchema = z.string().min(1).max(120).trim().default(LAB_REFERRED_BY_SELF);

// ─── Pathology Schemas ────────────────────────────────────────────────────────
export const CreatePathologyRequestSchema = z.object({
  patientId:   z.string().min(1, 'patientId is required'),
  testType:    z.string().min(1, 'testType is required').max(200).trim(),
  referredBy:  referredBySchema,
  notes:       z.string().max(12000, 'Notes content is too large.').trim().refine(notesMaxCheck, NOTES_TOO_LONG).transform(sanitizeRichTextHtml).optional(),
});

export type CreatePathologyRequestInput = z.infer<typeof CreatePathologyRequestSchema>;

// ─── Radiology Schemas ────────────────────────────────────────────────────────
export const CreateRadiologyRequestSchema = z.object({
  patientId:   z.string().min(1, 'patientId is required'),
  imagingType: z.string().min(1, 'imagingType is required').max(200).trim(),
  referredBy:  referredBySchema,
  notes:       z.string().max(12000, 'Notes content is too large.').trim().refine(notesMaxCheck, NOTES_TOO_LONG).transform(sanitizeRichTextHtml).optional(),
});

export type CreateRadiologyRequestInput = z.infer<typeof CreateRadiologyRequestSchema>;

// ─── Status update ────────────────────────────────────────────────────────────
export const UpdateLabStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
});

export type UpdateLabStatusInput = z.infer<typeof UpdateLabStatusSchema>;

// ─── Edit schemas ─────────────────────────────────────────────────────────────
export const EditPathologyRequestSchema = z.object({
  testType: z.string().min(1).max(200).trim().optional(),
  notes:    z.string().max(12000, 'Notes content is too large.').trim().refine(notesMaxCheck, NOTES_TOO_LONG).transform(sanitizeRichTextHtml).nullable().optional(),
  priority: z.enum(['NORMAL', 'URGENT']).optional(),
  status:   z.enum(['PENDING', 'IN_PROGRESS']).optional(),
});

export type EditPathologyRequestInput = z.infer<typeof EditPathologyRequestSchema>;

export const EditRadiologyRequestSchema = z.object({
  imagingType: z.string().min(1).max(200).trim().optional(),
  notes:       z.string().max(12000, 'Notes content is too large.').trim().refine(notesMaxCheck, NOTES_TOO_LONG).transform(sanitizeRichTextHtml).nullable().optional(),
  priority:    z.enum(['NORMAL', 'URGENT']).optional(),
  status:      z.enum(['PENDING', 'IN_PROGRESS']).optional(),
});

export type EditRadiologyRequestInput = z.infer<typeof EditRadiologyRequestSchema>;

// ─── List query ───────────────────────────────────────────────────────────────
export const ListLabRequestsQuerySchema = z.object({
  patientId: z.string().min(1).optional(),
  search:    z.string().max(200).trim().optional(),
  status:    z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']).optional(),
  // Linked-encounter filters (IST calendar days) — matched against the OPD
  // visit / IPD admission each request was raised during, never the patient's
  // latest encounter. visitDate narrows to OPD requests; the other three to IPD.
  // date matches the encounter's own date: OPD visit date or IPD admission date.
  date:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  visitDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  admissionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  wardName:      z.string().max(100).trim().optional(),
  bedNumber:     z.string().max(50).trim().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLabRequestsQuery = z.infer<typeof ListLabRequestsQuerySchema>;

// ─── Payment collection ───────────────────────────────────────────────────────
// Same amount rules as CreateManualPaymentSchema (positive, ≤ 2 decimals,
// ≤ 10 digits). The patient, description and payment reference are derived
// server-side from the lab request — never taken from the client.
const MAX_AMOUNT_DIGITS = 10;

export const CollectLabPaymentSchema = z.object({
  amount: z.number({ required_error: 'amount is required', invalid_type_error: 'amount must be a number' })
    .positive('Amount must be greater than zero')
    .refine((val) => Math.round(val * 100) === val * 100, 'Amount cannot have more than 2 decimal places')
    .refine(
      (val) => String(val).replace(/[^0-9]/g, '').length <= MAX_AMOUNT_DIGITS,
      'Amount cannot exceed 10 digits.',
    ),
  paymentMethod: z.enum(['CASH', 'UPI', 'CARD'], {
    errorMap: () => ({ message: 'paymentMethod must be CASH, UPI, or CARD' }),
  }),
  transactionId: z.string().max(100, 'Transaction ID cannot exceed 100 characters').trim().optional(),
}).strict();

export type CollectLabPaymentInput = z.infer<typeof CollectLabPaymentSchema>;

// The request's COMPLETED payment, if any — null means Unpaid.
export interface LabPaymentSummary {
  paymentId:        string;
  amount:           number;
  paymentMethod:    string;
  paidAt:           string;
  receiptAvailable: boolean;
}

// ─── Linked OPD/IPD encounter ─────────────────────────────────────────────────
// The OPD visit / IPD admission the request was raised during. Returned only by
// the single-request GET endpoints (null when the request has no encounter).
export interface LabEncounterSummary {
  type:           'OPD' | 'IPD';
  // OPD: visitId; IPD: admissionId.
  encounterId:    string;
  // OPD: visitDate; IPD: admissionDate (ISO).
  date:           string;
  departmentName: string | null;
  doctorNames:    string[];
  // IPD only (null for OPD).
  wardName:       string | null;
  bedNumber:      string | null;
}

// ─── Structured Pathology test report ─────────────────────────────────────────
// One test of a request (addressed by its position in the split testType) is
// submitted with the values entered for its template's parameters. Every
// value is optional; empty ones are dropped. Per-parameter type checks
// (number / allowed option) happen in LabService against the template.
export const PATHOLOGY_RESULT_VALUE_MAX = 500;
export const PATHOLOGY_REPORT_REMARKS_MAX = 2000;
export const PATHOLOGY_CLINICAL_NOTE_MAX = 2000;
export const PATHOLOGY_COMMENT_MAX       = 2000;

// Empty / whitespace-only clears the field (stored as null).
const optionalReportText = (max: number, label: string) =>
  z.string().max(max, `${label} cannot exceed ${max} characters.`).trim().nullable().optional()
    .transform((v) => (v === '' ? null : v));

export const SubmitPathologyTestReportSchema = z.object({
  // The test name the form was opened for — rejected with 409 if the request's
  // tests changed since (so a result is never stored under the wrong test).
  testName: z.string().min(1).max(200).trim(),
  values:   z.record(
    z.string().max(64),
    z.string().max(PATHOLOGY_RESULT_VALUE_MAX, `Each result cannot exceed ${PATHOLOGY_RESULT_VALUE_MAX} characters.`).trim().nullable(),
  ).default({}),
  remarks:  z.string().max(PATHOLOGY_REPORT_REMARKS_MAX, `Remarks cannot exceed ${PATHOLOGY_REPORT_REMARKS_MAX} characters.`).trim().nullable().optional(),
  // This report's Clinical Notes / Comment, pre-filled in the form from the
  // Test Master and saved with the report (never written back to the master).
  // Empty clears it for this report; omitted keeps the report's saved value.
  clinicalNote: optionalReportText(PATHOLOGY_CLINICAL_NOTE_MAX, 'Clinical note'),
  comment:      optionalReportText(PATHOLOGY_COMMENT_MAX, 'Comment'),
}).strict();

export type SubmitPathologyTestReportInput = z.infer<typeof SubmitPathologyTestReportSchema>;

export type PathologyResultFlagValue = 'HIGH' | 'LOW' | 'ABNORMAL';

// A parameter of a test's report form (template + this patient's range).
export interface PathologyReportParameterField {
  key:            string;
  name:           string;
  unit:           string | null;
  inputType:      'number' | 'text' | 'select';
  section:        string | null;
  options:        string[] | null;
  referenceRange: string | null;
}

// One stored (non-empty) result value, with its unit/range snapshotted at submission.
export interface PathologyResultValue {
  key:            string;
  name:           string;
  section:        string | null;
  value:          string;
  unit:           string | null;
  referenceRange: string | null;
  flag:           PathologyResultFlagValue | null;
}

// ─── Pathology Test Master (per-test clinical content) ───────────────────────
// Printed on each test's report from the currently saved master row:
// clinicalNote → "Clinical Notes", comment → "Comment" (only when set),
// correlateClinically → the "Please Correlate Clinically" footer.
export const PATHOLOGY_CORRELATE_MAX     = 1000;

export const UpdatePathologyTestMasterSchema = z.object({
  clinicalNote: optionalReportText(PATHOLOGY_CLINICAL_NOTE_MAX, 'Clinical note'),
  comment:      optionalReportText(PATHOLOGY_COMMENT_MAX, 'Comment'),
  // Printed at the bottom of every report, so it can be edited but never cleared.
  correlateClinically: z.string().trim()
    .min(1, 'Please Correlate Clinically text is required.')
    .max(PATHOLOGY_CORRELATE_MAX, `Please Correlate Clinically text cannot exceed ${PATHOLOGY_CORRELATE_MAX} characters.`)
    .optional(),
}).strict().refine(
  (v) => v.clinicalNote !== undefined || v.comment !== undefined || v.correlateClinically !== undefined,
  'Provide at least one field to update.',
);

export type UpdatePathologyTestMasterInput = z.infer<typeof UpdatePathologyTestMasterSchema>;

export interface PathologyTestClinicalContent {
  clinicalNote:        string | null;
  comment:             string | null;
  correlateClinically: string | null;
}

export interface PathologyTestMasterResponse extends PathologyTestClinicalContent {
  templateKey:   string;
  testName:      string;
  // null on a seeded row that has never been edited.
  updatedBy:     string | null;
  updatedByName: string | null;
  updatedAt:     string;
}

export interface PathologyTestReportResponse {
  testIndex:   number;
  testName:    string;
  templateKey: string;
  // The test's Test Master content, as it prints on the report.
  clinicalContent: PathologyTestClinicalContent;
  // The structured entry form for this test.
  fields:      PathologyReportParameterField[];
  // null until the test's report has been submitted.
  result: {
    values:          PathologyResultValue[];
    remarks:         string | null;
    // As saved with this report (Test Master content for a report submitted
    // before these were editable per report) — what its PDF prints.
    clinicalNote:    string | null;
    comment:         string | null;
    submittedBy:     string;
    submittedByName: string;
    submittedAt:     string;
  } | null;
}

// ─── Response shapes ──────────────────────────────────────────────────────────
// reportUrl is a fresh pre-signed S3 URL generated at response time (null when no report yet).
export interface PathologyRequestResponse {
  requestId:        string;
  patientId:        string;
  fullName?:        string;
  tenantId:         string;
  requestedBy:      string;
  requestedByName?: string;
  testType:         string;
  referredBy:       string;
  referredByName:   string;
  status:      LabRequestStatus;
  priority:    LabRequestPriority;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
  payment:     LabPaymentSummary | null;
  // Billing charge this request was created from (its payment is collected in
  // Billing, never via the Lab collect endpoint); null for Lab-created requests.
  chargeId:    string | null;
  encounter?:  LabEncounterSummary | null;
  // Structured per-test reports — returned by the single-request GET only, one
  // entry per test in testType (in order).
  testReports?: PathologyTestReportResponse[];
}

export interface RadiologyRequestResponse {
  requestId:        string;
  patientId:        string;
  fullName?:        string;
  tenantId:         string;
  requestedBy:      string;
  requestedByName?: string;
  imagingType:      string;
  referredBy:       string;
  referredByName:   string;
  status:      LabRequestStatus;
  priority:    LabRequestPriority;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
  payment:     LabPaymentSummary | null;
  // Billing charge this request was created from (its payment is collected in
  // Billing, never via the Lab collect endpoint); null for Lab-created requests.
  chargeId:    string | null;
  encounter?:  LabEncounterSummary | null;
}

// ─── File size limits (bytes) ─────────────────────────────────────────────────
export const PATHOLOGY_REPORT_MAX_BYTES  = 10 * 1024 * 1024; // 10 MB
export const RADIOLOGY_REPORT_MAX_BYTES  = 20 * 1024 * 1024; // 20 MB

// ─── Test types (for Billing → Add Charge, category LAB_TEST) ────────────────
// Derived dynamically from the distinct testType/imagingType values already
// used in Pathology/Radiology requests — not a separate hardcoded catalog.
export type LabTestTypeCategory = 'PATHOLOGY' | 'RADIOLOGY';

export interface LabTestTypeResponse {
  id:       string;
  name:     string;
  category: LabTestTypeCategory;
}
