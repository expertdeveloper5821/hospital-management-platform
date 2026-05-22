# NFR Requirements — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Requirements  
**Status**: Approved

---

## 1. Performance Requirements

### 1.1 Middleware Chain Overhead

| Requirement | Value | Source |
|---|---|---|
| Maximum middleware chain overhead | < 25ms per request (p95) | Answer A1=B |
| Overall API response time target | < 500ms (p95) | NFR-01 |
| Middleware budget as % of total | ~5% of 500ms budget | Derived |

**Breakdown target per middleware**:

| Middleware | Target Overhead |
|---|---|
| helmet + cors | < 1ms |
| express.json (parse) | < 2ms |
| requestLogger (UUID gen + attach) | < 1ms |
| authenticateJWT (JWT verify + denylist lookup) | < 5ms |
| scopeTenant (cache hit) | < 2ms |
| scopeTenant (cache miss → MongoDB) | < 15ms |
| requireRole (in-memory check) | < 1ms |
| **Total (cache hit path)** | **< 12ms** |
| **Total (cache miss path)** | **< 25ms** |

### 1.2 Token Denylist Performance

| Requirement | Value | Source |
|---|---|---|
| Denylist storage | In-memory Map | Requirements |
| Size cap | None (2,500 entries at 50 hospitals × 50 users is trivial) | Answer A2=A |
| Lookup time | O(1) — Map.has() | Inherent |
| Lazy cleanup | On every isInDenylist() call — expired entries removed | Business rule DL-04 |
| Memory estimate at peak | ~2,500 tokens × ~500 bytes = ~1.25 MB | Calculated |

### 1.3 Tenant Status Cache

| Requirement | Value | Source |
|---|---|---|
| Cache type | In-memory Map (tenantId → { status, cachedAt }) | Answer A3=B |
| TTL | 60 seconds | Answer A3=B |
| Cache invalidation | TTL-based only (no active invalidation in this phase) | Answer A3=B |
| Staleness window | Up to 60 seconds after tenant deactivation | Accepted trade-off |
| Cache miss behavior | Query MongoDB, cache result, proceed | Business rule MW-SCOPE-04 |
| Known limitation | Single-instance only — multi-instance requires Redis | Answer B2=B |

**Staleness acceptance rationale**: Tenant deactivation is an administrative action performed by Super Admin. A 60-second propagation delay is acceptable for a hospital management system at this scale.

---

## 2. Scalability Requirements

### 2.1 MongoDB Connection Pool

| Requirement | Value | Source |
|---|---|---|
| maxPoolSize | 10 | Answer B1=A |
| serverSelectionTimeoutMS | 5,000ms | Functional design |
| socketTimeoutMS | 45,000ms | Functional design |
| Rationale | Sufficient for 50 hospitals at initial phase; pool size revisited at scale | NFR-01 |

### 2.2 Single-Instance Limitations

| Component | Limitation | Migration Path | Documentation |
|---|---|---|---|
| Token denylist | In-memory Map — not shared across instances | Replace with Redis SETEX | TODO comment in token-denylist.ts |
| Tenant status cache | In-memory Map — not shared across instances | Replace with Redis GET/SETEX | TODO comment in scope-tenant.ts |
| WebSocket connections | In-memory registry — not shared across instances | Replace with Redis Pub/Sub | TODO comment in websocket.service.ts |

**Documentation requirement** (Answer B2=B): Each affected file MUST include a `// TODO(scale): Replace with Redis — see docs/scaling.md` comment at the relevant data structure declaration.

---

## 3. Availability Requirements

### 3.1 MongoDB Unavailability Handling

| Scenario | Behavior | Source |
|---|---|---|
| MongoDB unavailable at startup | `process.exit(1)` — fail fast | Business rule SRV-01 |
| MongoDB disconnects after startup | Return 503 on all DB-dependent requests; Mongoose auto-reconnects in background | Answer C1=A |
| MongoDB reconnects | Requests resume normally; no restart required | Mongoose built-in |
| Health check during DB outage | `GET /health` still returns 200 (process is alive) | Answer C1=A — health check is process-level, not DB-level |

**503 response format**:
```json
{ "status": "error", "message": "Service temporarily unavailable — please retry" }
```

### 3.2 Email Service Availability

| Scenario | Behavior | Source |
|---|---|---|
| SMTP unavailable | Fail the primary operation — throw AppError | Answer C2=A |
| Rationale | Invite links, welcome emails, and password resets are critical flows — silent failure would leave users without access credentials | Answer C2=A |
| Caller responsibility | Callers (Auth, Tenant, User modules) must handle email failure and return appropriate error to API consumer | Derived |

**Impact on user-facing operations**:
- `POST /api/tenants` (create tenant) — fails if invite email cannot be sent
- `POST /api/users` (create user) — fails if welcome email cannot be sent
- `POST /api/auth/forgot-password` — fails if reset email cannot be sent
- `PATCH /api/tenants/:id/approve` — fails if invite email cannot be sent

---

## 4. Security Requirements

### 4.1 bcrypt Configuration

| Requirement | Value | Source |
|---|---|---|
| Configuration | `BCRYPT_ROUNDS` env var | Answer D1=B |
| Default value | 12 | FR-05.9, SECURITY-12 |
| Minimum enforced | No startup enforcement — developer responsibility | Answer D1=B |
| Added to .env.example | `BCRYPT_ROUNDS=12` | Derived |
| Note | Values < 12 are not rejected at startup but violate SECURITY-12 — code review responsibility | Answer D1=B |

### 4.2 Rate Limiting Scope

| Endpoint Group | Rate Limit Applied | Window | Max Requests | Source |
|---|---|---|---|---|
| `POST /api/auth/login` | Yes | 15 min | 100 | FR-05.10, SECURITY-11 |
| `POST /api/auth/forgot-password` | Yes | 15 min | 100 | SECURITY-11 |
| `POST /api/auth/reset-password` | Yes | 15 min | 100 | SECURITY-11 |
| `POST /api/tenants/setup` (invite consumption) | Yes | 15 min | 100 | Answer D2=B |
| `GET /health` | Yes | 15 min | 100 | Answer D2=B |
| All authenticated routes | No rate limit (auth middleware protects them) | — | — | Answer D2=B |

**Implementation**: Two rate limiter instances — one for `/api/auth/*` routes, one for other public endpoints. Both use the same `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` env vars.

### 4.3 Error Logging for Security Monitoring

| Requirement | Value | Source |
|---|---|---|
| 4xx/5xx log level | `warn` (4xx) / `error` (5xx) | Answer D3=C |
| Fields logged on 4xx/5xx | method, url, statusCode, userId?, tenantId?, correlationId, responseTimeMs | Answer D3=C |
| Log format | Structured JSON (same stream, different log level) | Answer D3=C + SECURITY-03 |
| Sensitive data exclusion | No request body, no Authorization header, no passwords | SECURITY-03 |

**Log level mapping**:
- `400–499`: `warn` level — client errors, potential abuse indicators
- `500–599`: `error` level — server errors, requires investigation
- `200–399`: `info` level — normal operations

### 4.4 Security Rules Compliance Summary

| Rule | Status | Notes |
|---|---|---|
| SECURITY-01 | Deferred to Infrastructure Design | MongoDB TLS + S3 encryption at infra level |
| SECURITY-02 | Deferred to Infrastructure Design | Load balancer access logging |
| SECURITY-03 | Compliant | Structured JSON logs; sensitive data excluded; correlation IDs on all requests |
| SECURITY-04 | Compliant | helmet() covers all required headers |
| SECURITY-05 | Compliant | Zod on all API endpoints; dotenv-safe for env; parameterized Mongoose queries |
| SECURITY-06 | Deferred to Infrastructure Design | IAM least-privilege policies |
| SECURITY-07 | Deferred to Infrastructure Design | Security groups, VPC config |
| SECURITY-08 | Compliant | authenticateJWT + scopeTenant + requireRole chain; CORS restricted to CORS_ORIGINS |
| SECURITY-09 | Compliant | errorHandler strips stack traces in production; S3 public access blocked |
| SECURITY-10 | Compliant | Exact versions in package.json; lock file committed; vulnerability scan in CI |
| SECURITY-11 | Compliant | Rate limiting on auth + public endpoints; auth logic isolated |
| SECURITY-12 | Partially compliant | bcrypt via BCRYPT_ROUNDS env var (U1-B implements hashing); MFA deferred |
| SECURITY-13 | Compliant | AuditService logs all critical changes; append-only design |
| SECURITY-14 | Partially compliant | 4xx/5xx logged at warn/error; alerting deferred to Infrastructure Design |
| SECURITY-15 | Compliant | Global error handler; unhandled rejection/exception handlers; fail-closed on DB error |

---

## 5. Reliability & Maintainability Requirements

### 5.1 Configuration Immutability

| Requirement | Value | Source |
|---|---|---|
| Config object | `Object.freeze(config)` — shallow freeze | Answer F1=B |
| Nested objects | Mutable (shallow freeze only) — acceptable for this phase | Answer F1=B |
| Rationale | Prevents accidental top-level reassignment; nested mutation is unlikely in practice | Answer F1=B |

### 5.2 Shared Utilities

| Utility | Function | Source |
|---|---|---|
| `generateId()` | UUID v4 wrapper — `import { v4 as uuidv4 } from 'uuid'; return uuidv4()` | Answer F2=B |
| `formatDate(date)` | ISO 8601 formatter — `date.toISOString()` | Answer F2=B |
| Location | `src/shared/utils/index.ts` | Answer F2=B |

---

## 6. PBT Framework Requirements (PBT-09)

| Requirement | Value | Source |
|---|---|---|
| Framework | `fast-check` v3.19.0 | PBT-09, Answer E1 |
| Test runner | Jest v29.7.0 + ts-jest v29.1.4 | Answer E1 |
| Test config | Single `jest.config.ts` with separate npm scripts | Answer G1=C |
| Unit test script | `npm run test:unit` — runs `tests/unit/**/*.test.ts` | Answer G1=C |
| Integration test script | `npm run test:integration` — runs `tests/integration/**/*.test.ts` | Answer G1=C |
| CI seed logging | PBT seed logged on every run for reproducibility | PBT-08 |
| Shrinking | Enabled (fast-check default) — never disabled | PBT-08 |

**npm scripts**:
```json
{
  "test": "jest",
  "test:unit": "jest --testPathPattern=tests/unit",
  "test:integration": "jest --testPathPattern=tests/integration",
  "test:coverage": "jest --coverage"
}
```

---
