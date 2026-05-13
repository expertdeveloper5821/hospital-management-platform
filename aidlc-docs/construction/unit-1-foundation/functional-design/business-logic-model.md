# Business Logic Model — Unit 1: Foundation (U1-A: Shared Foundation)

**Unit**: Unit 1 — Foundation  
**Stage**: Functional Design  
**Scope**: Middleware flows, service interactions, app scaffold logic

---

## 1. Request Processing Flow

Every authenticated API request passes through the following middleware chain:

```
Incoming HTTP Request
        |
        v
[1] helmet()
    Sets security headers: CSP, HSTS, X-Content-Type-Options,
    X-Frame-Options, Referrer-Policy
        |
        v
[2] cors(corsOptions)
    Validates Origin header against CORS_ORIGINS list
    Rejects non-allowed origins with 403
        |
        v
[3] express.json({ limit: '10mb' })
    Parses JSON body
    Rejects oversized payloads with 413
        |
        v
[4] requestLogger
    Generates correlationId (UUID v4)
    Attaches to req.correlationId + X-Correlation-ID header
    Logs on response finish: method, url, status, responseTimeMs,
    correlationId, userId?, tenantId?
        |
        v
[5] rateLimit (auth routes only: /api/auth/*)
    Window: RATE_LIMIT_WINDOW_MS (default 15 min)
    Max: RATE_LIMIT_MAX_REQUESTS (default 100)
    Exceeds limit: 429 Too Many Requests
        |
        v
[6] Route Handler
    Module-specific routes (auth, tenant, user, ...)
        |
        +-- Protected routes also pass through:
        |
        |   [6a] authenticateJWT
        |       Extract Bearer token
        |       Verify signature (JWT_SECRET)
        |       Check denylist (token-denylist.ts)
        |       Attach req.user (JWTPayload)
        |
        |   [6b] scopeTenant (tenant-scoped routes)
        |       Skip if SUPER_ADMIN
        |       Query tenant by tenantId
        |       Reject if INACTIVE
        |       Attach req.tenant
        |
        |   [6c] requireRole(...allowedRoles)
        |       Check req.user.role in allowedRoles
        |       Reject with 403 if not allowed
        |       Log 403 via AuditService
        |
        |   [6d] requireFirstPasswordChange (most routes)
        |       Check req.user.isFirstLogin
        |       Reject with 403 if true
        |       (NOT applied to POST /api/auth/change-password)
        |
        v
[7] errorHandler (last middleware)
    Catches all errors thrown by route handlers
    Production: { status: 'error', message }
    Development: { status: 'error', message, details: { stack } }
    Always logs full error to console
```

---

## 2. Token Denylist Logic

```
addToDenylist(token, expiryMs):
    denylist.set(token, Date.now() + expiryMs)

isInDenylist(token):
    if not denylist.has(token):
        return false
    
    expiry = denylist.get(token)
    if Date.now() > expiry:
        denylist.delete(token)   // lazy cleanup
        return false
    
    return true
```

**Invariant**: A token in the denylist with `expiry < Date.now()` is treated as NOT in the denylist (expired entries are lazily removed).

---

## 3. Environment Configuration Loading

```
Application startup:
    |
    v
require('dotenv-safe').config({ allowEmptyValues: false })
    |
    +-- .env file loaded
    +-- Validated against .env.example
    +-- Missing required vars: throw error listing all missing keys
    +-- Process exits immediately (fail fast)
    |
    v
Parse and type-cast env vars into AppConfig object:
    - PORT: parseInt(process.env.PORT)
    - CORS_ORIGINS: process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    - RATE_LIMIT_WINDOW_MS: parseInt(...)
    - RATE_LIMIT_MAX_REQUESTS: parseInt(...)
    - All others: string pass-through
    |
    v
Export frozen config object (Object.freeze)
    - Prevents accidental mutation at runtime
```

---

## 4. MongoDB Connection Logic

```
connectDatabase():
    |
    v
mongoose.connect(MONGODB_URI, options)
    |
    +-- Success: log "MongoDB connected to [host]" (NOT full URI — may contain credentials)
    |
    +-- Error: log error message (NOT full URI), process.exit(1)
    |
    v
Register event listeners:
    mongoose.connection.on('disconnected', () => log warning)
    mongoose.connection.on('reconnected', () => log info)
    mongoose.connection.on('error', (err) => log error)

disconnectDatabase():
    |
    v
mongoose.connection.close()
    |
    v
log "MongoDB connection closed"
```

**Security note**: MongoDB URI MUST NOT be logged (contains credentials). Log only the host portion or a generic "connected" message.

---

## 5. Email Service Logic

```
sendTemplatedEmail(template, data):
    |
    v
Build HTML from template function:
    'invite'         -> inviteEmailHtml(data.inviteLink)
    'welcome'        -> welcomeEmailHtml(data.tempPassword)
    'account-lock'   -> accountLockEmailHtml()
    'password-reset' -> passwordResetEmailHtml(data.resetLink)
    |
    v
transporter.sendMail({
    from: SMTP_FROM,
    to: data.to,
    subject: templateSubjects[template],
    html: htmlContent
})
    |
    +-- Success: return void
    +-- Failure: log error (NOT SMTP credentials), throw AppError('Email delivery failed')
```

**Template subjects**:
- `invite`: "Welcome to HMS — Complete Your Hospital Setup"
- `welcome`: "Your HMS Account Has Been Created"
- `account-lock`: "Your HMS Account Has Been Locked"
- `password-reset`: "Reset Your HMS Password"

---

## 6. S3 Service Logic

```
uploadFile(key, buffer, mimeType):
    |
    v
new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    ServerSideEncryption: 'AES256'   // SECURITY-01
})
    |
    +-- Success: return key
    +-- Failure: log error (NOT AWS credentials), throw AppError('File upload failed')

getPresignedUrl(key, expirySeconds):
    |
    v
getSignedUrl(s3Client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expirySeconds })
    |
    +-- Success: return presigned URL string
    +-- Failure: throw AppError('Failed to generate download URL')
```

---

## 7. AuditService Stub Logic

```
log(entry: AuditLogEntry): Promise<void>
    |
    v
try:
    entry.timestamp = entry.timestamp ?? new Date()
    console.log('[AUDIT STUB]', JSON.stringify({
        entityType: entry.entityType,
        entityId:   entry.entityId,
        action:     entry.action,
        userId:     entry.userId,
        tenantId:   entry.tenantId,
        timestamp:  entry.timestamp,
        // previousValue and newValue omitted from stub log to avoid PII exposure
    }))
catch (err):
    console.error('[AUDIT STUB ERROR]', err.message)
    // swallow — never block primary operation
```

---

## 8. Health Check Logic

```
GET /health (no auth required)
    |
    v
return 200 {
    status:    'ok',
    uptime:    process.uptime(),      // seconds since process start
    timestamp: new Date().toISOString()
}
```

---

## 9. Graceful Shutdown Logic

```
SIGTERM or SIGINT received:
    |
    v
log "Shutdown signal received, closing gracefully..."
    |
    v
Set shutdown timeout: setTimeout(() => process.exit(1), 10_000)
    |
    v
httpServer.close(async () => {
    await disconnectDatabase()
    log "Graceful shutdown complete"
    process.exit(0)
})
```

---

## 10. Testable Properties Summary (PBT-01)

| Component | Property | Category | Test Approach |
|---|---|---|---|
| `authenticateJWT` | sign(payload) → verify → decoded equals payload | Round-trip | fast-check: generate random JWTPayload, sign, verify, assert equality |
| `requireRole` | check(role, allowed) called twice = same result | Idempotence | fast-check: generate random role + allowed list, assert double-call = single-call |
| `requestLogger` | All generated correlationIds are unique | Invariant | fast-check: generate N requests, assert Set(ids).size === N |
| `PaginatedResult<T>` | totalPages = ceil(total / limit) always holds | Invariant | fast-check: generate (total ≥ 0, limit ≥ 1), assert computed totalPages |
| `env.ts` | Valid env object → serialize → re-parse → same values | Round-trip | fast-check: generate valid AppConfig, serialize to env format, re-parse, assert equality |

---
