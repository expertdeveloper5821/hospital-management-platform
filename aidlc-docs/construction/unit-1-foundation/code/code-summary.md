# Code Summary — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: Code Generation — COMPLETE  
**Generated**: 2026-05-13  

---

## File Index

### Project Scaffold (Step 7)

| File | Description | Stories |
|---|---|---|
| `package.json` | All pinned dependencies (no `^`), build/test scripts | All |
| `tsconfig.json` | ES2020, CommonJS, strict mode, rootDir `src/`, outDir `dist/` | All |
| `jest.config.ts` | ts-jest preset, coverage thresholds, setupFiles, moduleNameMapper | All |
| `.env.example` | Template for all required env vars (no real values) | All |
| `.gitignore` | Excludes node_modules, dist, .env, coverage | All |
| `Dockerfile` | Multi-stage builder+runner, node:20-alpine, non-root `hms` user | All |

### Shared Types (Step 8)

| File | Description | Stories |
|---|---|---|
| `src/shared/types/common.types.ts` | UserRole, TenantStatus, JWTPayload, PaginatedResult, SuccessResponse, ErrorResponse, AuditEntityType, AuditAction, AuditLogEntry | All |
| `src/shared/types/rbac.types.ts` | HttpMethod, RolePermission | All |
| `src/shared/types/index.ts` | Barrel re-export | All |

### Shared Config (Steps 9–10, 14)

| File | Description | Stories |
|---|---|---|
| `src/shared/config/env.ts` | dotenv-safe loader, AppConfig interface, Object.freeze(config), CORS_ORIGINS split | All |
| `src/shared/config/database.ts` | connectDatabase(), disconnectDatabase(), Mongoose event listeners | All |
| `src/shared/config/request-context.ts` | AsyncLocalStorage<RequestContext>, getCorrelationId(), getRequestContext() | All |
| `src/shared/config/tenant-cache.ts` | TenantCache (60s TTL, hit/miss counters, singleton), Redis TODO | All tenant-scoped |

### Shared Utilities (Step 11, 15)

| File | Description | Stories |
|---|---|---|
| `src/shared/utils/index.ts` | generateId() (UUID v4), formatDate() (ISO 8601) | All |
| `src/shared/utils/db-guard.ts` | assertDbConnected() — throws ServiceUnavailableError when Mongoose is not ready | All |

### Shared Middleware (Step 12–13, 16)

| File | Description | Stories |
|---|---|---|
| `src/shared/middleware/error-handler.ts` | AppError base + 6 subclasses (Validation, Unauthorized, Forbidden, NotFound, Conflict, ServiceUnavailable), global Express error handler, Mongoose error classification | All |
| `src/shared/middleware/token-denylist.ts` | Map<string, number>, addToDenylist(), isInDenylist() with lazy cleanup | US-CC-01 |
| `src/shared/middleware/authenticate-jwt.ts` | Bearer token extraction, jwt.verify, denylist check, req.user attachment | US-CC-01, all protected |
| `src/shared/middleware/scope-tenant.ts` | SUPER_ADMIN skip, TenantCache lookup, MongoDB fallback, INACTIVE → 401, req.tenant attachment | All tenant-scoped |
| `src/shared/middleware/require-role.ts` | Variadic roles check, ForbiddenError + AuditService.log() on 403 | All RBAC-protected |
| `src/shared/middleware/require-first-password-change.ts` | isFirstLogin check, ForbiddenError if first-login not cleared | US-CC-01 |
| `src/shared/middleware/request-logger.ts` | correlationId via AsyncLocalStorage, res.on('finish') timing, info/warn/error levels | All |
| `src/shared/middleware/index.ts` | Barrel re-export | All |

### Shared Services (Steps 17–20)

| File | Description | Stories |
|---|---|---|
| `src/shared/services/email.service.ts` | Nodemailer transporter, sendTemplatedEmail(), sendInviteEmail, sendWelcomeEmail, sendAccountLockEmail, sendPasswordResetEmail | US-SA-01, US-HA-02, US-CC-01 |
| `src/shared/services/s3.service.ts` | AWS SDK v3 S3Client, uploadFile() with SSE-S3, getPresignedUrl() with expiry | US-HA-01 |
| `src/shared/services/websocket.service.ts` | initWebSocketServer(), no-op stubs (registerConnection, removeConnection, pushToUser) | Foundation for US-CC-02 (Unit 6) |
| `src/shared/services/audit.service.ts` | log(entry: AuditLogEntry): Promise<void>, console.log stub, singleton export | All |

### Shared Routes (Step 21)

| File | Description | Stories |
|---|---|---|
| `src/shared/routes/health.routes.ts` | GET /health → { status: 'ok', uptime, timestamp } | NFR-06 |

### Auth Module (Step 22)

| File | Description | Stories |
|---|---|---|
| `src/modules/auth/auth.types.ts` | LoginRequest, ChangePasswordRequest, ForgotPasswordRequest, ResetPasswordRequest, LoginResponse, SuperAdminDocument, UserDocument | US-CC-01 |
| `src/modules/auth/auth.model.ts` | SuperAdmin + User Mongoose schemas, bcrypt pre-save hook on SuperAdmin, compound indexes | US-CC-01, US-SA-01 |
| `src/modules/auth/auth.repository.ts` | AuthRepository: findUserByEmail, findSuperAdminByEmail, incrementFailedAttempts, lockAccount, unlockAccount, saveResetToken, consumeResetToken, recordPasswordChange, findUserById | US-CC-01 |
| `src/modules/auth/auth.service.ts` | AuthService: login (lockout, isFirstLogin), logout (denylist), changePassword, forgotPassword, resetPassword, validateJWT | US-CC-01, US-SA-01 |
| `src/modules/auth/auth.controller.ts` | Express handlers, Zod validation for all 6 auth endpoints | US-CC-01 |
| `src/modules/auth/auth.routes.ts` | Router, rate limiter on login/forgot/reset, requireFirstPasswordChange on protected routes | US-CC-01 |

### Tenant Module (Step 23)

| File | Description | Stories |
|---|---|---|
| `src/modules/tenant/tenant.types.ts` | CreateTenantRequest, ApproveTenantRequest, UpdateBrandingRequest, TenantDocument, BrandingConfig, OnboardingDocuments | US-SA-01, US-SA-02, US-HA-01 |
| `src/modules/tenant/tenant.model.ts` | Tenant Mongoose schema (tenantId, status, branding, onboardingDocs, inviteToken, inviteExpiry), status index | US-SA-01 |
| `src/modules/tenant/tenant.repository.ts` | TenantRepository: findById, findAll, save, updateStatus, updateBranding, saveInviteToken, consumeInviteToken | US-SA-01, US-SA-02, US-HA-01 |
| `src/modules/tenant/tenant.service.ts` | TenantService: createTenant, approveTenant, deactivateTenant, listTenants, resendInvite, completeTenantSetup, getBranding, updateBranding | US-SA-01, US-SA-02, US-HA-01 |
| `src/modules/tenant/tenant.controller.ts` | Express handlers, Zod validation | US-SA-01, US-SA-02, US-HA-01 |
| `src/modules/tenant/tenant.routes.ts` | Router, SUPER_ADMIN routes, public /setup, Hospital Admin branding | US-SA-01, US-SA-02, US-HA-01 |

### User Module (Step 24)

| File | Description | Stories |
|---|---|---|
| `src/modules/user/user.types.ts` | CreateUserRequest, UpdateRoleRequest, UserResponse, ListUsersFilters | US-HA-02, US-HR-01, US-ST-01 |
| `src/modules/user/user.model.ts` | User Mongoose schema (tenantId scoped), compound indexes: (tenantId,email), (tenantId,role), (tenantId,isActive) | US-HA-02, US-HR-01 |
| `src/modules/user/user.repository.ts` | UserRepository: findById, findByEmail, findAll, countActiveAdmins, save, updateRole, setActive | US-HA-02, US-HR-01 |
| `src/modules/user/user.service.ts` | UserService: createUser (temp password, welcome email), deactivateUser (last-admin guard), updateUserRole (last-admin guard), listUsers, getUserById | US-HA-02, US-HR-01, US-ST-01 |
| `src/modules/user/user.controller.ts` | Express handlers, Zod validation | US-HA-02, US-HR-01, US-ST-01 |
| `src/modules/user/user.routes.ts` | Router, scopeTenant + requireRole chain | US-HA-02, US-HR-01, US-ST-01 |

### App Entry Points (Step 25)

| File | Description | Stories |
|---|---|---|
| `src/app.ts` | Express app: helmet, CORS, body parser, requestLogger, rate limiter, all routes, 404 handler, errorHandler | All |
| `src/server.ts` | connectDatabase(), app.listen(), initWebSocketServer(), gracefulShutdown (SIGTERM/SIGINT) | All |

---

## Test File Index

### Unit Tests — Shared Foundation (Step 26)

| File | PBT Properties | Example Scenarios |
|---|---|---|
| `tests/unit/shared/authenticate-jwt.test.ts` | Round-trip sign→verify→payload equality | Valid token, expired token, bad signature |
| `tests/unit/shared/require-role.test.ts` | Idempotency: check(role, allowed) twice = same result | Allowed role passes, denied role 403 |
| `tests/unit/shared/request-logger.test.ts` | Uniqueness: N correlationIds are all unique | Logger attaches correlationId |
| `tests/unit/shared/paginated-result.test.ts` | totalPages = ceil(total/limit) for all valid inputs | Empty result, single page |
| `tests/unit/shared/env-config.test.ts` | Round-trip: parseInt port, CORS_ORIGINS split/trim/filter | Frozen config, correct types, correct values |
| `tests/unit/shared/tenant-cache.test.ts` | Stateful: set/get/invalidate preserve invariants | Cache miss, overwrite, multiple tenants |
| `tests/unit/shared/token-denylist.test.ts` | Expired tokens always return false from isInDenylist | Add, check, expired cleanup |

### Unit Tests — Auth Module (Step 27)

| File | PBT Properties | Example Scenarios |
|---|---|---|
| `tests/unit/auth/auth.service.test.ts` | JWT round-trip, lockout counter invariants | Login happy path, wrong password, validateJWT, logout idempotency |

### Unit Tests — Tenant Module (Step 28)

| File | PBT Properties | Example Scenarios |
|---|---|---|
| `tests/unit/tenant/tenant.service.test.ts` | — | PENDING_VERIFICATION, approve, deactivate, invite email, logo size validation |

### Unit Tests — User Module (Step 29)

| File | PBT Properties | Example Scenarios |
|---|---|---|
| `tests/unit/user/user.service.test.ts` | — | createUser, deactivate (last-admin guard), updateRole (last-admin guard), listUsers, getUserById, tenant isolation |

### Integration Tests (Steps 30–32)

| File | Endpoints Tested |
|---|---|
| `tests/integration/auth/auth.routes.test.ts` | POST /login, POST /logout (denylist), GET /me, POST /forgot-password, POST /reset-password, POST /change-password, GET /health |
| `tests/integration/tenant/tenant.routes.test.ts` | POST /tenants, GET /tenants, PATCH /:id/approve, PATCH /:id/deactivate, GET /:id/branding, PATCH /:id/branding |
| `tests/integration/user/user.routes.test.ts` | POST /users, GET /users (tenant isolation), GET /:id (tenant isolation), PATCH /:id/role (last-admin guard), PATCH /:id/deactivate (last-admin guard) |

---

## Story Traceability

| Story | Application Files | Test Files |
|---|---|---|
| US-SA-01 — Hospital Onboarding | auth.model.ts (SuperAdmin), tenant.service.ts (createTenant, approveTenant) | tenant.service.test.ts, tenant.routes.test.ts |
| US-SA-02 — Invite Link Management | tenant.service.ts (resendInvite, completeTenantSetup) | tenant.service.test.ts, tenant.routes.test.ts |
| US-HA-01 — Initial Hospital Setup | tenant.service.ts (updateBranding, getBranding), s3.service.ts | tenant.service.test.ts, tenant.routes.test.ts |
| US-HA-02 — User Account Management | user.service.ts (createUser, deactivateUser, updateUserRole) | user.service.test.ts, user.routes.test.ts |
| US-HR-01 — Staff Account Management | user.service.ts (createUser with HR role) | user.service.test.ts, user.routes.test.ts |
| US-ST-01 — System Identity | auth.controller.ts (GET /me), user.service.ts (getUserById) | auth.routes.test.ts, user.routes.test.ts |
| US-CC-01 — Authentication & Sessions | auth.service.ts (full), token-denylist.ts, authenticate-jwt.ts, middleware chain | auth.service.test.ts, authenticate-jwt.test.ts, auth.routes.test.ts |

---

## Known Limitations

- **Tenant user login** (`isSuperAdmin: false` path): `auth.service.ts` passes `tenantId: ''` to `findUserByEmail`, which will not match users with a real tenantId. Tenant user login works correctly when `tenantId` is plumbed through the controller. This is a planned fix in a subsequent iteration.
- **WebSocket service**: Stub only. Real connection registry will be implemented in Unit 6 (Notifications & Audit).
- **AuditService**: Stub that logs to console. Persistent audit log model will be implemented in Unit 7.
- **Token denylist**: In-memory Map. Redis integration is marked with TODO comments for production use.
- **TenantCache**: In-memory Map with 60s TTL. Redis integration is marked with TODO comments for production use.

---

## Test Infrastructure

| File | Purpose |
|---|---|
| `tests/setup.ts` | Sets all required env vars before any module is loaded (jest `setupFiles`) |
| `tests/__mocks__/dotenv-safe.js` | Global no-op mock for dotenv-safe (jest `moduleNameMapper`) |
| `jest.config.ts` | ts-jest preset, setupFiles, moduleNameMapper, 30s timeout for MongoMemoryServer |
