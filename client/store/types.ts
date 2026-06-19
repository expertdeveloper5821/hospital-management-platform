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
  email:    string;
  tenantId: string; // required by backend schema
}
 
export interface ResetPasswordRequest {
  token:       string;
  newPassword: string;
}
 
// ─── Tenant / Branding ────────────────────────────────────────────────────────
 
/** Shape returned by GET /api/tenants/:tenantId/branding */
export interface BrandingConfig {
  logoUrl?:     string | null; // S3 presigned URL or key, may be absent
  displayName:  string;        // tenant display name
  primaryColor: string;        // hex e.g. #1A73E8
}
 
// ─── Users ────────────────────────────────────────────────────────────────────
 
export interface UserResponse {
  userId:        string;
  email:         string;
  name:          string;
  role:          UserRole;
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
 
export interface PatientResponse {
  patientId:                 string;
  fullName:                  string;
  dateOfBirth:               string;
  gender:                    Gender;
  mobileNumber:              string;
  address:                   string;
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
  dateOfBirth:               string; // YYYY-MM-DD
  gender:                    Gender;
  mobileNumber:              string;
  address:                   string;
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
  gender?:                 Gender;
  mobileNumber?:           string;
  address?:                string;
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
 
export type OPDVisitStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
 
export interface OPDVisitResponse {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string | null;
  doctorIds:      string[];
  departmentId:   string | null;
  visitDate:      string;
  queueNumber:    number;
  status:         OPDVisitStatus;
  chiefComplaint: string;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  createdAt:      string;
  updatedAt:      string;
}
 
export interface CreateOPDVisitRequest {
  patientId:      string;
  chiefComplaint: string;
  doctorIds?:     string[];
  visitDate?:     string; // YYYY-MM-DD
  notes?:         string;
}
 
export interface UpdateOPDVisitRequest {
  chiefComplaint?: string;
  doctorIds?:      string[];
  visitDate?:      string;
  diagnosis?:      string;
  prescription?:   string;
  notes?:          string;
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
  status:      LabRequestStatus;
  priority:    LabRequestPriority;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
}

export interface RadiologyRequestResponse {
  requestId:        string;
  patientId:        string;
  fullName:         string;
  tenantId:         string;
  requestedBy:      string;
  requestedByName?: string;
  imagingType:      string;
  status:      LabRequestStatus;
  priority:    LabRequestPriority;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
}

export interface CreatePathologyRequest {
  patientId: string;
  testType:  string;
  notes?:    string;
}

export interface CreateRadiologyRequest {
  patientId:   string;
  imagingType: string;
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
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
 
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
  createdBy:         string;
  createdAt:         string;
  updatedAt:         string;
}
 
export interface CreateManualPaymentRequest {
  patientId:     string;
  amount:        number;
  paymentMethod: 'CASH' | 'CHEQUE' | 'UPI' | 'CARD';
  description:   string;
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
 
export interface PaymentSummaryResponse {
  CASH:   number;
  CHEQUE: number;
  UPI:    number;
  CARD:   number;
  total:  number;
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
] as const;
 
export type AuditEntityType = typeof AuditEntityTypes[number];
 
export interface AuditLogEntry {
  auditId:        string;
  entityType:     string;
  entityId:       string;
  action:         string;
  userId:         string;
  userName?:      string;
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

// ─── Staff ID Card ────────────────────────────────────────────────────────────

export interface StaffIdCardResponse {
  userId:       string;
  s3Key:        string;
  issuedAt:     string;
  cardExpiresAt: string;
  presignedUrl: string;
  isNew:        boolean;
}

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
  createdAt:        string;
  updatedAt:        string;
}

export interface CreatePackageRequest {
  name:             string;
  description?:     string;
  price:            number;
  includedServices: string[];
}

export interface UpdatePackageRequest {
  name?:             string;
  description?:      string;
  price?:            number;
  includedServices?: string[];
  status?:           PackageStatus;
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

export type ChargeStatus = 'UNPAID' | 'VOIDED';

export interface ChargeResponse {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference: string | null;
  addedBy:            string;
  status:             ChargeStatus;
  voidedBy:           string | null;
  voidedAt:           string | null;
  createdAt:          string;
  updatedAt:          string;
}

export interface AddChargeRequest {
  patientId:           string;
  category:            ChargeCategory;
  description:         string;
  amount:              number;
  encounterReference?: string;
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

export interface DepartmentResponse {
  departmentId:  string;
  name:          string;
  description:   string | null;
  headDoctorId:  string | null;
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