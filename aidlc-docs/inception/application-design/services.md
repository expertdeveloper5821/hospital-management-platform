# Services — Hospital Management Platform (HMS)

**Service Layer Orchestration Patterns**

---

## Service Architecture Overview

The backend follows a layered architecture within the modular monolith:

```
HTTP Request
    |
    v
Express Router (per module)
    |
    v
Middleware Chain
  [authenticateJWT → scopeTenant → requireRole → requestLogger]
    |
    v
Controller (thin — parses request, calls service, formats response)
    |
    v
Service (business logic, orchestration, calls repositories + shared services)
    |
    v
Repository (MongoDB/Mongoose — all queries include tenantId filter)
    |
    v
MongoDB Collection
```

---

## Module Service Orchestration

### Auth Service Orchestration

**Login flow**:
1. `AuthRepository.findUserByEmail` (or `findSuperAdminByEmail`)
2. Check account active + tenant active
3. Verify password (bcrypt compare)
4. On failure: `AuthRepository.incrementFailedAttempts` → check threshold → `lockAccount` → `EmailService.sendEmail` (lock notification)
5. On success: reset failed attempts, check `requiresPasswordChange`, issue JWT
6. Return `{ token, user, requiresPasswordChange }`

**Logout flow**:
1. Extract JWT from request
2. Add to in-memory denylist with TTL = remaining JWT expiry
3. Return 200

**Password reset flow**:
1. `AuthRepository.findUserByEmail` → generate signed reset token (JWT, 1h expiry)
2. `AuthRepository.saveResetToken`
3. `EmailService.sendEmail` (reset link)
4. On reset: `AuthRepository.consumeResetToken` → validate → `AuthRepository.recordPasswordChange` (bcrypt hash)

---

### Tenant Service Orchestration

**Onboarding flow**:
1. Validate all required documents present
2. Upload documents to S3 via `S3Service.uploadFile`
3. `TenantRepository.save` (status: PENDING_VERIFICATION)
4. Return tenant

**Approval flow**:
1. `TenantRepository.updateStatus` (ACTIVE)
2. Generate invite JWT (signed, 48h expiry)
3. `EmailService.sendEmail` (invite link with token)

**Initial setup flow** (Hospital Admin completes via invite link):
1. Validate invite JWT (not expired, not used)
2. `UserService.createUser` (Hospital Admin role, no welcome email — they're setting up)
3. Mark invite token as consumed
4. Prompt branding configuration

**Branding update flow**:
1. If logo file provided: validate size ≤ 2 MB → `S3Service.uploadFile` → get S3 key
2. `TenantRepository.updateBranding`

---

### User Service Orchestration

**Create user flow**:
1. Check last-admin guard (if deactivating — not applicable here, but role assignment check)
2. Generate temporary password (random, 12 chars)
3. Hash password (bcrypt, cost 12)
4. `UserRepository.save`
5. `EmailService.sendEmail` (welcome email with temp password)
6. `AuditService.log` (CREATE, UserAccount)

**Deactivate user flow**:
1. `UserRepository.countActiveAdmins` — if role is Hospital_Admin and count = 1, reject
2. `UserRepository.setActive(userId, false)`
3. `AuditService.log` (UPDATE, UserAccount)

---

### Patient Service Orchestration

**Create patient flow**:
1. `PatientRepository.findByMobile` — if found and `forceCreate` not set, return `{ isDuplicate: true }`
2. Generate unique patient ID (format: `HMS-{tenantPrefix}-{timestamp}`)
3. `PatientRepository.save`
4. `AuditService.log` (CREATE, Patient)
5. Generate Medical Card: `PDFService.generateMedicalCard` → `S3Service.uploadFile` → return pre-signed URL

**Update patient flow**:
1. `PatientRepository.findById` — capture previous values
2. `PatientRepository.update`
3. `AuditService.log` (UPDATE, Patient, previousValue, newValue)

---

### OPD Service Orchestration

**Create visit flow**:
1. Validate patient exists in tenant
2. Validate doctor exists and is active in tenant
3. `OPDRepository.save` (status: OPEN)
4. `AuditService.log` (CREATE, OPDVisit)

**Complete visit flow**:
1. `OPDRepository.findById` — verify status is OPEN (reject if COMPLETED)
2. `OPDRepository.updateStatus` (COMPLETED, completedAt: now)
3. `AuditService.log` (UPDATE, OPDVisit)

---

### IPD Service Orchestration

**Create admission flow**:
1. `IPDRepository.findActiveBed` — if occupied, return error with occupant admission ID
2. `IPDRepository.save` (status: ADMITTED)
3. `AuditService.log` (CREATE, IPDAdmission)

**Discharge flow**:
1. `IPDRepository.findById` — verify status is ADMITTED
2. `IPDRepository.updateStatus` (DISCHARGED, dischargeDate: now)
3. Bed is now available (no active admission for that ward+bed)
4. `AuditService.log` (UPDATE, IPDAdmission)

---

### Lab Service Orchestration

**Upload report flow** (pathology or radiology):
1. Validate file size (≤ 10 MB pathology / ≤ 20 MB radiology)
2. `S3Service.uploadFile` → get S3 key
3. `LabRepository.save*` (attach S3 key, status: COMPLETED)
4. `AuditService.log` (UPDATE, PathologyRequest / RadiologyRequest)
5. `NotificationService.sendNotification` → requesting doctor receives in-app notification
6. `WebSocketService.pushToUser` (real-time delivery)

---

### Inventory Service Orchestration

**Update stock flow**:
1. Validate new quantity ≥ 0 (reject if negative)
2. `InventoryRepository.findById` — capture previous quantity
3. `InventoryRepository.updateStock`
4. `AuditService.log` (UPDATE, InventoryItem)
5. If new quantity < minimumThreshold: `NotificationService.sendToRole` (Manager + Admin roles in tenant)

---

### Payment Service Orchestration

**Manual payment flow**:
1. Validate amount > 0
2. `PaymentRepository.save`
3. `PDFService.generateReceipt` (synchronous, with tenant branding)
4. `S3Service.uploadFile` (receipt PDF) → get S3 key
5. `AuditService.log` (CREATE, Payment)
6. Return `{ payment, receiptUrl: presignedUrl }`

**Razorpay order flow**:
1. Validate amount > 0
2. Call Razorpay API → create order → return `{ orderId, amount, currency }`
3. Frontend completes payment via Razorpay checkout

**Razorpay webhook flow**:
1. Validate Razorpay signature (HMAC-SHA256 with webhook secret)
2. Extract payment details from payload
3. `PaymentRepository.save` (method: UPI or Card)
4. `PDFService.generateReceipt` → `S3Service.uploadFile`
5. `AuditService.log` (CREATE, Payment)

---

### Notification Service Orchestration

**Send notification flow**:
1. `NotificationRepository.save` (status: UNREAD)
2. `WebSocketService.pushToUser` — if user has active WebSocket connection, deliver immediately
3. If no active connection, notification persists in DB for next poll/reconnect

**Send to role flow**:
1. `UserRepository.findByRole(tenantId, role)` — get all active users with that role
2. For each user: `sendNotification`

---

### Audit Service Orchestration

**Log entry flow** (fire-and-forget):
1. `AuditRepository.save` — wrapped in try/catch
2. On failure: log error to application logger + alert Super Admin via `EmailService` (non-blocking)
3. Primary operation is never rolled back due to audit failure

---

## Inter-Module Communication Patterns

| Caller Module | Called Module | Pattern | Purpose |
|---|---|---|---|
| Tenant | Email Service | Sync call | Invite email, branding confirmation |
| Auth | Email Service | Sync call | Lock notification, password reset |
| User | Email Service | Sync call | Welcome email |
| Patient | PDF Service | Sync call | Medical Card generation |
| Patient | S3 Service | Sync call | Logo/PDF upload |
| Patient | Audit Service | Fire-and-forget | Patient CREATE/UPDATE log |
| OPD | Audit Service | Fire-and-forget | Visit CREATE/UPDATE log |
| IPD | Audit Service | Fire-and-forget | Admission CREATE/UPDATE log |
| Lab | S3 Service | Sync call | Report file upload |
| Lab | Notification Service | Sync call | Doctor notification on report complete |
| Lab | Audit Service | Fire-and-forget | Request UPDATE log |
| Inventory | Notification Service | Sync call | Low-stock alert to Manager/Admin |
| Inventory | Audit Service | Fire-and-forget | Stock UPDATE log |
| Payment | PDF Service | Sync call | Receipt generation |
| Payment | S3 Service | Sync call | Receipt PDF upload |
| Payment | Audit Service | Fire-and-forget | Payment CREATE log |
| Notification | WebSocket Service | Sync call | Real-time push delivery |
| All modules | Auth Middleware | Middleware | JWT validation on every request |

---

## WebSocket Service Design

```
Client connects: WS /ws?token=<JWT>
    |
    v
Server validates JWT → extracts userId + tenantId
    |
    v
WebSocketService.registerConnection(userId, ws)
    |
    v
On disconnect: WebSocketService.removeConnection(userId)

Notification push:
    NotificationService.sendNotification(input)
        → NotificationRepository.save()
        → WebSocketService.pushToUser(userId, payload)
            → if connection exists: ws.send(JSON.stringify(payload))
            → if no connection: notification persists in DB only
```

**WebSocket message format**:
```json
{
  "type": "NOTIFICATION",
  "payload": {
    "notificationId": "string",
    "title": "string",
    "message": "string",
    "timestamp": "ISO8601",
    "status": "UNREAD"
  }
}
```
