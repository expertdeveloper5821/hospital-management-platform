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
  userId:       string;
  email:        string;
  name:         string;
  role:         UserRole;
  isActive:     boolean;
  isFirstLogin: boolean;
  tenantId:     string;
  createdAt:    string;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface NotificationMessage {
  id:        string;
  message:   string;
  type:      string;
  timestamp: string;
  read:      boolean;
}

// ─── Patient ──────────────────────────────────────────────────────────────────

export interface PatientResponse {
  patientId:              string;
  fullName:               string;
  dateOfBirth:            string;
  gender:                 'MALE' | 'FEMALE' | 'OTHER';
  mobileNumber:           string;
  address:                string;
  aadhaarNumber:          string | null;
  emergencyContactName:   string | null;
  emergencyContactMobile: string | null;
  bloodGroup:             string | null;
  tenantId:               string;
  createdAt:              string;
  updatedAt:              string;
}

// ─── IPD ──────────────────────────────────────────────────────────────────────

export interface WardResponse {
  wardId:    string;
  name:      string;
  floor:     string | null;
  tenantId:  string;
  createdAt: string;
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
  wardId:           string;
  wardName:         string;
  bedId:            string;
  bedNumber:        string;
  assignedDoctorId: string;
  status:           'ADMITTED' | 'DISCHARGED';
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
  assignedDoctorId: string;
}

export interface AddProgressNoteRequest {
  note: string;
}

export interface ListAdmissionsQuery {
  wardId?: string;
  status?: 'ADMITTED' | 'DISCHARGED';
  page?:   number;
  limit?:  number;
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
