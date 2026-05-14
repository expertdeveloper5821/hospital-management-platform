# Code Generation Plan — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: Code Generation  
**Status**: Awaiting Approval  
**Workspace root**: `/home/technogetic/Downloads/hospital-management-platform`  
**Application code location**: `<workspace-root>/src/` and `<workspace-root>/tests/`  
**Documentation location**: `aidlc-docs/construction/unit-1-foundation/code/`

---

## Unit Context

**Stories implemented by Unit 1**:
- [ ] US-SA-01 — Hospital Onboarding (Super Admin)
- [ ] US-SA-02 — Invite Link Management (Super Admin)
- [ ] US-HA-01 — Initial Hospital Setup and Branding (Hospital Admin)
- [ ] US-HA-02 — User Account and Role Management (Hospital Admin)
- [ ] US-HR-01 — Staff Account Management (HR)
- [ ] US-ST-01 — System Identity (Staff)
- [ ] US-CC-01 — Authentication and Session Management (All Users)

**Subunits covered by this plan**:
- U1-A: Shared Foundation (this plan — all shared infrastructure)
- U1-B: Auth Module (this plan — auth business logic)
- U1-C: Tenant Module (this plan — tenant lifecycle)
- U1-D: User Module (this plan — user management)

**Dependencies**: None — Unit 1 is the foundation

---

## Execution Checklist

### Part 1: Planning
- [x] Step 1: Analyze unit design artifacts
- [x] Step 2: Determine code location and structure
- [x] Step 3: Create detailed generation plan (this document)
- [ ] Step 4: Log approval prompt in audit.md
- [ ] Step 5: Wait for user approval
- [ ] Step 6: Record approval and update progress

### Part 2: Generation
- [ ] Step 7: Project scaffold (package.json, tsconfig, jest config, .env.example, Dockerfile)
- [ ] Step 8: Shared types
- [ ] Step 9: Environment config + database connection
- [ ] Step 10: Request context (AsyncLocalStorage)
- [ ] Step 11: Shared utilities
- [ ] Step 12: AppError hierarchy + error handler middleware
- [ ] Step 13: Token denylist
- [ ] Step 14: TenantCache
- [ ] Step 15: DB guard utility
- [ ] Step 16: Shared middleware (authenticateJWT, scopeTenant, requireRole, requireFirstPasswordChange, requestLogger)
- [ ] Step 17: Email service
- [ ] Step 18: S3 service
- [ ] Step 19: WebSocket service stub
- [ ] Step 20: AuditService stub
- [ ] Step 21: Health check route
- [ ] Step 22: Auth module (model, repository, service, controller, routes)
- [ ] Step 23: Tenant module (model, repository, service, controller, routes)
- [ ] Step 24: User module (model, repository, service, controller, routes)
- [ ] Step 25: app.ts + server.ts
- [ ] Step 26: Unit tests — shared foundation (PBT + example-based)
- [ ] Step 27: Unit tests — Auth module
- [ ] Step 28: Unit tests — Tenant module
- [ ] Step 29: Unit tests — User module
- [ ] Step 30: Integration tests — Auth endpoints
- [ ] Step 31: Integration tests — Tenant endpoints
- [ ] Step 32: Integration tests — User endpoints
- [ ] Step 33: Code documentation summary

---

## Detailed Generation Steps

---

### Step 7: Project Scaffold
**Files to create**:
```
package.json
tsconfig.json
jest.config.ts
.env.example
.gitignore
Dockerfile
```

**package.json** — pinned dependencies from tech-stack-decisions.md (all versions exact, no `^`):
- All 13 production dependencies + 14 dev dependencies as documented
- Scripts: `build`, `start`, `dev`, `test`, `test:unit`, `test:integration`, `test:coverage`

**tsconfig.json** — ES2020 + CommonJS, strict mode, outDir: `./dist`, rootDir: `./src`

**jest.config.ts** — ts-jest preset, testEnvironment: node, roots: `./tests`, coverage thresholds

**.env.example** — all env vars from domain-entities.md Section 2.1 (no real values)

**.gitignore** — node_modules, dist, .env, coverage, *.js.map

**Dockerfile** — multi-stage (builder + runner), node:20-alpine, non-root hms user, HEALTHCHECK

**Story coverage**: Foundation for all 7 stories (US-SA-01 through US-CC-01)

---

### Step 8: Shared Types
**Files to create**:
```
src/shared/types/common.types.ts
src/shared/types/rbac.types.ts
src/shared/types/index.ts  (barrel export)
```

**common.types.ts** — UserRole, TenantStatus, JWTPayload, PaginatedResult<T>, SuccessResponse<T>, ErrorResponse, AuditEntityType, AuditAction, AuditLogEntry

**rbac.types.ts** — HttpMethod, RolePermission

**index.ts** — re-exports all types

**Story coverage**: All stories (types used everywhere)

---

### Step 9: Environment Config + Database Connection
**Files to create**:
```
src/shared/config/env.ts
src/shared/config/database.ts
```

**env.ts** — dotenv-safe loader, AppConfig interface, Object.freeze(config), CORS_ORIGINS split

**database.ts** — connectDatabase(), disconnectDatabase(), Mongoose event listeners, no URI logging

**Story coverage**: Foundation for all stories

---

### Step 10: Request Context
**Files to create**:
```
src/shared/config/request-context.ts
```

**request-context.ts** — AsyncLocalStorage<RequestContext>, requestContext export, getCorrelationId(), getRequestContext()

**Story coverage**: Foundation for all stories (correlation ID propagation)

---

### Step 11: Shared Utilities
**Files to create**:
```
src/shared/utils/index.ts
```

**index.ts** — generateId() (UUID v4 wrapper), formatDate() (ISO 8601)

**Story coverage**: Foundation for all stories

---

### Step 12: AppError Hierarchy + Error Handler
**Files to create**:
```
src/shared/middleware/error-handler.ts
```

**error-handler.ts** — AppError base class + 6 subclasses (ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, ServiceUnavailableError), global Express error handler (4-arg), Mongoose error classification, prod/dev response split

**Story coverage**: All stories (error handling)

---

### Step 13: Token Denylist
**Files to create**:
```
src/shared/middleware/token-denylist.ts
```

**token-denylist.ts** — Map<string, number>, addToDenylist(), isInDenylist() with lazy cleanup, Redis TODO comment

**Story coverage**: US-CC-01 (logout invalidation)

---

### Step 14: TenantCache
**Files to create**:
```
src/shared/config/tenant-cache.ts
```

**tenant-cache.ts** — TenantCache class, 60s TTL, hit/miss counters, log every 100 requests, get/set/invalidate/clear, Redis TODO comment, singleton export

**Story coverage**: All tenant-scoped stories

---

### Step 15: DB Guard Utility
**Files to create**:
```
src/shared/utils/db-guard.ts
```

**db-guard.ts** — assertDbConnected() using mongoose.connection.readyState, throws ServiceUnavailableError

**Story coverage**: All stories (DB resilience)

---

### Step 16: Shared Middleware
**Files to create**:
```
src/shared/middleware/authenticate-jwt.ts
src/shared/middleware/scope-tenant.ts
src/shared/middleware/require-role.ts
src/shared/middleware/require-first-password-change.ts
src/shared/middleware/request-logger.ts
src/shared/middleware/index.ts  (barrel export)
```

**authenticate-jwt.ts** — Bearer token extraction, JWT verify (JWT_SECRET), denylist check, req.user attachment, UnauthorizedError on failure

**scope-tenant.ts** — SUPER_ADMIN skip, TenantCache lookup, MongoDB fallback, INACTIVE → UnauthorizedError, req.tenant attachment

**require-role.ts** — variadic `...roles: UserRole[]`, ForbiddenError + AuditService.log() on 403

**require-first-password-change.ts** — isFirstLogin check, ForbiddenError if true

**request-logger.ts** — generateId() correlationId, requestContext.run(), res.on('finish') log, Date.now() timing, info/warn/error levels

**Story coverage**: US-CC-01 (auth), all stories (middleware chain)

---

### Step 17: Email Service
**Files to create**:
```
src/shared/services/email.service.ts
```

**email.service.ts** — Nodemailer transporter, sendTemplatedEmail() base, 4 typed methods (sendInviteEmail, sendWelcomeEmail, sendAccountLockEmail, sendPasswordResetEmail), HTML template functions, AppError on SMTP failure, getCorrelationId() in error logs

**Story coverage**: US-SA-01 (invite email), US-HA-02 (welcome email), US-CC-01 (account lock + password reset emails)

---

### Step 18: S3 Service
**Files to create**:
```
src/shared/services/s3.service.ts
```

**s3.service.ts** — AWS SDK v3 S3Client, uploadFile() with SSE-S3, getPresignedUrl() with expiry, extension comment for future methods, AppError on failure

**Story coverage**: US-HA-01 (logo upload)

---

### Step 19: WebSocket Service Stub
**Files to create**:
```
src/shared/services/websocket.service.ts
```

**websocket.service.ts** — initWebSocketServer(), no-op stubs (registerConnection, removeConnection, pushToUser with debug log), Redis TODO comment

**Story coverage**: Foundation for US-CC-02 (Unit 6 completes)

---

### Step 20: AuditService Stub
**Files to create**:
```
src/shared/services/audit.service.ts
```

**audit.service.ts** — log(entry: AuditLogEntry): Promise<void>, console.log stub, try/catch swallow, timestamp default, singleton export

**Story coverage**: All stories (audit logging)

---

### Step 21: Health Check Route
**Files to create**:
```
src/shared/routes/health.routes.ts
```

**health.routes.ts** — Express Router, GET /health, { status: 'ok', uptime, timestamp }

**Story coverage**: NFR-06 (uptime monitoring)

---

### Step 22: Auth Module
**Files to create**:
```
src/modules/auth/auth.types.ts
src/modules/auth/auth.model.ts
src/modules/auth/auth.repository.ts
src/modules/auth/auth.service.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.routes.ts
```

**auth.types.ts** — LoginRequest, ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest, LoginResponse, SuperAdminDocument, UserDocument (Mongoose interfaces)

**auth.model.ts** — SuperAdmin Mongoose schema + model (super_admins collection, no tenantId), User Mongoose schema + model (users collection, tenantId scoped), bcrypt pre-save hook, compound indexes

**auth.repository.ts** — AuthRepository class: findUserByEmail(), findSuperAdminByEmail(), incrementFailedAttempts(), lockAccount(), unlockAccount(), saveResetToken(), consumeResetToken(), recordPasswordChange(), findUserById() — all with assertDbConnected()

**auth.service.ts** — AuthService class:
- login(email, password, isSuperAdmin?) → LoginResponse (JWT issuance, lockout check, isFirstLogin flag)
- logout(token) → void (add to denylist)
- changePassword(userId, currentPassword, newPassword) → void (bcrypt verify + hash, isFirstLogin reset)
- forgotPassword(email) → void (reset token generation, email send)
- resetPassword(token, newPassword) → void (token consume, bcrypt hash)
- validateJWT(token) → JWTPayload
- Account lockout: 5 failures / 15 min → lock 30 min, send lock email

**auth.controller.ts** — Express request handlers for all 6 auth endpoints, Zod request validation, SuccessResponse/ErrorResponse format

**auth.routes.ts** — Express Router, rate limiter applied to login + forgotPassword + resetPassword, requireFirstPasswordChange on all except changePassword

**Story coverage**: US-CC-01 (all auth flows), US-SA-01 (Super Admin login)

---

### Step 23: Tenant Module
**Files to create**:
```
src/modules/tenant/tenant.types.ts
src/modules/tenant/tenant.model.ts
src/modules/tenant/tenant.repository.ts
src/modules/tenant/tenant.service.ts
src/modules/tenant/tenant.controller.ts
src/modules/tenant/tenant.routes.ts
```

**tenant.types.ts** — CreateTenantRequest, ApproveTenantRequest, UpdateBrandingRequest, TenantDocument, BrandingConfig, OnboardingDocuments

**tenant.model.ts** — Tenant Mongoose schema (tenantId, status, branding, onboardingDocs, inviteToken, inviteExpiry), compound indexes on status

**tenant.repository.ts** — TenantRepository: findById(), findAll(page, limit), save(), updateStatus(), updateBranding(), saveInviteToken(), consumeInviteToken()

**tenant.service.ts** — TenantService:
- createTenant(data) → Tenant (PENDING_VERIFICATION, S3 doc upload, AuditService.log)
- approveTenant(tenantId) → void (ACTIVE, generate invite JWT, send invite email)
- deactivateTenant(tenantId) → void (INACTIVE, TenantCache.invalidate, AuditService.log)
- listTenants(page, limit) → PaginatedResult<Tenant>
- resendInvite(tenantId) → void (regenerate invite JWT, send email)
- completeTenantSetup(inviteToken, adminData) → void (consume token, create Hospital Admin user)
- getBranding(tenantId) → BrandingConfig
- updateBranding(tenantId, data) → void (logo upload to S3 if provided, 2MB limit, AuditService.log)

**tenant.controller.ts** — Express handlers, Zod validation, SuccessResponse format

**tenant.routes.ts** — Router, requireRole(SUPER_ADMIN) on admin routes, public on /setup

**Story coverage**: US-SA-01 (onboarding), US-SA-02 (invite management), US-HA-01 (branding setup)

---

### Step 24: User Module
**Files to create**:
```
src/modules/user/user.types.ts
src/modules/user/user.model.ts
src/modules/user/user.repository.ts
src/modules/user/user.service.ts
src/modules/user/user.controller.ts
src/modules/user/user.routes.ts
```

**user.types.ts** — CreateUserRequest, UpdateRoleRequest, UserResponse, UserDocument

**user.model.ts** — User Mongoose schema (tenantId, email, passwordHash, role, isActive, isFirstLogin, failedLoginAttempts, lockedUntil), compound indexes: (tenantId, email), (tenantId, role), (tenantId, isActive)

**Note**: User model is shared between Auth and User modules. Auth module imports from user.model.ts.

**user.repository.ts** — UserRepository: findById(), findByEmail(), findAll(tenantId, filters, page, limit), countActiveAdmins(tenantId), save(), updateRole(), setActive()

**user.service.ts** — UserService:
- createUser(tenantId, data) → User (generate temp password, bcrypt hash, send welcome email, AuditService.log)
- deactivateUser(tenantId, userId) → void (last-admin guard via countActiveAdmins, AuditService.log)
- updateUserRole(tenantId, userId, newRole) → void (last-admin guard if demoting admin, AuditService.log)
- listUsers(tenantId, filters, page, limit) → PaginatedResult<User>
- getUserById(tenantId, userId) → User

**user.controller.ts** — Express handlers, Zod validation

**user.routes.ts** — Router, requireRole(HOSPITAL_ADMIN, HR) on create, requireRole(HOSPITAL_ADMIN) on deactivate/role-update

**Story coverage**: US-HA-02 (user management), US-HR-01 (staff account management), US-ST-01 (system identity — GET /api/auth/me)

---

### Step 25: app.ts + server.ts
**Files to create**:
```
src/app.ts
src/server.ts
```

**app.ts** — trust proxy, helmet, cors (CORS_ORIGINS), express.json (10mb), requestLogger, rate limiters, health route, auth routes, tenant routes, user routes, 404 handler, errorHandler

**server.ts** — connectDatabase(), app.listen(), initWebSocketServer(), gracefulShutdown() (SIGTERM/SIGINT + unhandledRejection/uncaughtException), process.exit(0/1)

**Story coverage**: All stories (app entry point)

---

### Step 26: Unit Tests — Shared Foundation (PBT + example-based)
**Files to create**:
```
tests/unit/shared/authenticate-jwt.test.ts
tests/unit/shared/require-role.test.ts
tests/unit/shared/request-logger.test.ts
tests/unit/shared/paginated-result.test.ts
tests/unit/shared/env-config.test.ts
tests/unit/shared/tenant-cache.test.ts
tests/unit/shared/token-denylist.test.ts
```

**PBT tests** (fast-check):
- `authenticate-jwt.test.ts` — round-trip: sign(payload) → verify → decoded equals payload
- `require-role.test.ts` — idempotency: check(role, allowed) twice = same result
- `request-logger.test.ts` — invariant: N generated correlationIds are all unique
- `paginated-result.test.ts` — invariant: totalPages = ceil(total / limit) for all valid inputs
- `env-config.test.ts` — round-trip: valid AppConfig → serialize to env format → re-parse → same values
- `tenant-cache.test.ts` — stateful: command sequences (set/get/invalidate) preserve invariants
- `token-denylist.test.ts` — invariant: expired tokens always return false from isInDenylist

**Example-based tests** (Jest):
- Each file also includes concrete scenario tests for critical paths

**Story coverage**: US-CC-01 (auth middleware), all stories (shared foundation)

---

### Step 27: Unit Tests — Auth Module
**Files to create**:
```
tests/unit/auth/auth.service.test.ts
```

**Example-based tests**:
- login happy path → returns JWT with correct payload
- login with wrong password → 401, no token
- login increments failedLoginAttempts
- 5th failed login → account locked, lock email sent
- locked account login → 401 with lock message
- 30-min lockout expiry → account auto-unlocked
- changePassword with wrong current password → 401
- changePassword success → isFirstLogin set to false
- forgotPassword → reset token saved, email sent
- resetPassword with valid token → password updated, token consumed
- resetPassword with expired/used token → 401

**PBT tests** (fast-check):
- Lockout counter invariant: failedAttempts never exceeds 5 before lock triggers
- JWT round-trip: sign → verify → payload equality

**Story coverage**: US-CC-01 (all auth flows)

---

### Step 28: Unit Tests — Tenant Module
**Files to create**:
```
tests/unit/tenant/tenant.service.test.ts
```

**Example-based tests**:
- createTenant → PENDING_VERIFICATION status
- approveTenant → ACTIVE status, invite email sent
- deactivateTenant → INACTIVE status, TenantCache invalidated
- resendInvite → new invite token generated, email sent
- completeTenantSetup with valid token → Hospital Admin created
- completeTenantSetup with expired token → 401
- updateBranding with logo > 2MB → 400 validation error
- updateBranding success → S3 upload called, branding updated

**Story coverage**: US-SA-01, US-SA-02, US-HA-01

---

### Step 29: Unit Tests — User Module
**Files to create**:
```
tests/unit/user/user.service.test.ts
```

**Example-based tests**:
- createUser → temp password generated, welcome email sent, isFirstLogin=true
- deactivateUser → isActive=false
- deactivateUser last active admin → ConflictError (last-admin guard)
- updateUserRole demoting last admin → ConflictError
- updateUserRole success → role updated, AuditService.log called
- listUsers with role filter → returns filtered results
- getUserById wrong tenantId → NotFoundError (tenant isolation)

**Story coverage**: US-HA-02, US-HR-01, US-ST-01

---

### Step 30: Integration Tests — Auth Endpoints
**Files to create**:
```
tests/integration/auth/auth.routes.test.ts
```

**Tests** (supertest against real Express app, in-memory MongoDB via `mongodb-memory-server`):
- POST /api/auth/login → 200 with JWT
- POST /api/auth/login wrong password → 401
- POST /api/auth/login after 5 failures → 423 (account locked)
- POST /api/auth/logout → 200, token added to denylist
- POST /api/auth/logout then use same token → 401
- POST /api/auth/change-password → 200
- POST /api/auth/forgot-password → 200 (email mock)
- POST /api/auth/reset-password → 200
- GET /api/auth/me → 200 with user profile

**Story coverage**: US-CC-01

---

### Step 31: Integration Tests — Tenant Endpoints
**Files to create**:
```
tests/integration/tenant/tenant.routes.test.ts
```

**Tests**:
- POST /api/tenants (Super Admin) → 201 PENDING_VERIFICATION
- PATCH /api/tenants/:id/approve → 200 ACTIVE, invite email sent
- PATCH /api/tenants/:id/deactivate → 200 INACTIVE
- POST /api/tenants/:id/resend-invite → 200
- POST /api/tenants/setup (valid invite) → 201 Hospital Admin created
- POST /api/tenants/setup (expired invite) → 401
- GET /api/tenants/:id/branding → 200 branding config
- PATCH /api/tenants/:id/branding → 200 updated

**Story coverage**: US-SA-01, US-SA-02, US-HA-01

---

### Step 32: Integration Tests — User Endpoints
**Files to create**:
```
tests/integration/user/user.routes.test.ts
```

**Tests**:
- POST /api/users (Hospital Admin) → 201 user created
- GET /api/users → 200 paginated list (tenant-scoped)
- GET /api/users/:id → 200 user details
- PATCH /api/users/:id/role → 200 role updated
- PATCH /api/users/:id/deactivate → 200
- PATCH /api/users/:id/deactivate (last admin) → 409 ConflictError
- GET /api/users from different tenant → 0 results (tenant isolation)

**Story coverage**: US-HA-02, US-HR-01, US-ST-01

---

### Step 33: Code Documentation Summary
**Files to create**:
```
aidlc-docs/construction/unit-1-foundation/code/code-summary.md
```

**code-summary.md** — lists all generated files with paths, brief description, story coverage, and test coverage. Markdown only — no application code in aidlc-docs/.

---

## Story Traceability Matrix

| Story | Steps that implement it |
|---|---|
| US-SA-01 | 22 (Auth model/Super Admin), 23 (Tenant create/approve), 30, 31 |
| US-SA-02 | 23 (resendInvite, completeTenantSetup), 31 |
| US-HA-01 | 23 (updateBranding, getBranding), 18 (S3 logo upload), 31 |
| US-HA-02 | 24 (UserService CRUD), 29, 32 |
| US-HR-01 | 24 (createUser with HR role), 29, 32 |
| US-ST-01 | 22 (GET /api/auth/me), 30 |
| US-CC-01 | 22 (full auth flows), 13 (denylist), 16 (middleware), 26, 27, 30 |

---

## File Count Summary

| Category | Files |
|---|---|
| Project scaffold | 6 |
| Shared types | 3 |
| Shared config | 4 (env, database, request-context, tenant-cache) |
| Shared utilities | 2 (utils/index, db-guard) |
| Shared middleware | 6 |
| Shared services | 4 (email, s3, websocket, audit) |
| Shared routes | 1 (health) |
| Auth module | 6 |
| Tenant module | 6 |
| User module | 6 |
| App entry points | 2 (app.ts, server.ts) |
| Unit tests | 10 |
| Integration tests | 3 |
| Documentation | 1 |
| **Total** | **60 files** |

---

## PBT Coverage Summary (PBT-01 through PBT-10)

| Rule | Coverage | Test File |
|---|---|---|
| PBT-01 | Compliant | Properties identified in Functional Design, carried into Step 26 |
| PBT-02 | Compliant | JWT round-trip (Step 26, 27); env round-trip (Step 26) |
| PBT-03 | Compliant | correlationId uniqueness, totalPages invariant, token denylist expiry (Step 26) |
| PBT-04 | Compliant | requireRole idempotency, TenantCache.set idempotency (Step 26) |
| PBT-05 | N/A | No reference implementation exists |
| PBT-06 | Compliant | TenantCache stateful command sequences (Step 26) |
| PBT-07 | Compliant | Domain generators for JWTPayload, AppConfig, TenantStatus, UserRole |
| PBT-08 | Compliant | fast-check shrinking enabled; seed logged on failure |
| PBT-09 | Compliant | fast-check v3.19.0 in package.json |
| PBT-10 | Compliant | All PBT tests paired with example-based tests in same files |

---
