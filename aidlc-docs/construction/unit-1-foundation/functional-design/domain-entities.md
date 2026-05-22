# Domain Entities — Unit 1: Foundation (U1-A: Shared Foundation)

**Unit**: Unit 1 — Foundation  
**Stage**: Functional Design  
**Scope**: Shared TypeScript types, environment config, MongoDB connection

---

## 1. Shared TypeScript Types

All types are defined in `src/shared/types/` and exported from an index barrel file.

---

### 1.1 UserRole

**File**: `src/shared/types/common.types.ts`  
**Pattern**: `const` object with union type (Answer A1=B)

```typescript
export const UserRole = {
  SUPER_ADMIN:      'SUPER_ADMIN',
  HOSPITAL_ADMIN:   'HOSPITAL_ADMIN',
  MANAGER:          'MANAGER',
  DOCTOR:           'DOCTOR',
  NURSE:            'NURSE',
  RECEPTIONIST:     'RECEPTIONIST',
  PATHOLOGIST:      'PATHOLOGIST',
  RADIOLOGIST:      'RADIOLOGIST',
  FINANCE_MANAGER:  'FINANCE_MANAGER',
  HR:               'HR',
  ADMIN:            'ADMIN',
  STAFF:            'STAFF',
} as const;

export type UserRole = typeof UserRole[keyof typeof UserRole];
```

**Rationale**: `const` object pattern avoids TypeScript enum pitfalls (reverse mapping, numeric enum bugs) while still allowing `UserRole.DOCTOR` usage at call sites. The union type enables exhaustive switch checks.

**Constraints**:
- `SUPER_ADMIN` has no `tenantId` — stored in `super_admins` collection
- All other roles are tenant-scoped

---

### 1.2 TenantStatus

**File**: `src/shared/types/common.types.ts`  
**Pattern**: `const` object with union type (Answer A2=B)

```typescript
export const TenantStatus = {
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE:               'ACTIVE',
  INACTIVE:             'INACTIVE',
} as const;

export type TenantStatus = typeof TenantStatus[keyof typeof TenantStatus];
```

**State transitions**:
```
PENDING_VERIFICATION --> ACTIVE      (Super Admin approves)
ACTIVE               --> INACTIVE    (Super Admin deactivates)
INACTIVE             --> ACTIVE      (Super Admin reactivates — future)
```

**Business rule**: When a tenant transitions to `INACTIVE`, all login attempts for users of that tenant MUST be rejected by `scopeTenant` middleware.

---

### 1.3 JWTPayload

**File**: `src/shared/types/common.types.ts`  
**Fields**: userId, tenantId, role, email, isFirstLogin, exp (Answer A3=C)

```typescript
export interface JWTPayload {
  userId:       string;
  tenantId:     string | null;  // null for SUPER_ADMIN
  role:         UserRole;
  email:        string;
  isFirstLogin: boolean;
  exp?:         number;         // set by JWT library on sign
  iat?:         number;         // set by JWT library on sign
}
```

**Field rationale**:
- `tenantId: string | null` — Super Admin tokens carry `null`; all tenant user tokens carry the tenant's MongoDB ObjectId as string
- `email` — enables audit log entries without a DB lookup
- `isFirstLogin` — enables `requireFirstPasswordChange` middleware to block access without a DB round-trip
- `exp` / `iat` — standard JWT claims, set by the signing library

**Business rules**:
- JWT signed with `JWT_SECRET`, expiry `JWT_EXPIRY` (default 8h)
- Invite link tokens signed with `INVITE_JWT_SECRET`, expiry `INVITE_JWT_EXPIRY` (default 48h)
- Password reset tokens: short-lived, stored as hashed token in DB (not JWT)

---

### 1.4 PaginatedResult\<T\>

**File**: `src/shared/types/common.types.ts`  
**Fields**: data, total, page, limit, totalPages (Answer A4=B)

```typescript
export interface PaginatedResult<T> {
  data:       T[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;  // Math.ceil(total / limit)
}
```

**Business rule**: `totalPages` MUST always equal `Math.ceil(total / limit)`. This is a computed invariant — callers must not set it independently.

**PBT property**: `totalPages = ceil(total / limit)` holds for all valid (total ≥ 0, limit ≥ 1) inputs.

---

### 1.5 SuccessResponse\<T\>

**File**: `src/shared/types/common.types.ts`

```typescript
export interface SuccessResponse<T> {
  status: 'success';
  data:   T;
}
```

---

### 1.6 ErrorResponse

**File**: `src/shared/types/common.types.ts`

```typescript
export interface ErrorResponse {
  status:   'error';
  message:  string;
  details?: Record<string, unknown>;
}
```

**Business rule**: Production responses MUST NOT include stack traces or internal paths in `details`. Development may include stack trace in `details.stack`.

---

### 1.7 AuditEntityType

**File**: `src/shared/types/common.types.ts`  
**Scope**: 8 FR-14 entities + TENANT + AUTH (Answer A5=C)

```typescript
export const AuditEntityType = {
  PATIENT:             'PATIENT',
  OPD_VISIT:           'OPD_VISIT',
  IPD_ADMISSION:       'IPD_ADMISSION',
  PATHOLOGY_REQUEST:   'PATHOLOGY_REQUEST',
  RADIOLOGY_REQUEST:   'RADIOLOGY_REQUEST',
  INVENTORY_ITEM:      'INVENTORY_ITEM',
  PAYMENT_RECORD:      'PAYMENT_RECORD',
  USER_ACCOUNT:        'USER_ACCOUNT',
  TENANT:              'TENANT',   // branding updates, lifecycle changes
  AUTH:                'AUTH',     // login, lockout, password reset events
} as const;

export type AuditEntityType = typeof AuditEntityType[keyof typeof AuditEntityType];
```

---

### 1.8 AuditLogEntry

**File**: `src/shared/types/common.types.ts`  
**Used by**: AuditService stub (D4=C — single object parameter)

```typescript
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'LOCKOUT' | 'PASSWORD_RESET';

export interface AuditLogEntry {
  entityType:     AuditEntityType;
  entityId:       string;
  action:         AuditAction;
  userId:         string;
  tenantId:       string | null;
  previousValue?: Record<string, unknown>;
  newValue?:      Record<string, unknown>;
  timestamp?:     Date;  // defaults to new Date() if not provided
}
```

---

### 1.9 RBAC Types

**File**: `src/shared/types/rbac.types.ts`

```typescript
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RolePermission {
  role:     UserRole;
  resource: string;   // e.g., 'patients', 'opd/visits'
  methods:  HttpMethod[];
}
```

---

## 2. Environment Configuration Entity

**File**: `src/shared/config/env.ts`  
**Validation**: `dotenv-safe` (Answer B1=C)

### 2.1 Env Schema

```
# .env.example (committed to repo — no secrets)

# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=

# JWT
JWT_SECRET=
JWT_EXPIRY=8h
INVITE_JWT_SECRET=
INVITE_JWT_EXPIRY=48h
RESET_TOKEN_EXPIRY=1h

# Email (SMTP)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# AWS S3
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=

# CORS
CORS_ORIGINS=http://localhost:3001

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

**Note**: `CORS_ORIGINS` added to support comma-separated origins (Answer E2=B). Not in original list (B2=A) but required by E2 decision.

### 2.2 Typed Config Object

```typescript
export interface AppConfig {
  port:                  number;
  nodeEnv:               'development' | 'production' | 'test';
  mongodbUri:            string;
  jwtSecret:             string;
  jwtExpiry:             string;
  inviteJwtSecret:       string;
  inviteJwtExpiry:       string;
  resetTokenExpiry:      string;
  smtp: {
    host:   string;
    port:   number;
    user:   string;
    pass:   string;
    from:   string;
  };
  aws: {
    region:          string;
    accessKeyId:     string;
    secretAccessKey: string;
    s3BucketName:    string;
  };
  corsOrigins:           string[];  // parsed from comma-separated CORS_ORIGINS
  rateLimit: {
    windowMs:    number;
    maxRequests: number;
  };
}
```

**Business rules**:
- `dotenv-safe` validates all required vars are present at startup; missing vars cause immediate process exit with a descriptive error listing all missing keys
- `SMTP_PASS`, `JWT_SECRET`, `AWS_SECRET_ACCESS_KEY` MUST NOT appear in logs (SECURITY-03)
- `corsOrigins` is parsed by splitting `CORS_ORIGINS` on `,` and trimming whitespace

---

## 3. MongoDB Connection Entity

**File**: `src/shared/config/database.ts`

### 3.1 Connection Lifecycle

```
Application Start
    |
    v
connectDatabase()
    |
    +-- mongoose.connect(MONGODB_URI, options)
    |
    +-- on 'connected': log "MongoDB connected"
    |
    +-- on 'error': log error, process.exit(1)
    |
    +-- on 'disconnected': log warning
    v
Server starts listening (only after connection resolves)
```

### 3.2 Connection Options

```typescript
const mongooseOptions = {
  maxPoolSize:        10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS:    45000,
};
```

**Business rules**:
- Server MUST NOT start listening until MongoDB connection is established
- Connection errors at startup cause `process.exit(1)` (fail closed — SECURITY-15)
- Graceful shutdown closes the Mongoose connection before process exit (Answer E3=C)

---
