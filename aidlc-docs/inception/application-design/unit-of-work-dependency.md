# Unit of Work Dependencies — Hospital Management Platform (HMS)

---

## Unit Dependency Matrix

| Unit | Depends On | Reason |
|---|---|---|
| Unit 1: Foundation | None | First unit — establishes all shared infrastructure |
| Unit 2: Patient & OPD | Unit 1 | Requires auth middleware, tenant scoping, user lookup (doctor assignment) |
| Unit 3: IPD | Unit 1, Unit 2 | Requires auth/tenant (Unit 1), patient lookup (Unit 2) |
| Unit 4: Lab & Inventory | Unit 1, Unit 2 | Requires auth/tenant (Unit 1), patient lookup (Unit 2); creates notification model for Unit 6 |
| Unit 5: Payments | Unit 1, Unit 2 | Requires auth/tenant (Unit 1), patient lookup (Unit 2), PDF service (Unit 2 adds Medical Card method) |
| Unit 6: Notifications & Audit | Unit 1, Unit 4 | Requires auth/tenant (Unit 1), notification repository already created in Unit 4 |
| Unit 7: Frontend | Units 1–6 | All backend APIs must be finalized before frontend is built |

---

## Critical Path

```
Unit 1 → Unit 2 → Unit 3 → Unit 4 → Unit 5 → Unit 6 → Unit 7 → Build & Test
```

All units are on the critical path — no parallelization (strictly sequential per user decision).

---

## Shared Artifacts by Unit

### Unit 1 produces (consumed by all subsequent units):

| Artifact | Location | Consumed By |
|---|---|---|
| `authenticateJWT` middleware | `src/shared/middleware/` | Units 2–7 |
| `scopeTenant` middleware | `src/shared/middleware/` | Units 2–7 |
| `requireRole` middleware | `src/shared/middleware/` | Units 2–7 |
| `requireFirstPasswordChange` middleware | `src/shared/middleware/` | Units 2–7 |
| `requestLogger` middleware | `src/shared/middleware/` | Units 2–7 |
| `errorHandler` middleware | `src/shared/middleware/` | Units 2–7 |
| `UserRole` enum | `src/shared/types/` | Units 2–7 |
| `TenantStatus` enum | `src/shared/types/` | Units 2–7 |
| `JWTPayload` interface | `src/shared/types/` | Units 2–7 |
| `PaginatedResult<T>` type | `src/shared/types/` | Units 2–7 |
| `SuccessResponse<T>` type | `src/shared/types/` | Units 2–7 |
| `ErrorResponse` type | `src/shared/types/` | Units 2–7 |
| `AuditEntityType` enum | `src/shared/types/` | Units 2–6 |
| `EmailService` | `src/shared/services/` | Units 2–6 |
| `S3Service` (base) | `src/shared/services/` | Units 2–6 |
| `WebSocketService` (server init) | `src/shared/services/` | Unit 6 (activates delivery) |
| MongoDB connection + Mongoose config | `src/shared/config/` | Units 2–7 |
| `app.ts` + `server.ts` | `src/` | Units 2–6 (add routes) |
| `env.ts` (all env vars defined) | `src/shared/config/` | Units 2–7 |

### Unit 2 produces (consumed by subsequent units):

| Artifact | Consumed By |
|---|---|
| `PDFService.generateMedicalCard()` | Unit 5 (adds `generateReceipt()`) |
| `PatientRepository` | Units 3, 4, 5 (patient lookup) |
| `Patient` Mongoose model | Units 3, 4, 5 |

### Unit 4 produces (consumed by Unit 6):

| Artifact | Consumed By |
|---|---|
| `Notification` Mongoose model | Unit 6 |
| `NotificationRepository` | Unit 6 |
| `notifications` MongoDB collection | Unit 6 |

### Unit 5 produces (consumed by Unit 6):

| Artifact | Consumed By |
|---|---|
| `PDFService.generateReceipt()` | Unit 6 (no direct dependency, but PDF service is complete) |

---

## Environment Variables (all defined in Unit 1)

```env
# Server
PORT=
NODE_ENV=

# MongoDB
MONGODB_URI=

# JWT
JWT_SECRET=
JWT_EXPIRY=8h
JWT_INVITE_EXPIRY=48h
JWT_RESET_EXPIRY=1h

# SMTP (Nodemailer)
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# AWS S3
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=

# Razorpay (used in Unit 5)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Frontend URL (for CORS)
FRONTEND_URL=

# Super Admin (seed)
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD_HASH=
```

---

## Inter-Unit API Contracts

These are the cross-unit function calls that must remain stable once Unit 1 is complete:

| Contract | Defined In | Used By |
|---|---|---|
| `authenticateJWT(req, res, next)` | Unit 1 | All units |
| `scopeTenant(req, res, next)` | Unit 1 | All units |
| `requireRole(...roles)` | Unit 1 | All units |
| `AuditService.log(entry)` | Unit 6 | Units 2–5 call this — **stub needed** |
| `NotificationService.sendNotification(input)` | Unit 6 | Unit 4 calls this — **stub needed** |

### Stub Strategy for Forward Dependencies

**AuditService stub** (Units 2–5 need to call `AuditService.log` before Unit 6 builds the full implementation):
- Units 2–5 will import and call `AuditService.log()` 
- A minimal stub is created in Unit 1: `log(entry) → console.log(entry)` (fire-and-forget, no DB write)
- Unit 6 replaces the stub with the full MongoDB-backed implementation
- No code changes needed in Units 2–5 — the interface is identical

**NotificationService stub** (Unit 4 needs to call `NotificationService.sendNotification` before Unit 6 builds the full implementation):
- Unit 4 creates the `Notification` model and `NotificationRepository`
- Unit 4 implements a minimal `NotificationService.sendNotification()` that writes to MongoDB only (no WebSocket delivery)
- Unit 6 adds WebSocket delivery on top of the existing implementation
- No code changes needed in Unit 4 — Unit 6 extends, not replaces
