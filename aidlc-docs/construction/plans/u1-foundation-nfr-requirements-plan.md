# NFR Requirements Plan — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Requirements  
**Status**: Answers Collected — Artifacts Generated

---

## Execution Checklist

- [x] Step 1: Analyze functional design artifacts
- [x] Step 2: Generate NFR questions
- [x] Step 3: Collect answers
- [x] Step 4: Resolve ambiguities (BCRYPT_ROUNDS added to env; all answers unambiguous)
- [x] Step 5: Generate NFR requirements artifacts
- [x] Step 6: Present completion message

---

## Context Summary

Unit 1 Foundation provides the shared infrastructure for the entire HMS platform:
- Express app scaffold + middleware chain
- MongoDB connection management
- JWT authentication + token denylist
- Shared services: Email (Nodemailer), S3 (AWS SDK v3), WebSocket stub, AuditService stub
- All shared TypeScript types and env config

NFR decisions here cascade to all 7 units — choices made now set the baseline for the entire system.

---

## NFR Requirements Questions

Answer each question by filling in the `[Answer]:` tag below it.

---

### Section A: Performance Requirements

**A1.** The requirements specify API response time < 500ms at the 95th percentile (NFR-01). For the Foundation unit specifically, the middleware chain (helmet, cors, json parse, requestLogger, authenticateJWT, scopeTenant, requireRole) adds overhead to every request. What is the acceptable overhead budget for the full middleware chain?

- A) < 10ms per request (tight — suitable for high-throughput scenarios)
- B) < 25ms per request (moderate — reasonable for a hospital management system)
- C) No specific middleware budget — just meet the overall 500ms p95 target

[Answer]: B

---

**A2.** The token denylist is an in-memory Map. At 50 concurrent hospitals with ~50 active users each, the denylist could hold up to ~2,500 tokens at peak (8h JWT expiry). Is this acceptable, or do you want a size cap?

- A) No cap needed — 2,500 entries is trivial for in-memory storage
- B) Cap at 10,000 entries with LRU eviction (safety net for unexpected growth)
- C) Cap at 50,000 entries (very conservative upper bound)

[Answer]: A

---

**A3.** The `scopeTenant` middleware queries MongoDB on every authenticated request to verify tenant status. At 50 tenants and moderate load, this adds a DB round-trip per request. Should we add caching?

- A) No cache — always query MongoDB (simplest, always fresh data)
- B) In-memory cache with 60-second TTL (tenant status rarely changes; 60s staleness acceptable)
- C) In-memory cache with 5-minute TTL (tenant deactivation takes up to 5 min to propagate — acceptable for this phase)

[Answer]: B

---

### Section B: Scalability Requirements

**B1.** The requirements target 50 concurrent hospitals at launch (NFR-01). The MongoDB connection pool is set to `maxPoolSize: 10`. Is this sufficient, or should it be adjusted?

- A) 10 is fine for the initial phase
- B) Increase to 20 (more headroom for concurrent requests)
- C) Increase to 50 (one connection per potential concurrent hospital — conservative)

[Answer]: A

---

**B2.** The in-memory token denylist and tenant cache (if chosen in A3) are node-process-local. This means they don't work correctly if the app is scaled to multiple instances. How should this limitation be documented?

- A) Document as a known limitation in the README — acceptable for single-instance phase
- B) Document + add a TODO comment in the code pointing to the Redis migration path
- C) Document + add a TODO + add a startup warning log if `NODE_ENV=production` and no Redis URL is configured

[Answer]: B

---

### Section C: Availability Requirements

**C1.** The system targets 99.5% uptime (NFR-06). For the Foundation layer, what should happen if MongoDB becomes temporarily unavailable after startup?

- A) Return 503 Service Unavailable on all requests until MongoDB reconnects (Mongoose auto-reconnects in background)
- B) Return 503 + trigger a health check failure (so load balancer/orchestrator can restart the instance)
- C) Crash the process immediately (fail fast — let the orchestrator restart it)

[Answer]: A

---

**C2.** For the email service (Nodemailer), if SMTP is temporarily unavailable, should the system:

- A) Fail the operation immediately and return an error to the caller (e.g., user creation fails if welcome email can't be sent)
- B) Fail silently — log the error but don't fail the primary operation (user is created even if welcome email fails)
- C) Retry once after 2 seconds, then fail silently if still unavailable

[Answer]: A

---

### Section D: Security Requirements

**D1.** The requirements specify bcrypt cost factor ≥ 12 (FR-05.9, SECURITY-12). This is implemented in U1-B (Auth module), but the cost factor should be configurable via env. Should it be:

- A) Hardcoded to 12 in the Auth module (meets minimum, no config needed)
- B) Configurable via `BCRYPT_ROUNDS` env var with a default of 12
- C) Configurable via `BCRYPT_ROUNDS` env var with a minimum enforcement of 12 (reject values < 12 at startup)

[Answer]: B

---

**D2.** The rate limiter is applied to `/api/auth/*` routes. The requirements specify it for "public-facing endpoints" (SECURITY-11). Should rate limiting also be applied to:

- A) Auth routes only (as currently designed)
- B) Auth routes + any other unauthenticated public endpoints (e.g., `GET /health`, `POST /api/tenants/setup`)
- C) All routes globally (with a higher limit for authenticated routes, lower for public)

[Answer]: B

---

**D3.** The `requestLogger` logs userId and tenantId. Should it also log the HTTP method + URL for 4xx/5xx responses to a separate error log channel (useful for security monitoring)?

- A) No — single log stream is sufficient
- B) Yes — log 4xx/5xx to a separate `error` log level (same stream, different level)
- C) Yes — log 4xx/5xx with full request context (method, url, status, userId, tenantId, correlationId) at `warn`/`error` level

[Answer]: C

---

### Section E: Tech Stack Confirmation

**E1.** The following packages are needed for Unit 1 Foundation. Please confirm or adjust versions:

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^8.3.0",
    "jsonwebtoken": "^9.0.2",
    "dotenv-safe": "^8.2.0",
    "helmet": "^7.1.0",
    "cors": "^2.8.5",
    "express-rate-limit": "^7.2.0",
    "nodemailer": "^6.9.13",
    "@aws-sdk/client-s3": "^3.575.0",
    "@aws-sdk/s3-request-presigner": "^3.575.0",
    "ws": "^8.17.0",
    "uuid": "^9.0.1"
    
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/nodemailer": "^6.4.14",
    "@types/ws": "^8.5.10",
    "@types/uuid": "^9.0.8",
    "@types/cors": "^2.8.17",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.12",
    "ts-jest": "^29.1.4",
    "fast-check": "^3.19.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- A) These versions are correct — use as-is
- B) I want to adjust some versions or add/remove packages (please specify)

[Answer]: B ("zod": "^3.23.8",
    "bcryptjs": "^2.4.3", "@types/bcryptjs": "^2.4.6",)

---

**E2.** For structured logging (SECURITY-03 requires structured logs with correlation IDs), should we add a logging library or use `console.log` with JSON.stringify?

- A) `console.log` with `JSON.stringify` — no extra dependency, sufficient for this phase
- B) Add `pino` (fast, low-overhead structured logger, widely used with Express)
- C) Add `winston` (more configurable, multiple transports, familiar to many teams)

[Answer]:A

---

**E3.** TypeScript compilation target and module system:

- A) `target: ES2020`, `module: CommonJS` (Node.js native, no ESM complexity)
- B) `target: ES2022`, `module: CommonJS` (newer JS features, still CommonJS)
- C) `target: ES2022`, `module: NodeNext` (ESM-first, requires `.js` extensions in imports)

[Answer]: A

---

### Section F: Reliability & Maintainability

**F1.** For the `env.ts` config, should the exported config object be:

- A) A plain object (mutable — could be accidentally modified at runtime)
- B) `Object.freeze(config)` — shallow freeze (prevents top-level mutation)
- C) Deep frozen using a recursive freeze utility (prevents nested mutation too)

[Answer]: B

---

**F2.** Should the Foundation unit include a `src/shared/utils/` directory for common utilities (e.g., `generateId()`, `formatDate()`, `sanitizeString()`)? Or keep shared utilities minimal and add them only when needed by later units?

- A) No utils directory yet — add utilities only when a later unit needs them
- B) Create `src/shared/utils/` now with just `generateId()` (UUID v4 wrapper) and `formatDate()` (ISO 8601 formatter) — these will definitely be needed
- C) Create `src/shared/utils/` with a broader set: `generateId()`, `formatDate()`, `sanitizeString()`, `paginate()` helper

[Answer]: B

---

### Section G: PBT Framework (PBT-09 Compliance)

**G1.** `fast-check` is already selected (PBT-09, confirmed in requirements). The Jest + ts-jest + fast-check stack is included in the package.json above (E1). Should the test configuration use:

- A) A single `jest.config.ts` for both unit and integration tests (simpler)
- B) Separate configs: `jest.unit.config.ts` and `jest.integration.config.ts` (allows running them independently in CI)
- C) Single config with test path patterns that allow `npm run test:unit` and `npm run test:integration` as separate scripts

[Answer]: C

---
