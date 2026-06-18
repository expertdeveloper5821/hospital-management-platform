// ─── UserRole ────────────────────────────────────────────────────────────────
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

// ─── TenantStatus ─────────────────────────────────────────────────────────────
export const TenantStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE:               'ACTIVE',
  INACTIVE:             'INACTIVE',
} as const;

export type TenantStatus = typeof TenantStatus[keyof typeof TenantStatus];

// ─── JWTPayload ───────────────────────────────────────────────────────────────
export interface JWTPayload {
  userId:       string;
  tenantId:     string | null; // null for SUPER_ADMIN
  role:         UserRole;
  email:        string;
  isFirstLogin: boolean;
  exp?:         number;
  iat?:         number;
}

// ─── PaginatedResult ──────────────────────────────────────────────────────────
export interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number; // always Math.ceil(total / limit)
}

// ─── API Response shapes ──────────────────────────────────────────────────────
export interface SuccessResponse<T> {
  status: 'success';
  data:   T;
}

export interface ErrorResponse {
  status:   'error';
  message:  string;
  details?: Record<string, unknown>;
}

// ─── AuditEntityType ──────────────────────────────────────────────────────────
export const AuditEntityType = {
  PATIENT:            'PATIENT',
  OPD_VISIT:          'OPD_VISIT',
  IPD_ADMISSION:      'IPD_ADMISSION',
  PATHOLOGY_REQUEST:  'PATHOLOGY_REQUEST',
  RADIOLOGY_REQUEST:  'RADIOLOGY_REQUEST',
  INVENTORY_ITEM:     'INVENTORY_ITEM',
  PAYMENT_RECORD:     'PAYMENT_RECORD',
  USER_ACCOUNT:       'USER_ACCOUNT',
  TENANT:             'TENANT',
  AUTH:               'AUTH',
  PLATFORM_SETTINGS:  'PLATFORM_SETTINGS',
  STAFF_ID_CARD:      'STAFF_ID_CARD',
  PACKAGE:            'PACKAGE',
  PACKAGE_ASSIGNMENT: 'PACKAGE_ASSIGNMENT',
  STAFF_DOCUMENT:     'STAFF_DOCUMENT',
  CHARGE:             'CHARGE',
} as const;

export type AuditEntityType = typeof AuditEntityType[keyof typeof AuditEntityType];

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOCKOUT'
  | 'PASSWORD_RESET';

export interface AuditLogEntry {
  entityType:     AuditEntityType;
  entityId:       string;
  action:         AuditAction;
  userId:         string;
  tenantId:       string | null;
  previousValue?: Record<string, unknown>;
  newValue?:      Record<string, unknown>;
  timestamp?:     Date;
}
