# Business Rules — Unit 1: Foundation (U1-A: Shared Foundation)

**Unit**: Unit 1 — Foundation  
**Stage**: Functional Design  
**Scope**: Middleware chain, shared services, app scaffold, AuditService stub

---

## 1. Middleware Business Rules

### 1.1 authenticateJWT

**File**: `src/shared/middleware/authenticate-jwt.ts`  
**Depends on**: `token-denylist.ts` (Answer C1=B)

**Rules**:

| Rule ID | Rule |
|---|---|
| MW-AUTH-01 | Every protected route MUST pass through `authenticateJWT` before any other middleware |
| MW-AUTH-02 | Extract Bearer token from `Authorization: Bearer <token>` header |
| MW-AUTH-03 | If header is missing or malformed → return 401 `{ status: 'error', message: 'Authentication required' }` |
| MW-AUTH-04 | Verify JWT signature using `JWT_SECRET` |
| MW-AUTH-05 | If signature invalid or token expired → return 401 `{ status: 'error', message: 'Invalid or expired token' }` |
| MW-AUTH-06 | Check token against in-memory denylist (token-denylist.ts) |
| MW-AUTH-07 | If token is in denylist → return 401 `{ status: 'error', message: 'Token has been invalidated' }` |
| MW-AUTH-08 | Attach decoded `JWTPayload` to `req.user` for downstream middleware |
| MW-AUTH-09 | NEVER reveal whether failure was due to expiry, invalid signature, or denylist — use generic 401 message |

**Token Denylist (token-denylist.ts)**:

| Rule ID | Rule |
|---|---|
| DL-01 | Denylist is an in-memory `Map<string, number>` where key = token, value = expiry timestamp |
| DL-02 | `addToDenylist(token, expiryMs)` — adds token with its expiry time |
| DL-03 | `isInDenylist(token)` — returns true if token exists AND has not yet expired |
| DL-04 | Expired entries are lazily cleaned up: on each `isInDenylist` call, remove entries where `expiry < Date.now()` |
| DL-05 | Denylist is NOT persisted — server restart clears it (acceptable for single-instance phase, per requirements) |

**PBT property**: Valid JWT → sign → verify → decoded payload equals original payload (round-trip). Tested with `fast-check` generating random `JWTPayload` objects.

---

### 1.2 scopeTenant

**File**: `src/shared/middleware/scope-tenant.ts`

**Rules**:

| Rule ID | Rule |
|---|---|
| MW-SCOPE-01 | Runs after `authenticateJWT` — `req.user` is guaranteed to be set |
| MW-SCOPE-02 | If `req.user.role === UserRole.SUPER_ADMIN` → skip tenant check, call `next()` |
| MW-SCOPE-03 | Extract `tenantId` from `req.user.tenantId` |
| MW-SCOPE-04 | Query MongoDB `tenants` collection for `{ _id: tenantId }` |
| MW-SCOPE-05 | If tenant not found → return 401 `{ status: 'error', message: 'Tenant not found' }` |
| MW-SCOPE-06 | If tenant status is `INACTIVE` → return 401 `{ status: 'error', message: 'Tenant account is inactive' }` |
| MW-SCOPE-07 | If tenant is `ACTIVE` → attach `req.tenant` (tenant document) and call `next()` |
| MW-SCOPE-08 | All subsequent repository calls MUST use `req.user.tenantId` as a mandatory filter |

---

### 1.3 requireRole

**File**: `src/shared/middleware/require-role.ts`  
**Signature**: `requireRole(...roles: UserRole[])` (Answer C2=A — variadic)

**Rules**:

| Rule ID | Rule |
|---|---|
| MW-ROLE-01 | Runs after `authenticateJWT` — `req.user` is guaranteed to be set |
| MW-ROLE-02 | Check if `req.user.role` is included in the `roles` array |
| MW-ROLE-03 | If role is NOT in allowed list → return 403 `{ status: 'error', message: 'Insufficient permissions' }` |
| MW-ROLE-04 | If role IS in allowed list → call `next()` |
| MW-ROLE-05 | Log every 403 response with: userId, tenantId, role, requested resource, timestamp (FR-13.2, SECURITY-14) |
| MW-ROLE-06 | The 403 log entry MUST be written to the audit log via `AuditService.log()` with `entityType: AuditEntityType.AUTH` |

**PBT property**: `requireRole` is idempotent — calling the check twice with the same role and allowed list produces the same result. Tested with `fast-check` generating random role combinations.

---

### 1.4 requireFirstPasswordChange

**File**: `src/shared/middleware/require-first-password-change.ts`

**Rules**:

| Rule ID | Rule |
|---|---|
| MW-FPC-01 | Runs after `authenticateJWT` |
| MW-FPC-02 | Read `req.user.isFirstLogin` from JWT payload |
| MW-FPC-03 | If `isFirstLogin === true` → return 403 `{ status: 'error', message: 'Password change required before accessing this resource' }` |
| MW-FPC-04 | If `isFirstLogin === false` → call `next()` |
| MW-FPC-05 | This middleware MUST NOT be applied to `POST /api/auth/change-password` (would create a deadlock) |

---

### 1.5 requestLogger

**File**: `src/shared/middleware/request-logger.ts`  
**Fields logged**: method, URL, status, response time, correlationId, userId, tenantId (Answer C3=B)

**Rules**:

| Rule ID | Rule |
|---|---|
| LOG-01 | Generate a unique `correlationId` (UUID v4) for every incoming request |
| LOG-02 | Attach `correlationId` to `req.correlationId` and to the response header `X-Correlation-ID` |
| LOG-03 | Log on response finish: `{ correlationId, method, url, statusCode, responseTimeMs, userId?, tenantId? }` |
| LOG-04 | `userId` and `tenantId` are extracted from `req.user` if present (may be absent on public routes) |
| LOG-05 | MUST NOT log request body, query params, or headers (PII/secret risk — SECURITY-03) |
| LOG-06 | Log format: structured JSON (not plain text) for centralized log aggregation |

**PBT property**: All generated correlation IDs are unique across a large generated set (invariant). Tested with `fast-check` generating N IDs and asserting `new Set(ids).size === ids.length`.

---

### 1.6 errorHandler

**File**: `src/shared/middleware/error-handler.ts`  
**Dev behavior**: Stack trace in response AND console log (Answer C4=C)

**Rules**:

| Rule ID | Rule |
|---|---|
| ERR-01 | Global Express error handler — 4-argument signature `(err, req, res, next)` |
| ERR-02 | Log full error (including stack) to console/logger on every error regardless of environment |
| ERR-03 | In `NODE_ENV=production`: respond with `{ status: 'error', message: err.message }` — NO stack trace |
| ERR-04 | In `NODE_ENV=development`: respond with `{ status: 'error', message: err.message, details: { stack: err.stack } }` |
| ERR-05 | If `err.statusCode` is set (custom AppError), use it as HTTP status; otherwise default to 500 |
| ERR-06 | NEVER expose database error details, internal paths, or framework versions in production responses (SECURITY-09) |
| ERR-07 | Unhandled promise rejections and uncaught exceptions MUST be caught by a global handler in `server.ts` (SECURITY-15) |

**AppError class** (defined in `src/shared/middleware/error-handler.ts`):

```typescript
export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

---

## 2. Shared Services Business Rules

### 2.1 EmailService

**File**: `src/shared/services/email.service.ts`  
**Pattern**: Typed methods + generic base (Answer D1=C)

**Rules**:

| Rule ID | Rule |
|---|---|
| EMAIL-01 | All email sending is async — methods return `Promise<void>` |
| EMAIL-02 | SMTP credentials loaded from `AppConfig` — NEVER hardcoded |
| EMAIL-03 | SMTP credentials MUST NOT appear in logs (SECURITY-03) |
| EMAIL-04 | On SMTP failure, throw `AppError` with a generic message — do NOT expose SMTP error details to callers |
| EMAIL-05 | `sendInviteEmail(to, inviteLink)` — sends invite with 48h expiry link |
| EMAIL-06 | `sendWelcomeEmail(to, tempPassword)` — sends welcome with temporary password |
| EMAIL-07 | `sendAccountLockEmail(to)` — notifies user their account is locked |
| EMAIL-08 | `sendPasswordResetEmail(to, resetLink)` — sends password reset link |
| EMAIL-09 | All methods call internal `sendTemplatedEmail(template, data)` which calls Nodemailer `transporter.sendMail()` |
| EMAIL-10 | HTML templates are defined as functions returning HTML strings — no external template engine dependency |

**EmailTemplate type**:

```typescript
export type EmailTemplate = 'invite' | 'welcome' | 'account-lock' | 'password-reset';
```

---

### 2.2 S3Service

**File**: `src/shared/services/s3.service.ts`  
**Pattern**: Minimal with extension comments (Answer D2=C)

**Rules**:

| Rule ID | Rule |
|---|---|
| S3-01 | AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| S3-02 | `uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string>` — returns the S3 key |
| S3-03 | `getPresignedUrl(key: string, expirySeconds: number): Promise<string>` — returns a pre-signed GET URL |
| S3-04 | S3 bucket MUST have public access blocked — all access via pre-signed URLs only (SECURITY-09, NFR-09) |
| S3-05 | AWS credentials loaded from `AppConfig` — NEVER hardcoded |
| S3-06 | On S3 failure, throw `AppError` — do NOT expose AWS error details to callers |
| S3-07 | Extension point: `deleteFile()` and `copyFile()` methods to be added in later units (comment marker in code) |

**Pre-signed URL expiry defaults** (per NFR-09):
- Logo: 24 hours (same as Medical Cards and receipts)
- Reports: 1 hour
- Medical Cards: 24 hours
- Receipts: 24 hours

---

### 2.3 WebSocketService (Stub)

**File**: `src/shared/services/websocket.service.ts`  
**Pattern**: Init + no-op stubs (Answer D3=B)

**Rules**:

| Rule ID | Rule |
|---|---|
| WS-01 | `initWebSocketServer(server: http.Server): void` — creates `ws.WebSocketServer` attached to the HTTP server |
| WS-02 | Stores the `WebSocketServer` instance in a module-level variable |
| WS-03 | `registerConnection(userId: string, ws: WebSocket): void` — no-op stub (Unit 6 implements) |
| WS-04 | `removeConnection(userId: string): void` — no-op stub (Unit 6 implements) |
| WS-05 | `pushToUser(userId: string, payload: object): void` — no-op stub (Unit 6 implements) |
| WS-06 | Stub methods log a debug message: `[WS STUB] pushToUser called for userId: ${userId}` — useful for tracing during development |
| WS-07 | Full implementation (JWT auth on upgrade, connection registry, real delivery) deferred to Unit 6 |

---

### 2.4 AuditService (Stub)

**File**: `src/shared/services/audit.service.ts`  
**Pattern**: Single `AuditLogEntry` object parameter (Answer D4=C)

**Rules**:

| Rule ID | Rule |
|---|---|
| AUDIT-01 | `log(entry: AuditLogEntry): Promise<void>` — async to match Unit 6 signature |
| AUDIT-02 | Stub implementation: `console.log('[AUDIT STUB]', JSON.stringify(entry))` |
| AUDIT-03 | Sets `entry.timestamp = entry.timestamp ?? new Date()` before logging |
| AUDIT-04 | MUST NOT throw — audit failures must never block primary operations (FR-14.5) |
| AUDIT-05 | Wrapped in try/catch — any error is swallowed and logged to console.error |
| AUDIT-06 | Full implementation (MongoDB write, 365-day TTL, failure alerting) deferred to Unit 6 |

---

## 3. App Scaffold Business Rules

### 3.1 app.ts — Middleware Chain

**Middleware order** (Answer E1=B):

```
helmet()
  → cors(corsOptions)
  → express.json({ limit: '10mb' })
  → requestLogger
  → rateLimit (applied to /api/auth/* routes only)
  → routes (all module routers mounted here)
  → errorHandler (must be last)
```

**Rules**:

| Rule ID | Rule |
|---|---|
| APP-01 | `helmet()` applied globally — sets all required HTTP security headers (SECURITY-04) |
| APP-02 | CORS restricted to `CORS_ORIGINS` env var (comma-separated list) — NEVER wildcard on authenticated endpoints (SECURITY-08) |
| APP-03 | `express.json()` body parser with `limit: '10mb'` (covers largest expected payload — logo upload is handled via multipart separately) |
| APP-04 | `requestLogger` runs before routes so all requests are logged including those that fail routing |
| APP-05 | Rate limiting applied to `/api/auth/*` only in Unit 1 (FR-05.10, SECURITY-11) — window: `RATE_LIMIT_WINDOW_MS`, max: `RATE_LIMIT_MAX_REQUESTS` |
| APP-06 | `errorHandler` MUST be the last middleware registered (Express convention) |
| APP-07 | All module routes mounted under `/api/` prefix |
| APP-08 | Unmatched routes return 404 `{ status: 'error', message: 'Route not found' }` before `errorHandler` |

**CORS configuration**:

```typescript
const corsOptions = {
  origin: (origin, callback) => {
    const allowed = config.corsOrigins;
    if (!origin || allowed.includes(origin)) {
      callback(null, true);
    } else {
      callback(new AppError('Not allowed by CORS', 403));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
};
```

---

### 3.2 server.ts — Server Lifecycle

**Behavior**: Graceful shutdown + health check endpoint (Answer E3=C)

**Rules**:

| Rule ID | Rule |
|---|---|
| SRV-01 | Connect to MongoDB BEFORE starting HTTP server |
| SRV-02 | Initialize WebSocket server AFTER HTTP server starts |
| SRV-03 | `GET /health` returns `{ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }` — no auth required |
| SRV-04 | On `SIGTERM` or `SIGINT`: stop accepting new connections, close HTTP server, close MongoDB connection, then `process.exit(0)` |
| SRV-05 | Graceful shutdown timeout: 10 seconds — if not complete, force `process.exit(1)` |
| SRV-06 | Unhandled promise rejections: log error + `process.exit(1)` (fail closed — SECURITY-15) |
| SRV-07 | Uncaught exceptions: log error + `process.exit(1)` (fail closed — SECURITY-15) |

**Startup sequence**:

```
1. Load and validate env vars (dotenv-safe)
2. connectDatabase()
3. app.listen(PORT)
4. initWebSocketServer(httpServer)
5. Log: "HMS server running on port PORT"
```

---

## 4. Security Compliance Notes (SECURITY-01 through SECURITY-15)

| Rule | Status | Notes |
|---|---|---|
| SECURITY-01 | Addressed in Infrastructure Design | MongoDB TLS + S3 encryption configured at infra level |
| SECURITY-03 | Compliant | requestLogger excludes body/headers; SMTP/JWT secrets excluded from logs |
| SECURITY-04 | Compliant | helmet() in middleware chain covers all required headers |
| SECURITY-05 | Compliant | Zod validation on all API endpoints (per requirements); dotenv-safe for env |
| SECURITY-08 | Compliant | authenticateJWT + scopeTenant + requireRole chain; CORS restricted |
| SECURITY-09 | Compliant | errorHandler strips stack traces in production; S3 public access blocked |
| SECURITY-11 | Compliant | Rate limiting on auth routes; auth logic isolated in Auth module |
| SECURITY-12 | Addressed in U1-B | bcrypt, lockout, session invalidation in Auth module |
| SECURITY-15 | Compliant | Global error handler; unhandled rejection/exception handlers in server.ts; AuditService swallows errors |

---
