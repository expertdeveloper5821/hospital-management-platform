# NFR Design Patterns — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Design  
**Status**: Approved

---

## 1. Resilience Patterns

### 1.1 MongoDB Unavailability — Dual-Guard Pattern

**Pattern**: Check-then-catch (Answer A1=C)

Two layers of protection for every DB-dependent operation:

**Layer 1 — Pre-flight readyState check** (in a shared utility or base repository):
```typescript
// src/shared/utils/db-guard.ts
import mongoose from 'mongoose';
import { ServiceUnavailableError } from '../middleware/error-handler';

export function assertDbConnected(): void {
  if (mongoose.connection.readyState !== 1) {
    throw new ServiceUnavailableError(
      'Database temporarily unavailable — please retry shortly'
    );
  }
}
```

**Layer 2 — Network error catch** (in the global errorHandler):
```typescript
// In error-handler.ts — classify Mongoose network errors as 503
const MONGO_NETWORK_ERRORS = [
  'MongoNetworkError',
  'MongoServerSelectionError',
  'MongoTimeoutError',
];

if (MONGO_NETWORK_ERRORS.includes(err.name)) {
  statusCode = 503;
  message = 'Database temporarily unavailable — please retry shortly';
}
```

**Flow**:
```
Request arrives
    |
    v
Repository method called
    |
    v
assertDbConnected()  <-- Layer 1: proactive check
    |
    +-- readyState !== 1 --> throw ServiceUnavailableError(503)
    |
    v
Execute Mongoose query
    |
    +-- MongoNetworkError --> caught by errorHandler --> 503  <-- Layer 2
    +-- MongoServerSelectionError --> caught by errorHandler --> 503
    +-- ValidationError --> caught by errorHandler --> 400/500
    +-- Success --> return result
```

---

### 1.2 Email Failure — Domain Error Wrapping Pattern

**Pattern**: Service-layer catch + domain AppError (Answer A2=B)

Calling services catch `EmailService` errors and wrap them in a user-friendly `AppError` with context about what partially succeeded:

```typescript
// Pattern used in TenantService, UserService, AuthService
try {
  await emailService.sendInviteEmail(to, inviteLink);
} catch (emailErr) {
  // Log the technical error for ops visibility
  console.error('[EMAIL_FAILURE]', {
    correlationId: requestContext.get('correlationId'),
    operation: 'sendInviteEmail',
    error: emailErr.message,
  });
  // Throw a user-friendly domain error — primary operation has NOT been committed yet
  throw new AppError(
    'Unable to send invite email. Please check SMTP configuration and retry.',
    500
  );
}
```

**Key principle**: Email is sent BEFORE committing the primary DB write where possible (e.g., tenant approval). If email fails, the DB write is not committed — the operation is atomic from the user's perspective.

**Exception**: For operations where the DB write must happen first (e.g., user creation with a generated ID needed in the email), the error message acknowledges partial success:
```
"User account created but welcome email could not be sent. 
 Please resend the welcome email from the user management panel."
```

---

### 1.3 Unhandled Exception — Graceful Shutdown Pattern

**Pattern**: Log → graceful shutdown → exit(1) (Answer A3=B)

```typescript
// server.ts
async function gracefulShutdown(signal: string, error?: Error): Promise<void> {
  console.error(JSON.stringify({
    level: 'error',
    event: 'process_termination',
    signal,
    error: error?.message,
    stack: error?.stack,
    timestamp: new Date().toISOString(),
  }));

  const shutdownTimeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  try {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await mongoose.connection.close();
    clearTimeout(shutdownTimeout);
    process.exit(1);  // exit(1) for unexpected termination
  } catch {
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  gracefulShutdown('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  gracefulShutdown('uncaughtException', error);
});

// Graceful SIGTERM/SIGINT (normal shutdown) uses process.exit(0)
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
```

---

## 2. Scalability Patterns

### 2.1 In-Memory Cache with Observability

**Pattern**: Encapsulated TTL cache with hit/miss logging (Answers B1=B, E1=B)

The `TenantCache` class (in `src/shared/config/tenant-cache.ts`) encapsulates the cache Map, TTL logic, and observability counters:

```
TenantCache
  |
  +-- cache: Map<tenantId, { status, cachedAt }>
  |
  +-- hits: number
  +-- misses: number
  +-- requestCount: number
  |
  +-- get(tenantId): TenantStatus | null
  |     - Check if entry exists and not expired (Date.now() - cachedAt < TTL_MS)
  |     - Hit: increment hits, requestCount; return status
  |     - Miss/expired: increment misses, requestCount; delete entry; return null
  |     - Every 100 requests: log { hits, misses, hitRate, cacheSize }
  |
  +-- set(tenantId, status): void
  |     - Store { status, cachedAt: Date.now() }
  |
  +-- invalidate(tenantId): void
  |     - Delete entry (used when tenant status changes)
  |
  +-- clear(): void
        - Clear all entries (used in tests)
```

**Observability log** (every 100 requests):
```json
{
  "level": "info",
  "event": "tenant_cache_stats",
  "hits": 87,
  "misses": 13,
  "hitRate": "87.0%",
  "cacheSize": 12,
  "timestamp": "2026-05-13T00:00:00.000Z"
}
```

**Redis migration TODO** (Answer B2=B):
```typescript
// TODO(scale): Replace with Redis TenantCache. See docs/scaling.md for migration guide.
// Current: in-memory Map, single-instance only. TTL: 60s.
```

---

### 2.2 Token Denylist Scalability Note

```typescript
// token-denylist.ts
// TODO(scale): Replace with Redis TokenDenylist. See docs/scaling.md for migration guide.
// Current: in-memory Map, single-instance only. Tokens expire after JWT_EXPIRY (8h).
const denylist = new Map<string, number>(); // token -> expiry timestamp (ms)
```

---

## 3. Performance Patterns

### 3.1 Compound Index Pattern

**Pattern**: Inline schema index definitions (Answer C1=A)

Each Mongoose schema defines its own indexes co-located with the model. This keeps index definitions close to the data they index and avoids a separate bootstrap step.

**Convention for all schemas in HMS**:
```typescript
// Always define compound index with tenantId first (NFR-01)
UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1 });
UserSchema.index({ tenantId: 1, isActive: 1 });

TenantSchema.index({ status: 1 });  // Super Admin queries by status (no tenantId)
```

**Index naming convention**: Mongoose auto-generates names; no custom names needed for this phase.

**`autoIndex` setting**: Set `autoIndex: true` in development, `autoIndex: false` in production (indexes created via migration scripts in production to avoid startup delays).

---

### 3.2 Response Time Measurement Pattern

**Pattern**: `Date.now()` millisecond precision (Answer C2=A)

```typescript
// request-logger.ts
app.use((req, res, next) => {
  const startMs = Date.now();
  const correlationId = generateId();

  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  res.on('finish', () => {
    const responseTimeMs = Date.now() - startMs;
    const level = res.statusCode >= 500 ? 'error'
                : res.statusCode >= 400 ? 'warn'
                : 'info';

    const logEntry = {
      level,
      correlationId,
      method:         req.method,
      url:            req.url,
      statusCode:     res.statusCode,
      responseTimeMs,
      userId:         req.user?.userId,
      tenantId:       req.user?.tenantId,
      timestamp:      new Date().toISOString(),
    };

    console[level === 'info' ? 'log' : level](JSON.stringify(logEntry));
  });

  next();
});
```

**25ms budget monitoring**: If `responseTimeMs > 25` for middleware-only overhead (i.e., before route handler executes), log at `warn` level with `event: 'middleware_budget_exceeded'`.

---

## 4. Security Patterns

### 4.1 Rate Limiter with Trust Proxy

**Pattern**: `req.ip` + `app.set('trust proxy', 1)` (Answer D1=C)

```typescript
// app.ts — set before any middleware
app.set('trust proxy', 1);
// Express now correctly reads X-Forwarded-For and sets req.ip to the real client IP

// Auth routes rate limiter
const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max:      config.rateLimit.maxRequests,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (req, res) => {
    res.status(429).json({
      status: 'error',
      message: 'Too many requests — please try again later',
    });
  },
  standardHeaders: true,   // Return rate limit info in RateLimit-* headers
  legacyHeaders:   false,
});

// Public endpoints rate limiter (same config, separate instance)
const publicRateLimiter = rateLimit({ /* same options */ });
```

**Applied to**:
- `router.post('/api/auth/login', authRateLimiter, ...)`
- `router.post('/api/auth/forgot-password', authRateLimiter, ...)`
- `router.post('/api/auth/reset-password', authRateLimiter, ...)`
- `router.post('/api/tenants/setup', publicRateLimiter, ...)`
- `router.get('/health', publicRateLimiter, ...)`

---

### 4.2 AppError Hierarchy

**Pattern**: 6-subclass error hierarchy (Answer D2=C)

```
Error
  └── AppError (base — statusCode, message, details?)
        ├── ValidationError      (400) — input validation failures
        ├── UnauthorizedError    (401) — missing/invalid auth
        ├── ForbiddenError       (403) — insufficient permissions
        ├── NotFoundError        (404) — resource not found
        ├── ConflictError        (409) — duplicate/state conflict
        └── ServiceUnavailableError (503) — DB/external service down
```

**Usage examples**:
```typescript
throw new ValidationError('Mobile number is required');
throw new UnauthorizedError('Invalid or expired token');
throw new ForbiddenError('Insufficient permissions');
throw new NotFoundError('Patient not found');
throw new ConflictError('A patient with this mobile number already exists');
throw new ServiceUnavailableError('Database temporarily unavailable');
```

**errorHandler classification**:
```typescript
// Mongo network errors auto-classified as 503
// Mongoose ValidationError auto-classified as 400
// All AppError subclasses use their own statusCode
// Unknown errors → 500
```

---

### 4.3 Correlation ID via AsyncLocalStorage

**Pattern**: AsyncLocalStorage request context (Answer D3=C)

```typescript
// src/shared/config/request-context.ts
import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  correlationId: string;
  userId?:       string;
  tenantId?:     string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Helper to get correlationId anywhere in the call stack
export function getCorrelationId(): string {
  return requestContext.getStore()?.correlationId ?? 'no-context';
}
```

**Middleware integration** (in `requestLogger`):
```typescript
requestContext.run({ correlationId, userId: req.user?.userId, tenantId: req.user?.tenantId }, () => {
  next();
});
```

**Usage in services** (no parameter threading needed):
```typescript
// email.service.ts — correlationId available automatically
console.error(JSON.stringify({
  level: 'error',
  correlationId: getCorrelationId(),
  event: 'smtp_failure',
  error: err.message,
}));
```

**Benefits**:
- No method signature pollution with `correlationId` parameter
- Available in all async callbacks, Mongoose hooks, and service methods
- Automatically scoped to the current request — no cross-request leakage

---

## 5. Pattern Interaction Summary

```
Incoming Request
      |
      v
[trust proxy=1] --> req.ip = real client IP
      |
      v
[requestContext.run()] --> AsyncLocalStorage stores { correlationId, userId, tenantId }
      |
      v
[requestLogger] --> logs with correlationId from AsyncLocalStorage
      |
      v
[authenticateJWT] --> checks denylist (in-memory Map)
      |                // TODO(scale): Replace with Redis TokenDenylist
      v
[scopeTenant] --> TenantCache.get(tenantId)
      |           // Cache hit (87% typical): < 2ms
      |           // Cache miss: MongoDB query < 15ms
      |           // TODO(scale): Replace with Redis TenantCache
      v
[requireRole] --> check role, log 403 via AuditService + AsyncLocalStorage correlationId
      |
      v
[Route Handler]
      |
      +-- assertDbConnected() --> ServiceUnavailableError(503) if not connected
      |
      +-- Mongoose query
      |     +-- MongoNetworkError --> errorHandler --> 503
      |     +-- Success --> continue
      |
      +-- EmailService call (if needed)
            +-- SMTP failure --> AppError(500, friendly message)
            +-- Success --> continue
```

---

## 6. PBT Compliance Summary (PBT-01 through PBT-10)

| Rule | Status | Notes |
|---|---|---|
| PBT-01 | Compliant | 5 testable properties identified in Functional Design |
| PBT-02 | Compliant | Round-trip: JWT sign/verify, env parse/serialize |
| PBT-03 | Compliant | Invariants: correlationId uniqueness, totalPages formula, cache TTL |
| PBT-04 | Compliant | Idempotency: requireRole check, TenantCache.set() |
| PBT-05 | N/A | No reference implementation exists for these components |
| PBT-06 | Compliant | TenantCache stateful: command sequences (get/set/invalidate) preserve invariants |
| PBT-07 | Compliant | Domain generators for JWTPayload, AppConfig, TenantStatus |
| PBT-08 | Compliant | fast-check shrinking enabled; seed logged on failure |
| PBT-09 | Compliant | fast-check v3.19.0 selected and documented |
| PBT-10 | Compliant | PBT complements example-based tests; critical paths have both |

---
