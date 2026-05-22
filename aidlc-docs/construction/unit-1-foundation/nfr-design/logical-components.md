# Logical Components — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Design  
**Status**: Approved

---

## Component Map

```
src/shared/
  config/
    env.ts                    [LC-01] Environment Config Loader
    database.ts               [LC-02] MongoDB Connection Manager
    request-context.ts        [LC-03] AsyncLocalStorage Request Context
    tenant-cache.ts           [LC-04] TenantCache (60s TTL, hit/miss metrics)
  middleware/
    authenticate-jwt.ts       [LC-05] JWT Authentication Middleware
    scope-tenant.ts           [LC-06] Tenant Scope Middleware (uses LC-04)
    require-role.ts           [LC-07] RBAC Role Guard Middleware
    require-first-password-change.ts  [LC-08] First-Login Guard Middleware
    request-logger.ts         [LC-09] Structured Request Logger (uses LC-03)
    error-handler.ts          [LC-10] Global Error Handler + AppError Hierarchy
    token-denylist.ts         [LC-11] In-Memory JWT Denylist
    db-guard.ts               [LC-12] DB Connectivity Pre-flight Guard
  services/
    email.service.ts          [LC-13] Email Service (Nodemailer)
    s3.service.ts             [LC-14] S3 Service (AWS SDK v3)
    websocket.service.ts      [LC-15] WebSocket Service Stub
    audit.service.ts          [LC-16] AuditService Stub
  routes/
    health.routes.ts          [LC-17] Health Check Route
  utils/
    index.ts                  [LC-18] Shared Utilities (generateId, formatDate)
  types/
    common.types.ts           [LC-19] Shared TypeScript Types
    rbac.types.ts             [LC-20] RBAC Types
```

---

## LC-01: Environment Config Loader

**File**: `src/shared/config/env.ts`  
**Purpose**: Load, validate, and export typed application configuration

**Inputs**: `process.env` (populated by dotenv-safe from `.env` file)  
**Outputs**: Frozen `AppConfig` object  
**Dependencies**: `dotenv-safe`

**Behaviour**:
- Calls `require('dotenv-safe').config({ allowEmptyValues: false })` at module load time
- Parses and type-casts all env vars into `AppConfig`
- Splits `CORS_ORIGINS` on `,` and trims whitespace → `string[]`
- Calls `Object.freeze(config)` before export
- Fails fast with descriptive error if any required var is missing

**Exports**: `config: AppConfig`

---

## LC-02: MongoDB Connection Manager

**File**: `src/shared/config/database.ts`  
**Purpose**: Manage Mongoose connection lifecycle

**Inputs**: `config.mongodbUri`  
**Outputs**: Connected Mongoose instance  
**Dependencies**: `mongoose`, `LC-01`

**Exports**:
- `connectDatabase(): Promise<void>` — connects, registers event listeners
- `disconnectDatabase(): Promise<void>` — closes connection gracefully

**Event listeners registered**:
- `connected` → `info` log
- `disconnected` → `warn` log
- `reconnected` → `info` log
- `error` → `error` log (does NOT exit — Mongoose handles reconnection)

**Security**: MongoDB URI is never logged (may contain credentials)

---

## LC-03: AsyncLocalStorage Request Context

**File**: `src/shared/config/request-context.ts`  
**Purpose**: Propagate request-scoped data (correlationId, userId, tenantId) through the async call stack without parameter threading

**Inputs**: Set by `requestLogger` middleware at request start  
**Outputs**: Available anywhere in the request's async call chain  
**Dependencies**: Node.js built-in `async_hooks`

**Exports**:
- `requestContext: AsyncLocalStorage<RequestContext>`
- `getCorrelationId(): string` — returns correlationId or `'no-context'` if outside a request
- `getRequestContext(): RequestContext | undefined`

**Interface**:
```typescript
interface RequestContext {
  correlationId: string;
  userId?:       string;
  tenantId?:     string;
}
```

---

## LC-04: TenantCache

**File**: `src/shared/config/tenant-cache.ts`  
**Purpose**: Cache tenant status to avoid a MongoDB round-trip on every authenticated request

**Inputs**: tenantId (string), TenantStatus  
**Outputs**: Cached TenantStatus or null (cache miss)  
**Dependencies**: `LC-19` (TenantStatus type)

**Configuration**:
- TTL: 60,000ms (60 seconds)
- Storage: `Map<string, { status: TenantStatus; cachedAt: number }>`
- Observability: hit/miss counters, logged every 100 requests

**Exports** (singleton instance):
- `tenantCache.get(tenantId: string): TenantStatus | null`
- `tenantCache.set(tenantId: string, status: TenantStatus): void`
- `tenantCache.invalidate(tenantId: string): void`
- `tenantCache.clear(): void` (test use only)

**Redis migration TODO**:
```typescript
// TODO(scale): Replace with Redis TenantCache. See docs/scaling.md for migration guide.
```

**PBT property**: Stateful command sequences (get/set/invalidate/get) preserve invariants — a set followed by get within TTL always returns the set value; get after invalidate always returns null.

---

## LC-05: JWT Authentication Middleware

**File**: `src/shared/middleware/authenticate-jwt.ts`  
**Purpose**: Validate Bearer JWT on every protected request

**Inputs**: `Authorization: Bearer <token>` header  
**Outputs**: `req.user: JWTPayload` (attached to request)  
**Dependencies**: `jsonwebtoken`, `LC-11` (token denylist), `LC-19` (JWTPayload)

**Error responses**:
- Missing/malformed header → `UnauthorizedError(401)`
- Invalid signature / expired → `UnauthorizedError(401)`
- Token in denylist → `UnauthorizedError(401)`

**PBT property**: sign(payload) → verify → decoded equals original payload (round-trip)

---

## LC-06: Tenant Scope Middleware

**File**: `src/shared/middleware/scope-tenant.ts`  
**Purpose**: Verify tenant exists and is ACTIVE; attach tenant to request

**Inputs**: `req.user.tenantId` (from LC-05)  
**Outputs**: `req.tenant` (Mongoose tenant document)  
**Dependencies**: `LC-04` (TenantCache), Tenant Mongoose model, `LC-12` (db-guard)

**Flow**:
1. Skip if `req.user.role === UserRole.SUPER_ADMIN`
2. Check `TenantCache.get(tenantId)` — cache hit: use cached status
3. Cache miss: `assertDbConnected()` → query MongoDB → `TenantCache.set()`
4. If status `INACTIVE` → `UnauthorizedError(401)`
5. Attach `req.tenant` → `next()`

---

## LC-07: RBAC Role Guard Middleware

**File**: `src/shared/middleware/require-role.ts`  
**Purpose**: Enforce role-based access control on protected routes

**Inputs**: `req.user.role`, allowed roles (variadic args)  
**Outputs**: Passes or throws ForbiddenError  
**Dependencies**: `LC-16` (AuditService — logs 403 events), `LC-03` (correlationId)

**Signature**: `requireRole(...roles: UserRole[]): RequestHandler`

**On 403**: Calls `auditService.log({ entityType: AuditEntityType.AUTH, action: 'DELETE', ... })` to record the access denial (FR-13.2)

**PBT property**: Idempotent — calling the role check twice with same inputs produces same result

---

## LC-08: First-Login Guard Middleware

**File**: `src/shared/middleware/require-first-password-change.ts`  
**Purpose**: Block access until user changes their temporary password

**Inputs**: `req.user.isFirstLogin`  
**Outputs**: Passes or throws ForbiddenError  
**Dependencies**: `LC-19` (JWTPayload)

**Note**: MUST NOT be applied to `POST /api/auth/change-password`

---

## LC-09: Structured Request Logger

**File**: `src/shared/middleware/request-logger.ts`  
**Purpose**: Log all requests with correlation ID, timing, and user context

**Inputs**: Incoming HTTP request  
**Outputs**: `req.correlationId` (string), `X-Correlation-ID` response header, JSON log entry  
**Dependencies**: `LC-03` (AsyncLocalStorage), `LC-18` (generateId)

**Log levels**: `info` (2xx/3xx), `warn` (4xx), `error` (5xx)  
**Timing**: `Date.now()` millisecond precision  
**Context stored**: `requestContext.run({ correlationId, userId, tenantId }, next)`

**PBT property**: All generated correlationIds are unique (invariant)

---

## LC-10: Global Error Handler + AppError Hierarchy

**File**: `src/shared/middleware/error-handler.ts`  
**Purpose**: Catch all unhandled errors; return safe, structured responses

**AppError hierarchy**:
```
AppError (base, 500)
  ├── ValidationError      (400)
  ├── UnauthorizedError    (401)
  ├── ForbiddenError       (403)
  ├── NotFoundError        (404)
  ├── ConflictError        (409)
  └── ServiceUnavailableError (503)
```

**Mongoose error classification**:
- `MongoNetworkError`, `MongoServerSelectionError`, `MongoTimeoutError` → 503
- `mongoose.Error.ValidationError` → 400
- All others → 500

**Production response**: `{ status: 'error', message }` — no stack trace  
**Development response**: `{ status: 'error', message, details: { stack } }`

---

## LC-11: Token Denylist

**File**: `src/shared/middleware/token-denylist.ts`  
**Purpose**: Track invalidated JWTs (logout) for the duration of their remaining validity

**Storage**: `Map<string, number>` (token → expiry timestamp ms)  
**Cleanup**: Lazy — expired entries removed on `isInDenylist()` call  
**Capacity**: Unbounded (2,500 entries at peak — trivial)

**Exports**:
- `addToDenylist(token: string, expiryMs: number): void`
- `isInDenylist(token: string): boolean`

**Redis migration TODO**:
```typescript
// TODO(scale): Replace with Redis TokenDenylist. See docs/scaling.md for migration guide.
```

---

## LC-12: DB Connectivity Guard

**File**: `src/shared/utils/db-guard.ts`  
**Purpose**: Pre-flight check before DB operations; throws 503 if not connected

**Exports**: `assertDbConnected(): void`

**Used by**: All repository classes as the first line of every method

---

## LC-13: Email Service

**File**: `src/shared/services/email.service.ts`  
**Purpose**: Send all system emails via Nodemailer SMTP

**Public API**:
- `sendInviteEmail(to: string, inviteLink: string): Promise<void>`
- `sendWelcomeEmail(to: string, tempPassword: string): Promise<void>`
- `sendAccountLockEmail(to: string): Promise<void>`
- `sendPasswordResetEmail(to: string, resetLink: string): Promise<void>`

**Internal**: `sendTemplatedEmail(template: EmailTemplate, data: object): Promise<void>`  
**Error handling**: Throws `AppError(500, 'Unable to send email...')` on SMTP failure  
**Logging**: Uses `getCorrelationId()` from LC-03 for error log context

---

## LC-14: S3 Service

**File**: `src/shared/services/s3.service.ts`  
**Purpose**: Upload files and generate pre-signed download URLs

**Public API** (Unit 1 scope):
- `uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string>`
- `getPresignedUrl(key: string, expirySeconds: number): Promise<string>`

**Extension point**: `deleteFile()` and `copyFile()` added in later units  
**Encryption**: `ServerSideEncryption: 'AES256'` on all uploads (SECURITY-01)

---

## LC-15: WebSocket Service Stub

**File**: `src/shared/services/websocket.service.ts`  
**Purpose**: Initialize WebSocket server; stub delivery methods for Unit 6

**Public API**:
- `initWebSocketServer(server: http.Server): void`
- `registerConnection(userId: string, ws: WebSocket): void` — no-op stub
- `removeConnection(userId: string): void` — no-op stub
- `pushToUser(userId: string, payload: object): void` — no-op stub (logs debug message)

**Redis migration TODO**:
```typescript
// TODO(scale): Replace with Redis WebSocketService. See docs/scaling.md for migration guide.
```

---

## LC-16: AuditService Stub

**File**: `src/shared/services/audit.service.ts`  
**Purpose**: Log audit entries to console (full DB implementation in Unit 6)

**Public API**: `log(entry: AuditLogEntry): Promise<void>`  
**Behaviour**: `console.log('[AUDIT STUB]', ...)` — never throws  
**Signature**: Matches Unit 6 full implementation — no call-site changes needed

---

## LC-17: Health Check Route

**File**: `src/shared/routes/health.routes.ts`  
**Purpose**: Expose process health for load balancer and orchestrator checks

**Route**: `GET /health` (no auth, rate-limited)  
**Response**: `{ status: 'ok', uptime: number, timestamp: string }`  
**Mounted in**: `app.ts` as the first route

---

## LC-18: Shared Utilities

**File**: `src/shared/utils/index.ts`  
**Purpose**: Common utility functions used across all modules

**Exports**:
- `generateId(): string` — UUID v4 wrapper
- `formatDate(date: Date): string` — ISO 8601 formatter (`date.toISOString()`)

---

## LC-19 / LC-20: Shared Types

**Files**: `src/shared/types/common.types.ts`, `src/shared/types/rbac.types.ts`  
**Purpose**: TypeScript type definitions shared across all modules  
**Exports**: UserRole, TenantStatus, JWTPayload, PaginatedResult, SuccessResponse, ErrorResponse, AuditEntityType, AuditLogEntry, AuditAction, RolePermission, HttpMethod

---

## Component Dependency Graph

```
LC-01 (env)
  |
  +---> LC-02 (database)
  +---> LC-13 (email)
  +---> LC-14 (s3)
  +---> LC-15 (websocket stub)

LC-03 (request-context)
  |
  +---> LC-09 (request-logger) [sets context]
  +---> LC-13 (email) [reads correlationId]
  +---> LC-16 (audit stub) [reads correlationId]

LC-04 (tenant-cache)
  |
  +---> LC-06 (scope-tenant) [uses cache]

LC-10 (error-handler)
  |
  +---> LC-12 (db-guard) [throws ServiceUnavailableError]
  +---> LC-05 (authenticate-jwt) [throws UnauthorizedError]
  +---> LC-06 (scope-tenant) [throws UnauthorizedError]
  +---> LC-07 (require-role) [throws ForbiddenError]

LC-11 (token-denylist)
  |
  +---> LC-05 (authenticate-jwt) [checks denylist]

LC-16 (audit stub)
  |
  +---> LC-07 (require-role) [logs 403 events]

LC-17 (health route)
  |
  +---> app.ts [mounted as first route]

LC-18 (utils)
  |
  +---> LC-09 (request-logger) [generateId for correlationId]
```

---
