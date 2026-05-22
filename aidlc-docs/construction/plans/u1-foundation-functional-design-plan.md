# Functional Design Plan — Unit 1: Foundation (U1-A: Shared Foundation)

**Unit**: Unit 1 — Foundation  
**Subunit Focus**: U1-A: Shared Foundation (types, config, middleware, app scaffold)  
**Stage**: Functional Design  
**Status**: Answers Collected — Artifacts Generated

---

## Scope of This Plan

U1-A is the critical-path subunit that all other Unit 1 subunits (U1-B Auth, U1-C Tenant, U1-D User) depend on.
It covers:
- All shared TypeScript types
- Environment configuration loader
- MongoDB connection setup
- All Express middleware functions
- Shared services: Email, S3, WebSocket (server init stub)
- AuditService stub
- Express app scaffold (app.ts + server.ts)

Stories covered by Unit 1 (all require U1-A foundation):
US-SA-01, US-SA-02, US-HA-01, US-HA-02, US-HR-01, US-ST-01, US-CC-01

---

## Execution Checklist

- [x] Step 1: Analyze unit context (complete — artifacts loaded)
- [x] Step 2: Generate functional design questions
- [x] Step 3: Collect answers
- [x] Step 4: Resolve ambiguities (CORS_ORIGINS added to env list; all answers unambiguous)
- [x] Step 5: Generate functional design artifacts
- [ ] Step 6: Present completion message

---

## Functional Design Questions

Answer each question by filling in the `[Answer]:` tag below it.

---

### Section A: Shared TypeScript Types

**A1.** The `UserRole` enum needs to cover all roles in the system. Based on the requirements, the roles are:
`SUPER_ADMIN`, `HOSPITAL_ADMIN`, `MANAGER`, `DOCTOR`, `NURSE`, `RECEPTIONIST`, `PATHOLOGIST`, `RADIOLOGIST`, `FINANCE_MANAGER`, `HR`, `ADMIN`, `STAFF`.

Should `UserRole` be a TypeScript `enum` or a `const object` (i.e., `as const` union type)?

- A) TypeScript `enum` (e.g., `enum UserRole { SUPER_ADMIN = 'SUPER_ADMIN', ... }`)
- B) `const` object with union type (e.g., `const UserRole = { SUPER_ADMIN: 'SUPER_ADMIN', ... } as const; type UserRole = typeof UserRole[keyof typeof UserRole]`)
- C) Simple string union type only (e.g., `type UserRole = 'SUPER_ADMIN' | 'HOSPITAL_ADMIN' | ...`)

[Answer]: B. `const` object with union type

---

**A2.** The `TenantStatus` type covers: `PENDING_VERIFICATION`, `ACTIVE`, `INACTIVE`. Same question — enum, const object, or string union?

- A) TypeScript `enum`
- B) `const` object with union type
- C) Simple string union type

[Answer]: B

---

**A3.** The `JWTPayload` interface needs to carry: `userId`, `tenantId`, `role`, and `exp` (expiry). Should it also carry:

- A) Just those 4 fields
- B) Add `email` (useful for audit logging without a DB lookup)
- C) Add `email` + `isFirstLogin` flag (so middleware can enforce first-password-change without a DB lookup)
- D) Add `email` + `isFirstLogin` + `isSuperAdmin` boolean (to distinguish Super Admin tokens which have no tenantId)

[Answer]: C

---

**A4.** For `PaginatedResult<T>`, the standard shape is `{ data: T[], total: number, page: number, limit: number }`. Should we also include:

- A) Just those 4 fields
- B) Add `totalPages: number` (computed as `Math.ceil(total / limit)`)
- C) Add `totalPages` + `hasNextPage: boolean` + `hasPrevPage: boolean`

[Answer]: B

---

**A5.** The `AuditEntityType` enum/union needs to cover all auditable entities. Based on requirements (FR-14), these are: `PATIENT`, `OPD_VISIT`, `IPD_ADMISSION`, `PATHOLOGY_REQUEST`, `RADIOLOGY_REQUEST`, `INVENTORY_ITEM`, `PAYMENT_RECORD`, `USER_ACCOUNT`. Should we also include `TENANT` (for branding updates) and `AUTH` (for login/lockout events)?

- A) Only the 8 entities listed in FR-14
- B) Add `TENANT` (branding/lifecycle changes are auditable)
- C) Add `TENANT` + `AUTH` (login, lockout, password reset events)

[Answer]: C

---

### Section B: Environment Configuration (env.ts)

**B1.** The `env.ts` module should validate required environment variables at startup and fail fast if any are missing. Which validation approach do you prefer?

- A) Manual checks with `process.env.VAR || throw new Error(...)` pattern
- B) Use `zod` to define an env schema and parse `process.env` — throws a descriptive error listing all missing/invalid vars at once
- C) Use `dotenv-safe` (validates against a `.env.example` file)

[Answer]: C

---

**B2.** The following env vars are needed for Unit 1. Are there any you want to rename, add, or remove?

```
# Server
PORT=3000
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://...

# JWT
JWT_SECRET=...
JWT_EXPIRY=8h
INVITE_JWT_SECRET=...
INVITE_JWT_EXPIRY=48h
RESET_TOKEN_EXPIRY=1h

# Email (SMTP)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...

# AWS S3
AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=...

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

- A) This list is correct as-is
- B) I want to add/rename/remove some vars (please specify in your answer)

[Answer]: A

---

### Section C: Middleware Design

**C1.** The `authenticateJWT` middleware needs to handle the token denylist (in-memory Map). Where should the denylist Map live?

- A) Module-level singleton in `authenticate-jwt.ts` (simple, co-located with the middleware)
- B) Separate `token-denylist.ts` module in `shared/` (cleaner separation, easier to swap for Redis later)
- C) Inside the Auth module (`src/modules/auth/`) since it's auth-specific logic

[Answer]: B

---

**C2.** The `requireRole` middleware needs to accept one or more allowed roles. What signature do you prefer?

- A) `requireRole(...roles: UserRole[])` — variadic, e.g., `requireRole('DOCTOR', 'MANAGER')`
- B) `requireRole(roles: UserRole[])` — array, e.g., `requireRole(['DOCTOR', 'MANAGER'])`
- C) `requireRole(roles: UserRole | UserRole[])` — accepts both single and array

[Answer]: A

---

**C3.** The `requestLogger` middleware should log each incoming request. What fields should it log?

- A) Method, URL, status code, response time (ms), correlation ID
- B) Method, URL, status code, response time, correlation ID, user ID (from JWT if present), tenant ID (from JWT if present)
- C) Option B + request body size (bytes) — no body content, just size

[Answer]: B

---

**C4.** The `errorHandler` middleware is the global Express error handler. For production (`NODE_ENV=production`), it should return `{ status: "error", message: string }` without stack traces. For development, should it:

- A) Include the full stack trace in the response
- B) Include the error message only (same as production, but log full stack to console)
- C) Include stack trace in response AND log to console

[Answer]: C

---

### Section D: Shared Services

**D1.** The `email.service.ts` should expose a typed interface. Which approach do you prefer for defining email templates?

- A) Single `sendEmail(to, subject, html)` method — callers build their own HTML
- B) Typed methods per email type: `sendInviteEmail(to, inviteLink)`, `sendWelcomeEmail(to, tempPassword)`, `sendAccountLockEmail(to)`, `sendPasswordResetEmail(to, resetLink)` — service owns the templates
- C) Option B but with a generic `sendTemplatedEmail(template: EmailTemplate, data: object)` base method underneath

[Answer]: C

---

**D2.** The `s3.service.ts` in Unit 1 handles logo uploads only (reports and PDFs come in later units). Should the service be designed as:

- A) Minimal — only `uploadFile(key, buffer, mimeType)` and `getPresignedUrl(key, expirySeconds)` for now; other methods added in later units
- B) Full interface upfront — define all methods now (`uploadFile`, `getPresignedUrl`, `deleteFile`) even if some aren't used until later units
- C) Minimal with a clear extension comment marking where later units will add methods

[Answer]: C

---

**D3.** The `websocket.service.ts` in Unit 1 is a stub — it initializes the WebSocket server and sets up the connection registry, but actual delivery is implemented in Unit 6. What should the stub expose?

- A) Just `initWebSocketServer(server: http.Server): void` — no other methods yet
- B) `initWebSocketServer(server)` + stub methods `registerConnection(userId, ws)`, `removeConnection(userId)`, `pushToUser(userId, payload)` that are no-ops (empty implementations) — so callers in later units can import and call them without errors
- C) Option B but stub methods throw `new Error('Not implemented until Unit 6')` to make it obvious they're stubs

[Answer]: B

---

**D4.** The `AuditService` stub in Unit 1 should have a `log()` method that writes to `console.log` (no DB yet). What signature should it have?

- A) `log(entityType: AuditEntityType, entityId: string, action: 'CREATE' | 'UPDATE' | 'DELETE', userId: string, tenantId: string, previousValue?: object, newValue?: object): void`
- B) Same as A but returns `Promise<void>` (async) so callers don't need to change the call signature when Unit 6 replaces it with a real DB write
- C) Accept a single `AuditLogEntry` object parameter for cleaner call sites

[Answer]: C

---

### Section E: App Scaffold

**E1.** The `app.ts` file wires up all global middleware and routes. What order should the middleware chain follow?

- A) helmet → cors → rateLimit (auth routes only) → express.json → requestLogger → routes → errorHandler
- B) helmet → cors → express.json → requestLogger → rateLimit (auth routes only) → routes → errorHandler
- C) helmet → cors → express.json → rateLimit (auth routes only) → requestLogger → routes → errorHandler

[Answer]: B

---

**E2.** For CORS configuration in `app.ts`, the allowed origins should come from env vars. Should the CORS config:

- A) Allow a single origin from `CORS_ORIGIN` env var
- B) Allow a comma-separated list of origins from `CORS_ORIGINS` env var (supports multiple frontends/environments)
- C) Allow a single origin in production, but allow all origins in development (`NODE_ENV=development`)

[Answer]: B

---

**E3.** The `server.ts` file starts the HTTP server and attaches the WebSocket server. Should it also handle:

- A) Just start the server — no graceful shutdown handling
- B) Graceful shutdown on `SIGTERM`/`SIGINT` — close HTTP server, close MongoDB connection, then exit
- C) Option B + a health check endpoint (`GET /health`) that returns `{ status: 'ok', uptime: number }`

[Answer]: C

---

### Section F: PBT Property Identification (PBT-01 Compliance)

**F1.** For U1-A Shared Foundation, the following components have been analyzed for testable properties:

| Component | Identified Properties | Category |
|---|---|---|
| `env.ts` validation | Valid env → parsed object → re-serialized → same values | Round-trip |
| `authenticateJWT` middleware | Valid JWT → decoded → re-encoded → same payload | Round-trip |
| `requireRole` middleware | Role check is idempotent (calling twice = same result) | Idempotence |
| `requestLogger` | Correlation ID generation: all generated IDs are unique (invariant) | Invariant |
| `PaginatedResult<T>` | `totalPages = ceil(total / limit)` always holds | Invariant |

Do you want to add any additional properties to test, or are these sufficient for U1-A?

- A) These are sufficient for U1-A
- B) Add more (please specify)

[Answer]: A

---
