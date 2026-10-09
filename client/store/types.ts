// Mirrors server contracts — kept in sync manually with server/src/shared/types and module types
 
export const UserRole = {
  SUPER_ADMIN:     'SUPER_ADMIN',
  HOSPITAL_ADMIN:  'HOSPITAL_ADMIN',
  MANAGER:         'MANAGER',
  DOCTOR:          'DOCTOR',
  NURSE:           'NURSE',
  RECEPTIONIST:    'RECEPTIONIST',
  PATHOLOGIST:     'PATHOLOGIST',
  RADIOLOGIST:     'RADIOLOGIST',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
  HR:              'HR',
  ADMIN:           'ADMIN',
  STAFF:           'STAFF',
} as const;
 
export type UserRole = typeof UserRole[keyof typeof UserRole];
 
// ─── Auth ─────────────────────────────────────────────────────────────────────
 
/** Shape returned by POST /api/auth/login */
export interface LoginApiResponse {
  token:        string;
  userId:       string;
  role:         UserRole;
  isFirstLogin: boolean;
}
 
/** Shape returned by GET /api/auth/me or GET /api/super-admin/me */
export interface MeResponse {
  userId:        string;
  email:         string;
  role:          UserRole;
  tenantId:      string | null;
  isFirstLogin?: boolean; // absent for SUPER_ADMIN (no first-login requirement)
}
 
export interface LoginRequest {
  email:        string;
  password:     string;
  tenantId?:    string;
  isSuperAdmin?: boolean;
}
 
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword:     string;
}
 
export interface ForgotPasswordRequest {
  email: string;
}
 
export interface ResetPasswordRequest {
  token:       string;
  newPassword: string;
}
 
// ─── Tenant / Branding ────────────────────────────────────────────────────────
 
/**
 * Shape returned by GET /api/tenants/:tenantId/branding.
 * Also carries the hospital's registered address/contact info (from
 * onboarding) so printouts/letterheads can render real tenant data — no
 * phone/website fields exist on the tenant record, so none are included.
 */
export interface BrandingConfig {
  logoUrl?:            string | null; // S3 presigned URL or key, may be absent
  displayName:         string;        // tenant display name
  primaryColor:        string;        // hex e.g. #1A73E8
  addressLine?:        string;
  city?:               string;
  state?:              string;
  pincode?:            string;
  contactEmail?:       string;
  // Hospital-supplied OPD/IPD prescription slip background (presigned URL).
  // Already contains the hospital name, logo, address and header details —
  // OPD/IPD print pages must not render their own header block when set.
  parchaTemplateUrl?:  string | null;
}
 
// ─── Users ────────────────────────────────────────────────────────────────────
 
export interface UserResponse {
  userId:        string;
  email:         string;
  name:          string;
  role:          UserRole;
  /** Uttarakhand Medical Council Registration No. — set only for DOCTOR role, else null. */
  ukmcNo:        string | null;
  departmentIds: string[];
  isActive:      boolean;
  isFirstLogin:  boolean;
  tenantId:      string;
  createdAt:     string;
}
 
// ─── Notifications ────────────────────────────────────────────────────────────
 
export interface NotificationMessage {
  id:          string;
  title:       string;
  message:     string;
  type:        string;
  entityType?: string | null;
  entityId?:   string | null;
  timestamp:   string;
  read:        boolean;
}
 
// ─── Patient ──────────────────────────────────────────────────────────────────
 
export type Gender     = 'MALE' | 'FEMALE' | 'OTHER';
export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
export type AgeUnit    = 'YEARS' | 'MONTHS' | 'DAYS';
 
export interface PatientResponse {
  patientId:                 string;
  fullName:                  string;
  dateOfBirth:               string | null;
  age:                       number | null;
  ageUnit?:                  AgeUnit;
  gender:                    Gender;
  mobileNumber:              string;
  address:                   string;
  addressLine1:              string | null;
  addressLine2:              string | null;
  city:                      string | null;
  state:                     string | null;
  country:                   string | null;
  pincode:                   string | null;
  aadhaarNumber:             string | null;
  emergencyContactName:      string | null;
  emergencyContactMobile:    string | null;
  bloodGroup:                BloodGroup | null;
  departmentId:              string | null;
  registrationFee:           number | null;
  registrationPaymentMethod: string | null;
  tenantId:                  string;
  createdAt:                 string;
  updatedAt:                 string;
}
 
export interface CreatePatientRequest {
  fullName:                  string;
  dateOfBirth?:              string; // YYYY-MM-DD
  age:                       number;
  ageUnit?:                  AgeUnit;
  gender:                    Gender;
  mobileNumber:              string;
  address:                   string;
  addressLine1?:             string;
  addressLine2?:             string;
  city?:                     string;
  state?:                    string;
  country?:                  string;
  pincode?:                  string;
  aadhaarNumber?:            string;
  emergencyContactName?:     string;
  emergencyContactMobile?:   string;
  bloodGroup?:               BloodGroup;
  departmentId?:             string;
  registrationFee?:          number;
  registrationPaymentMethod?: string;
  forceCreate?:              boolean;
}
 
export interface UpdatePatientRequest {
  fullName?:               string;
  dateOfBirth?:            string;
  age?:                    number;
  ageUnit?:                AgeUnit;
  gender?:                 Gender;
  mobileNumber?:           string;
  address?:                string;
  addressLine1?:           string;
  addressLine2?:           string;
  city?:                   string;
  state?:                  string;
  country?:                string;
  pincode?:                string;
  aadhaarNumber?:          string;
  emergencyContactName?:   string;
  emergencyContactMobile?: string;
  bloodGroup?:             BloodGroup;
  departmentId?:           string | null;
}
 
export interface PatientSearchResult {
  data:  PatientResponse[];
  total: number;
  page:  number;
  limit: number;
}
 
// ─── OPD ──────────────────────────────────────────────────────────────────────
 
export type OPDVisitStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
 
// OPD Vitals — recorded via the OPD View → Edit form only (see
// server opd.types.ts's OPDVitals for the field/unit contract). One stored
// shape supports pediatric and non-pediatric sets; new pediatric fields are
// optional for compatibility with older API responses.
export interface OPDVitals {
  weight:          number | null;
  height:          number | null;
  bloodPressure:   string | null;
  sugar:           number | null;
  bodyTemperature: number | null;
  spo2:            number | null;
  pulse:           number | null;
  respiratoryRate?: number | null;
  headCircumference?: number | null;
}

export interface OPDVisitResponse {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string | null;
  doctorIds:      string[];
  nurseIds:       string[];
  departmentId:   string | null;
  visitDate:      string;
  queueNumber:    number;
  status:         OPDVisitStatus;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  vitals:         OPDVitals;
  // Slip Valid Till (00:00 IST of the last valid day). GET /api/opd/visits/:id
  // always resolves it; list rows only carry the value saved at completion.
  validTill?:     string | null;
  createdAt:      string;
  updatedAt:      string;
}

export interface CreateOPDVisitRequest {
  patientId:      string;
  doctorIds?:     string[];
  nurseIds?:      string[]; // optional OPD nurse assignment(s)
  departmentId?:  string; // department picked on the form (Pediatric / Non-Pediatric pick the vitals set)
  visitDate?:     string; // YYYY-MM-DD
  notes?:         string;
}

// One nurse already mapped to a doctor for OPD duty — see server
// opd.types.ts's AssignedOpdNurse for the authoritative shape/semantics.
export interface AssignedOpdNurse {
  nurseId:     string;
  nurseName:   string | null;
  isAvailable: boolean;
}

// All nurses currently mapped to a doctor for OPD duty (a doctor can have
// more than one) — see server opd.types.ts's DoctorNurseAssignmentsResponse.
export interface DoctorNurseAssignmentsResponse {
  doctorId: string;
  nurses:   AssignedOpdNurse[];
}

// GET /api/opd/nurses/available — deliberately slimmer than UserResponse;
// the endpoint never returns role/departmentIds/etc, only what the Assign
// Nurse dropdown needs.
export interface AvailableOpdNurseResponse {
  userId: string;
  name:   string;
  email:  string;
}

export interface UpdateOPDVisitRequest {
  patientId?:      string;   // Receptionist-only
  doctorIds?:      string[];
  nurseIds?:       string[]; // Receptionist-only
  departmentId?:   string;   // explicit department change
  visitDate?:      string;
  diagnosis?:      string;
  prescription?:   string;
  notes?:          string;
  // Partial — only the sub-fields present are merged onto the visit's
  // existing vitals server-side (see OPDService.updateVisit); omitting a
  // sub-field leaves it untouched, sending `null` explicitly clears it.
  vitals?:         Partial<OPDVitals>;
}
 
export interface CompleteOPDVisitRequest {
  diagnosis:     string;
  prescription?: string;
  notes?:        string;
}
 
export interface OPDPatientHistory {
  data:       OPDVisitResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// Backend-authoritative answer to "does this patient need to pay for OPD
// again right now?" — see OPDService.getPaymentValidity. Doctor-specific:
// DIFFERENT_DOCTOR means the patient has a completed OPD payment, but not
// for the currently-selected doctor(s). Never compute this on the frontend;
// always read it from GET .../payment-validity.
export type OPDPaymentValidityReason = 'NO_PAYMENT' | 'EXPIRED' | 'VALID' | 'DIFFERENT_DOCTOR';

export interface OPDPaymentValidityResponse {
  patientId:         string;
  paymentRequired:   boolean;
  reason:            OPDPaymentValidityReason;
  latestPaymentId:   string | null;
  latestPaymentDate: string | null;
  validUntil:        string | null;
  validityDays:      number;
}

// ─── Lab ──────────────────────────────────────────────────────────────────────

export type LabRequestStatus   = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type LabRequestPriority = 'NORMAL' | 'URGENT';

export interface PathologyRequestResponse {
  requestId:        string;
  patientId:        string;
  fullName:         string;
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
  // The request's COMPLETED payment; null/absent = Unpaid (absent on
  // offline-created requests not yet synced).
  payment?:    LabPaymentSummary | null;
  // Billing charge this request was created from — its payment is collected
  // in Billing (Mark Paid), never via Lab's Collect Payment.
  chargeId?:   string | null;
  // Linked OPD visit / IPD admission — returned by the single-request GET only.
  encounter?:  LabEncounterSummary | null;
  // Structured per-test reports (one per test in testType, in order) —
  // returned by the single-request GET only.
  testReports?: PathologyTestReport[];
}

// ─── Structured Pathology test reports ────────────────────────────────────────

export type PathologyResultFlag = 'HIGH' | 'LOW' | 'ABNORMAL';

// One parameter of a test's report-entry form (referenceRange is already
// resolved for the patient's gender).
export interface PathologyReportField {
  key:            string;
  name:           string;
  unit:           string | null;
  inputType:      'number' | 'text' | 'select';
  section:        string | null;
  options:        string[] | null;
  referenceRange: string | null;
  readOnly?:      boolean;
  calculationType?: 'calculated' | 'estimated' | 'conversion' | null;
}

// A stored (non-empty) result, unit/range snapshotted at submission.
export interface PathologyResultValue {
  key:            string;
  name:           string;
  section:        string | null;
  value:          string;
  unit:           string | null;
  referenceRange: string | null;
  flag:           PathologyResultFlag | null;
}

// ─── Pathology Test Master (per-test clinical content on the report) ─────────
export interface PathologyTestClinicalContent {
  clinicalNote:        string | null;
  comment:             string | null;
  correlateClinically: string | null;
}

// GET /api/lab/pathology/test-master
export interface PathologyTestMasterEntry extends PathologyTestClinicalContent {
  templateKey:   string;
  testName:      string;
  // false = hidden from this hospital's Test Type dropdown and rejected on new
  // requests. Existing requests/reports are unaffected.
  isEnabled:     boolean;
  updatedBy:     string | null;
  updatedByName: string | null;
  updatedAt:     string;
}

// PATCH /api/lab/pathology/test-master/:templateKey — empty clinicalNote /
// comment clears it; correlateClinically can be edited but not cleared;
// isEnabled enables / disables the test (not allowed for GENERIC).
export interface UpdatePathologyTestMasterRequest {
  clinicalNote?:        string | null;
  comment?:             string | null;
  correlateClinically?: string;
  isEnabled?:           boolean;
}

export interface PathologyTestReport {
  testIndex:   number;
  testName:    string;
  templateKey: string;
  // The test's Test Master content, as it prints on the report.
  clinicalContent?: PathologyTestClinicalContent;
  fields:      PathologyReportField[];
  // null until this test's report has been submitted.
  result: {
    values:          PathologyResultValue[];
    remarks:         string | null;
    // As saved with this report (what its PDF prints).
    clinicalNote:    string | null;
    comment:         string | null;
    submittedBy:     string;
    submittedByName: string;
    submittedAt:     string;
  } | null;
}

// PUT /api/lab/pathology/:requestId/reports/:testIndex — every value optional.
export interface SubmitPathologyTestReportRequest {
  testName: string;
  values:   Record<string, string | null>;
  remarks?: string | null;
  // Saved with this report only — never written back to the Test Master.
  // Empty / null clears it for this report.
  clinicalNote?: string | null;
  comment?:      string | null;
}

export interface RadiologyRequestResponse {
  requestId:        string;
  patientId:        string;
  fullName:         string;
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
  // The request's COMPLETED payment; null/absent = Unpaid (absent on
  // offline-created requests not yet synced).
  payment?:    LabPaymentSummary | null;
  // Billing charge this request was created from — its payment is collected
  // in Billing (Mark Paid), never via Lab's Collect Payment.
  chargeId?:   string | null;
  // Linked OPD visit / IPD admission — returned by the single-request GET only.
  encounter?:  LabEncounterSummary | null;
}

// The OPD visit / IPD admission a lab request was raised during.
export interface LabEncounterSummary {
  type:           'OPD' | 'IPD';
  encounterId:    string;
  date:           string; // OPD visitDate / IPD admissionDate (ISO)
  departmentName: string | null;
  doctorNames:    string[];
  wardName:       string | null; // IPD only
  bedNumber:      string | null; // IPD only
}

export interface LabPaymentSummary {
  paymentId:        string;
  amount:           number;
  paymentMethod:    PaymentMethod;
  paidAt:           string;
  receiptAvailable: boolean;
}

// POST /api/lab/{pathology|radiology}/:requestId/payment — the patient and
// payment reference are derived server-side from the lab request.
export interface CollectLabPaymentRequest {
  amount:         number;
  paymentMethod:  'CASH' | 'UPI' | 'CARD';
  transactionId?: string;
}

// 'SELF', 'OTHER:<name>' (a typed-in external referrer), or a referring
// doctor's userId — mirrors server/src/modules/lab/lab.types.ts.
export const LAB_REFERRED_BY_SELF = 'SELF';
export const LAB_REFERRED_BY_OTHER_PREFIX = 'OTHER:';

export interface CreatePathologyRequest {
  patientId:   string;
  testType:    string;
  referredBy:  string;
  notes?:      string;
}

export interface CreateRadiologyRequest {
  patientId:   string;
  imagingType: string;
  referredBy:  string;
  notes?:      string;
}

export interface EditPathologyRequest {
  testType?: string;
  notes?:    string | null;
  priority?: LabRequestPriority;
  status?:   'PENDING' | 'IN_PROGRESS';
}

export interface EditRadiologyRequest {
  imagingType?: string;
  notes?:       string | null;
  priority?:    LabRequestPriority;
  status?:      'PENDING' | 'IN_PROGRESS';
}
 
export interface LabListResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// Dynamic Pathology/Radiology test types, sourced from the Lab module — used
// by the Billing → Add Charge form's Test Type dropdown when category is LAB_TEST.
export type LabTestTypeCategory = 'PATHOLOGY' | 'RADIOLOGY';

export interface LabTestTypeResponse {
  id:       string;
  name:     string;
  category: LabTestTypeCategory;
}
 
// ─── IPD ──────────────────────────────────────────────────────────────────────
 
export type AdmissionStatus = 'ADMITTED' | 'DISCHARGED';
 
export interface WardResponse {
  wardId:           string;
  name:             string;
  floor:            string | null;
  assignedNurseIds: string[];
  tenantId:         string;
  createdAt:        string;
}
 
export interface BedResponse {
  bedId:              string;
  wardId:             string;
  bedNumber:          string;
  isOccupied:         boolean;
  currentAdmissionId: string | null;
  tenantId:           string;
  createdAt:          string;
}
 
export interface ProgressNote {
  noteId:    string;
  doctorId:  string;
  note:      string;
  timestamp: string;
  staffName: string | null;
}

// IPD Vitals — recorded via the IPD Admission View → Edit form only (see
// server ipd.types.ts's IPDVitals for the field/unit contract). One stored
// shape supports pediatric and non-pediatric sets; new pediatric fields are
// optional for compatibility with older API responses.
export interface IPDVitals {
  weight:          number | null;
  height:          number | null;
  bloodPressure:   string | null;
  sugar:           number | null;
  bodyTemperature: number | null;
  spo2:            number | null;
  pulse:           number | null;
  respiratoryRate?: number | null;
  headCircumference?: number | null;
}

export interface AdmissionResponse {
  admissionId:      string;
  patientId:        string;
  fullName:         string | null;
  wardId:           string;
  wardName:         string;
  bedId:            string;
  bedNumber:        string;
  assignedDoctorIds: string[];
  departmentId:      string | null;
  status:           AdmissionStatus;
  admissionDate:    string;
  dischargeDate:    string | null;
  progressNotes:    ProgressNote[];
  vitals:           IPDVitals;
  prescription:          string | null;
  dischargeSummaryNotes: string | null;
  packageId:             string | null;
}
 
export interface WardOccupancySummary {
  wardId:    string;
  wardName:  string;
  floor:     string | null;
  total:     number;
  occupied:  number;
  available: number;
}
 
export interface CreateAdmissionRequest {
  patientId:        string;
  wardId:           string;
  bedId:            string;
  assignedDoctorIds?: string[];
  departmentId?:    string; // department picked on the form (Pediatric / Non-Pediatric pick the vitals set)
  packageId?:       string;
}
 
export interface AddProgressNoteRequest {
  note: string;
}
 
export interface ListAdmissionsQuery {
  wardId?:  string;
  status?:  AdmissionStatus;
  search?:  string;
  page?:    number;
  limit?:   number;
}
 
export interface CreateWardRequest {
  name:   string;
  floor?: string;
}
 
export interface AddBedsRequest {
  bedNumbers: string[];
}
 
// ─── Inventory ────────────────────────────────────────────────────────────────
 
export interface InventoryItemResponse {
  itemId:            string;
  tenantId:          string;
  name:              string;
  category:          string;
  unit:              string;
  quantity:          number;
  lowStockThreshold: number;
  description:       string | null;
  isLowStock:        boolean;
  createdAt:         string;
  updatedAt:         string;
}
 
export interface CreateInventoryItemRequest {
  name:              string;
  category:          string;
  unit:              string;
  quantity:          number;
  lowStockThreshold: number;
  description?:      string;
}
 
export interface UpdateStockRequest {
  quantityChange: number;
  reason:         string;
}

export interface UpdateThresholdRequest {
  lowStockThreshold: number;
}

export interface UpdateInventoryItemRequest {
  name?:              string;
  category?:          string;
  unit?:              string;
  lowStockThreshold?: number;
  description?:       string | null;
}
 
export interface InventoryListResult {
  data:       InventoryItemResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
 
// ─── Payment ──────────────────────────────────────────────────────────────────
 
export type PaymentMethod = 'CASH' | 'CHEQUE' | 'UPI' | 'CARD';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type PaymentReferenceType = 'OPD_VISIT' | 'IPD_ADMISSION' | 'REGISTRATION';

export interface PaymentResponse {
  paymentId:         string;
  tenantId:          string;
  patientId:         string;
  fullName?:         string | null;
  amount:            number;
  paymentMethod:     PaymentMethod;
  description:       string;
  status:            PaymentStatus;
  receiptUrl:        string | null;
  razorpayOrderId:   string | null;
  razorpayPaymentId: string | null;
  referenceType:     PaymentReferenceType | null;
  referenceId:       string | null;
  transactionId:     string | null;
  createdBy:         string;
  createdAt:         string;
  updatedAt:         string;
}

export interface CreateManualPaymentRequest {
  patientId:      string;
  amount:         number;
  paymentMethod:  'CASH' | 'CHEQUE' | 'UPI' | 'CARD';
  description:    string;
  referenceType?: PaymentReferenceType;
  referenceId?:   string;
  // Optional UPI/Card reference number — only surfaced on the form for those
  // two payment modes; never required to submit a payment.
  transactionId?: string;
}
 
export interface CreateRazorpayOrderRequest {
  patientId:     string;
  amount:        number;
  paymentMethod: 'UPI' | 'CARD';
  description:   string;
}
 
export interface RazorpayOrderResponse {
  paymentId:       string;
  razorpayOrderId: string;
  amountPaise:     number;
  currency:        string;
  keyId:           string;
}
 
// GET /api/payments/export — dates are hospital (IST) calendar days, YYYY-MM-DD.
// DAILY/WEEKLY/MONTHLY anchor on `date` (default today); CUSTOM needs dateFrom/dateTo.
export type PaymentExportPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface PaymentExportRequest {
  period:    PaymentExportPeriod;
  date?:     string;
  dateFrom?: string;
  dateTo?:   string;
}

export interface PaymentSummaryResponse {
  CASH:   number;
  CHEQUE: number;
  UPI:    number;
  CARD:   number;
  total:  number;
}

export interface DepartmentRevenueBreakdown {
  opdRevenue:    number;
  ipdRevenue:    number;
  directPayment: number;
  total:         number;
}

export interface DepartmentRevenueEntry extends DepartmentRevenueBreakdown {
  departmentId: string;
  name:         string;
}

export interface DepartmentRevenueResponse {
  departments: DepartmentRevenueEntry[];
  other:       DepartmentRevenueBreakdown;
  pathologist?: DepartmentRevenueBreakdown;
  radiologist?: DepartmentRevenueBreakdown;
  grandTotal:  number;
}

export interface PaymentListResult {
  data:       PaymentResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
 
// ─── Audit ────────────────────────────────────────────────────────────────────
 
export const AuditEntityTypes = [
  'PATIENT',
  'OPD_VISIT',
  'IPD_ADMISSION',
  'PATHOLOGY_REQUEST',
  'RADIOLOGY_REQUEST',
  'INVENTORY_ITEM',
  'PAYMENT_RECORD',
  'USER_ACCOUNT',
  'TENANT',
  'AUTH',
  'STAFF_ID_CARD',
  'PACKAGE',
  'PACKAGE_ASSIGNMENT',
  'STAFF_DOCUMENT',
  'CHARGE',
  'DEPARTMENT',
  'PATHOLOGY_TEST_MASTER',
] as const;
 
export type AuditEntityType = typeof AuditEntityTypes[number];
 
export interface AuditLogEntry {
  auditId:        string;
  entityType:     string;
  entityId:       string;
  action:         string;
  userId:         string;
  userName?:      string;
  userRole?:      string;
  tenantId:       string | null;
  previousValue?: Record<string, unknown>;
  newValue?:      Record<string, unknown>;
  timestamp:      string;
}
 
export interface AuditListResult {
  data:       AuditLogEntry[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
 
// ─── Shared ───────────────────────────────────────────────────────────────────
 
export interface ApiSuccess<T> {
  status: 'success';
  data:   T;
}
 
export interface ApiError {
  status:   'error';
  message:  string;
  details?: Record<string, unknown>;
}
 
export interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// GET /api/opd/visits — one page of the queue, plus Open/Completed counts
// across every visit matching the filters. The counts are absent when the
// response is served from the offline cache (one unpaginated page).
export interface OPDQueueResult extends PaginatedResult<OPDVisitResponse> {
  openCount?:      number;
  completedCount?: number;
}

// ─── Staff ID Card ────────────────────────────────────────────────────────────

export interface StaffIdCardResponse {
  userId:       string;
  s3Key:        string;
  issuedAt:     string;
  cardExpiresAt: string;
  presignedUrl: string;
  isNew:        boolean;
}

// Public Staff ID Card QR verification (GET /api/public/staff-verification/:token).
// Every non-valid outcome has the same shape and carries no staff details.
export type StaffVerificationResponse =
  | {
      valid:        true;
      status:       'ACTIVE';
      name:         string;
      employeeId:   string; // masked — last 6 characters only
      role:         string;
      hospitalName: string;
      issuedAt:     string; // YYYY-MM-DD
      expiresAt:    string; // YYYY-MM-DD
    }
  | { valid: false; status: 'INACTIVE' };

// ─── Packages ─────────────────────────────────────────────────────────────────

export type PackageStatus    = 'ACTIVE' | 'INACTIVE';
export type AssignmentStatus = 'ACTIVE' | 'CANCELLED';

export interface PackageResponse {
  packageId:        string;
  tenantId:         string;
  name:             string;
  description:      string | null;
  price:            number;
  includedServices: string[];
  status:           PackageStatus;
  // Linked IPD ward; null for packages created before ward linking.
  wardId:           string | null;
  wardName:         string | null;
  createdAt:        string;
  updatedAt:        string;
}

export interface CreatePackageRequest {
  name:             string;
  description?:     string;
  price:            number;
  includedServices: string[];
  // Either link an existing ward or create one inline (Hospital Admin only).
  wardId?:          string;
  newWard?:         { name: string; floor?: string };
}

export interface UpdatePackageRequest {
  name?:             string;
  description?:      string;
  price?:            number;
  includedServices?: string[];
  status?:           PackageStatus;
  wardId?:           string | null;
}

export interface AssignmentResponse {
  assignmentId: string;
  tenantId:     string;
  packageId:    string;
  patientId:    string;
  assignedDate: string;
  status:       AssignmentStatus;
  assignedBy:   string;
  cancelledAt:  string | null;
  cancelledBy:  string | null;
  createdAt:    string;
  updatedAt:    string;
}

export interface AssignPackageRequest {
  packageId:    string;
  patientId:    string;
  assignedDate?: string;
}

export interface PackageListResult {
  data:       PackageResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// ─── Charges / Billing ────────────────────────────────────────────────────────

export type ChargeCategory =
  | 'CONSULTATION'
  | 'PROCEDURE'
  | 'LAB_TEST'
  | 'MEDICATION'
  | 'ROOM'
  | 'NURSING'
  | 'PACKAGE'
  | 'OTHER';

export type ChargeStatus = 'UNPAID' | 'PAID' | 'CANCELLED';

export interface ChargeResponse {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference: string | null;
  // Only populated when category === 'LAB_TEST'.
  testTypeId:         string | null;
  testTypeName:       string | null;
  // LAB_TEST only: the Lab request created alongside the charge.
  labRequestId?:      string | null;
  labRequestKind?:    'PATHOLOGY' | 'RADIOLOGY' | null;
  addedBy:            string;
  // Only the charge-list endpoint enriches these; add/pay/cancel/bill responses omit them.
  addedByName?:       string | null;
  // A PAID charge's COMPLETED payment, for the receipt download.
  paymentId?:         string | null;
  receiptAvailable?:  boolean;
  status:             ChargeStatus;
  paidBy:             string | null;
  paidAt:             string | null;
  cancelledBy:        string | null;
  cancelledAt:        string | null;
  createdAt:          string;
  updatedAt:          string;
}

export interface AddChargeRequest {
  patientId:           string;
  category:            ChargeCategory;
  description:         string;
  amount:              number;
  encounterReference?: string;
  // Required by the backend when category is 'LAB_TEST'.
  testTypeId?:         string;
  testTypeName?:       string;
}

export interface BillResponse {
  patientId:         string;
  lineItems:         ChargeResponse[];
  categorySubtotals: Record<ChargeCategory, number>;
  grandTotal:        number;
}

export interface ChargeListResult {
  data:       ChargeResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// ─── Staff Documents ──────────────────────────────────────────────────────────

export type DocumentCategory =
  | 'IDENTITY_PROOF'
  | 'ADDRESS_PROOF'
  | 'EDUCATIONAL_CERTIFICATE'
  | 'EXPERIENCE_LETTER'
  | 'OFFER_LETTER'
  | 'CONTRACT'
  | 'OTHER';

export interface StaffDocumentResponse {
  documentId:    string;
  tenantId:      string;
  userId:        string;
  category:      DocumentCategory;
  documentName:  string;
  s3Key:         string;
  uploadedBy:    string;
  presignedUrl:  string;
  createdAt:     string;
}

export interface ChecklistItem {
  category:  DocumentCategory;
  status:    'complete' | 'missing';
}
// ─── Department ───────────────────────────────────────────────────────────────

// Set on the seeded Pediatric / Non-Pediatric departments only — selecting
// one picks that vitals set for an OPD visit / IPD admission.
export type VitalsProfile = 'PEDIATRIC' | 'NON_PEDIATRIC';

export interface DepartmentResponse {
  departmentId:  string;
  name:          string;
  description:   string | null;
  headDoctorId:  string | null;
  vitalsProfile?: VitalsProfile | null;
  tenantId:      string;
  createdAt:     string;
  updatedAt:     string;
}

export interface CreateDepartmentRequest {
  name:          string;
  description?:  string;
  headDoctorId?: string;
}

export interface UpdateDepartmentRequest {
  name?:         string;
  description?:  string | null;
  headDoctorId?: string | null;
}

// ─── Attendance ─────────────────────────────────────────────────────────────

export type AttendanceStatus = 'PRESENT' | 'IN_PROGRESS' | 'ABSENT';

// Device GPS fix sent with self check-in / check-out (WGS-84 decimal degrees).
export interface GeoCoordinates {
  latitude:  number;
  longitude: number;
}

export interface AttendanceRecord {
  attendanceId:   string | null;
  userId:         string;
  employeeName?:  string; // present only on tenant-wide (all-employees) responses
  attendanceDate: string; // YYYY-MM-DD
  checkIn:        string | null;
  checkOut:       string | null;
  totalHours:     number | null;
  status:         AttendanceStatus;
}

export interface AttendanceSummary {
  totalWorkingDays:  number;
  daysWorked:        number;
  presentDays:       number;
  totalWorkingHours: number;
}

export interface AttendanceMonthResponse {
  summary: AttendanceSummary;
  records: AttendanceRecord[];
}

export interface UpdateAttendanceRequest {
  checkIn?:  string | null;
  checkOut?: string | null;
}

// Active-employee roster entry for the attendance "Employee" filter (tenant +
// isActive scoped, alphabetical — see server attendance.types.ts).
export interface EmployeeRosterEntry {
  userId: string;
  name:   string;
  email:  string;
}
