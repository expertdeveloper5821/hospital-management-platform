# NFR Design Plan — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Design  
**Status**: Answers Collected — Artifacts Generated

---

## Execution Checklist

- [x] Step 1: Analyze NFR requirements artifacts
- [x] Step 2: Generate NFR design questions
- [x] Step 3: Collect answers
- [x] Step 4: Resolve ambiguities (all answers unambiguous)
- [x] Step 5: Generate NFR design artifacts
- [x] Step 6: Present completion message

---

## Context Summary

From NFR Requirements, the following patterns need design decisions:

**Resilience patterns needed**:
- MongoDB unavailability → 503 response pattern
- Email failure → fail-fast pattern
- Unhandled exceptions → fail-closed pattern

**Scalability patterns needed**:
- Tenant status cache (60s TTL in-memory Map)
- Token denylist (in-memory Map, no cap)
- Redis migration path documentation

**Performance patterns needed**:
- Middleware chain < 25ms budget
- Compound MongoDB indexes on (tenantId, field)

**Security patterns needed**:
- Rate limiting on auth + public endpoints
- Structured error responses (no stack traces in prod)
- Correlation ID propagation

**Logical components to design**:
- Tenant cache component
- Rate limiter configuration
- Structured logger component
- Health check component

---

## NFR Design Questions

Answer each question by filling in the `[Answer]:` tag below it.

---

### Section A: Resilience Patterns

**A1.** For the MongoDB 503 pattern — when a DB-dependent route handler catches a Mongoose connection error, how should it detect that the error is a connectivity issue (vs. a query error like validation failure)?

- A) Check `error.name === 'MongoNetworkError' || error.name === 'MongoServerSelectionError'` — return 503 for these, 500 for others
- B) Check `mongoose.connection.readyState !== 1` before every DB operation — return 503 proactively if not connected
- C) Both: check readyState before the operation AND catch network errors, returning 503 in both cases

[Answer]: C

---

**A2.** For the email fail-fast pattern — when `EmailService.sendEmail()` throws, the calling service (e.g., `TenantService.createTenant()`) needs to handle it. Should the error propagation be:

- A) Let the error bubble up naturally — the global `errorHandler` catches it and returns 500
- B) Catch in the service layer, wrap in a domain-specific `AppError` with a user-friendly message (e.g., "Tenant created but invite email could not be sent — please resend manually"), return 500 with that message
- C) Catch in the service layer, throw a specific `EmailDeliveryError extends AppError` with `statusCode: 503` so the API returns 503 (Service Unavailable) rather than 500

[Answer]: B

---

**A3.** The `server.ts` registers handlers for `unhandledRejection` and `uncaughtException`. Should these handlers:

- A) Log the error and call `process.exit(1)` immediately
- B) Log the error, attempt graceful shutdown (close HTTP server + MongoDB), then `process.exit(1)`
- C) Log the error and `process.exit(1)` — but only after a 1-second delay to allow the log to flush

[Answer]: B

---

### Section B: Scalability Patterns

**B1.** The tenant status cache needs a design. The simplest approach is a plain `Map<string, { status: TenantStatus, cachedAt: number }>`. Should the cache also track hit/miss counts for observability?

- A) No — plain Map, no metrics
- B) Yes — track `hits` and `misses` counters, log them periodically (e.g., every 100 requests) at `info` level
- C) Yes — expose hit/miss counts on the `GET /health` endpoint so they're visible without log parsing

[Answer]: B

---

**B2.** The Redis migration TODO comments need a consistent format. Which format should be used across all three files (token-denylist.ts, scope-tenant.ts, websocket.service.ts)?

- A) `// TODO(scale): Replace with Redis — single-instance only`
- B) `// TODO(scale): Replace with Redis <ServiceName>. See docs/scaling.md for migration guide.`
- C) A multi-line JSDoc comment block explaining the limitation, current behavior, and Redis replacement approach

[Answer]: B

---

### Section C: Performance Patterns

**C1.** MongoDB compound indexes need to be defined somewhere. For Unit 1, the relevant collections are `users`, `tenants`, `super_admins`. Where should index definitions live?

- A) Defined inline in each Mongoose schema using `schema.index({ tenantId: 1, email: 1 })` — co-located with the model
- B) Defined in a separate `src/shared/config/indexes.ts` file that runs after DB connection — centralized
- C) Defined in Mongoose schema options (`{ indexes: [...] }`) — declarative, runs automatically on model registration

[Answer]: A

---

**C2.** The `requestLogger` needs to measure response time. The standard approach is `Date.now()` on request start vs. response finish. Should it use:

- A) `Date.now()` — millisecond precision, sufficient for 25ms budget monitoring
- B) `process.hrtime.bigint()` — nanosecond precision, more accurate for tight budgets
- C) `performance.now()` — high-resolution, part of Node.js built-ins since v16

[Answer]: A

---

### Section D: Security Patterns

**D1.** The rate limiter needs a key function to identify clients. The default is IP address. For a hospital system behind a load balancer or reverse proxy, the real IP may be in `X-Forwarded-For`. How should the rate limiter identify clients?

- A) Use `req.ip` (Express default — works if `app.set('trust proxy', 1)` is configured)
- B) Use `X-Forwarded-For` header directly (parse first IP in the chain)
- C) Use `req.ip` with `app.set('trust proxy', 1)` configured in `app.ts` — Express handles the X-Forwarded-For parsing correctly

[Answer]: C

---

**D2.** The structured error response pattern needs a consistent `AppError` hierarchy. Beyond the base `AppError`, should we define specific subclasses now?

- A) Just `AppError` — callers set `statusCode` directly (e.g., `new AppError('Not found', 404)`)
- B) Define `NotFoundError` (404), `UnauthorizedError` (401), `ForbiddenError` (403), `ValidationError` (400) as subclasses — cleaner throw sites
- C) Option B + `ServiceUnavailableError` (503) and `ConflictError` (409) — covers all common HTTP error scenarios in HMS

[Answer]: C

---

**D3.** The correlation ID needs to be propagated to outbound calls (email, S3, MongoDB operations) for end-to-end tracing. Should the correlation ID be:

- A) Only on HTTP responses (X-Correlation-ID header) — no propagation to outbound calls
- B) Passed explicitly to service methods that make outbound calls (e.g., `emailService.sendInviteEmail(to, link, correlationId)`)
- C) Stored in AsyncLocalStorage so it's automatically available anywhere in the request context without passing it explicitly

[Answer]: C

---

### Section E: Logical Components

**E1.** The tenant cache is a logical component that sits between `scopeTenant` middleware and MongoDB. Should it be implemented as:

- A) A plain module-level Map in `scope-tenant.ts` — simple, co-located
- B) A separate `TenantCache` class in `src/shared/config/tenant-cache.ts` — encapsulated, easier to swap for Redis
- C) A generic `TTLCache<K, V>` class in `src/shared/utils/ttl-cache.ts` — reusable for both tenant cache and any future caching needs

[Answer]: B

---

**E2.** The health check endpoint (`GET /health`) is currently defined in `server.ts`. Should it be:

- A) Defined inline in `server.ts` as a simple route before `app` is used
- B) Moved to a dedicated `src/shared/routes/health.routes.ts` and mounted in `app.ts`
- C) Defined in `app.ts` directly as the first route (before all module routes)

[Answer]: B

---
