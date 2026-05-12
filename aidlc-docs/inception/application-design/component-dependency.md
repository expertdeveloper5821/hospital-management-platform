# Component Dependencies — Hospital Management Platform (HMS)

---

## Backend Module Dependency Matrix

| Module | Auth | Tenant | User | Patient | OPD | IPD | Lab | Inventory | Payment | Notification | Audit | Email | S3 | PDF | WebSocket |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Auth | - | reads | reads | | | | | | | | | sends | | | |
| Tenant | uses | - | creates | | | | | | | | | sends | uploads | | |
| User | uses | reads | - | | | | | | | | logs | sends | | | |
| Patient | uses | reads branding | | - | | | | | | | logs | | uploads | generates | |
| OPD | uses | | reads | reads | - | | | | | | logs | | | | |
| IPD | uses | | reads | reads | | - | | | | | logs | | | | |
| Lab | uses | | reads | reads | | | - | | | sends | logs | | uploads | | |
| Inventory | uses | | reads | | | | | - | | sends | logs | | | | |
| Payment | uses | reads branding | | reads | | | | | - | | logs | | uploads | generates | |
| Notification | uses | | reads | | | | | | | - | | | | | pushes |
| Audit | uses | | | | | | | | | | - | | | | |

**Legend**: `uses` = depends on middleware, `reads` = queries data, `sends` = triggers email, `uploads` = stores file, `generates` = creates PDF, `pushes` = sends WebSocket message, `logs` = writes audit entry, `creates` = creates entity

---

## Middleware Dependency Chain

All protected routes pass through this middleware chain in order:

```
Request
  |
  +-- [1] requestLogger        (all routes — attaches correlationId)
  |
  +-- [2] authenticateJWT      (all protected routes — validates JWT, attaches req.user)
  |
  +-- [3] scopeTenant          (all tenant-scoped routes — validates tenant ACTIVE, attaches req.tenantId)
  |
  +-- [4] requireFirstPasswordChange  (all routes except /auth/change-password)
  |
  +-- [5] requireRole(...)     (per-router — RBAC enforcement)
  |
  +-- [6] Controller           (business logic via service)
  |
  +-- [7] errorHandler         (global — catches all unhandled errors)
```

**Public routes** (no auth middleware):
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/tenants/setup` (invite link consumption)
- `POST /api/webhooks/razorpay` (signature-validated internally)
- `WS /ws` (JWT validated inside WebSocket upgrade handler)

---

## Key Data Flow Diagrams

### Flow 1: Patient Registration → Medical Card

```
Receptionist (browser)
    |
    | POST /api/patients
    v
[authenticateJWT] → [scopeTenant] → [requireRole(Receptionist, Nurse, Manager)]
    |
    v
PatientController.createPatient()
    |
    v
PatientService.createPatient()
    |-- PatientRepository.findByMobile()  → duplicate check
    |-- PatientRepository.save()          → create record
    |-- AuditService.log()                → fire-and-forget
    |-- PDFService.generateMedicalCard()  → Buffer
    |-- S3Service.uploadFile()            → S3 key
    |-- S3Service.getPresignedUrl()       → download URL
    |
    v
Response: { status: "success", data: { patient, medicalCardUrl } }
```

---

### Flow 2: Lab Report Upload → Doctor Notification

```
Pathologist (browser)
    |
    | POST /api/lab/pathology/:requestId/report  (multipart)
    v
[authenticateJWT] → [scopeTenant] → [requireRole(Pathologist)]
    |
    v
LabController.uploadPathologyReport()
    |
    v
LabService.uploadPathologyReport()
    |-- Validate file size ≤ 10 MB
    |-- S3Service.uploadFile()                    → S3 key
    |-- LabRepository.savePathology()             → status: COMPLETED
    |-- AuditService.log()                        → fire-and-forget
    |-- NotificationService.sendNotification()
          |-- NotificationRepository.save()       → persist notification
          |-- WebSocketService.pushToUser()       → real-time delivery to Doctor
    |
    v
Response: { status: "success", data: { request } }
```

---

### Flow 3: Razorpay Payment → Receipt Generation

```
Receptionist (browser)
    |
    | POST /api/payments/razorpay/order
    v
PaymentService.createRazorpayOrder()
    |-- Razorpay API → create order → return orderId
    |
    v
Browser: Razorpay checkout (UPI/Card)
    |
    v
Razorpay → POST /api/webhooks/razorpay  (public endpoint)
    |
    v
PaymentService.handleRazorpayWebhook()
    |-- Validate HMAC-SHA256 signature
    |-- PaymentRepository.save()
    |-- PDFService.generateReceipt()              → Buffer
    |-- S3Service.uploadFile()                    → S3 key
    |-- AuditService.log()                        → fire-and-forget
    |
    v
Response: 200 OK (to Razorpay)
```

---

### Flow 4: Inventory Low-Stock → Role Notification

```
Manager (browser)
    |
    | PATCH /api/inventory/:itemId/stock
    v
InventoryService.updateStock()
    |-- Validate newQuantity >= 0
    |-- InventoryRepository.findById()            → capture previous
    |-- InventoryRepository.updateStock()
    |-- AuditService.log()                        → fire-and-forget
    |-- if newQuantity < minimumThreshold:
          NotificationService.sendToRole(tenantId, [Manager, Admin], ...)
              |-- UserRepository.findByRole()     → get all Manager + Admin users
              |-- for each user:
                    NotificationRepository.save()
                    WebSocketService.pushToUser()
    |
    v
Response: { status: "success", data: { item } }
```

---

### Flow 5: JWT Authentication Flow

```
Any protected request
    |
    v
authenticateJWT middleware
    |-- Extract Bearer token from Authorization header
    |-- Check in-memory denylist → if found: 401
    |-- jwt.verify(token, secret) → if invalid/expired: 401
    |-- Attach req.user = { userId, tenantId, role }
    |
    v
scopeTenant middleware
    |-- TenantRepository.findById(req.user.tenantId)
    |-- if status = INACTIVE: 401 "Tenant is inactive"
    |-- Attach req.tenantId
    |
    v
requireRole(...allowedRoles) middleware
    |-- if req.user.role not in allowedRoles: 403
    |-- Log access denial to AuditService (HTTP 403 events)
    |
    v
Controller
```

---

## MongoDB Collection Dependencies

| Collection | Referenced By | tenantId Scoped |
|---|---|---|
| `super_admins` | Auth Module | No (platform-level) |
| `tenants` | All modules (via middleware) | No (is the tenant) |
| `users` | Auth, User, Notification, all RBAC checks | Yes |
| `patients` | Patient, OPD, IPD, Lab, Payment | Yes |
| `opd_visits` | OPD | Yes |
| `ipd_admissions` | IPD | Yes |
| `wards` | IPD | Yes |
| `pathology_requests` | Lab | Yes |
| `radiology_requests` | Lab | Yes |
| `inventory_items` | Inventory | Yes |
| `payments` | Payment | Yes |
| `notifications` | Notification | Yes |
| `audit_logs` | Audit | Yes |

---

## Frontend Component Dependencies

| Frontend Component | Redux Slice / RTK Query | Backend Endpoints |
|---|---|---|
| FC-01: Auth Shell | `authSlice` | `/api/auth/*` |
| FC-02: Layout Shell | `authSlice`, `notificationSlice` | `/api/tenants/:id/branding`, `/api/notifications/unread-count` |
| FC-03: Super Admin Console | RTK Query `tenantApi` | `/api/tenants/*` |
| FC-04: Hospital Admin Panel | RTK Query `tenantApi`, `userApi` | `/api/tenants/:id/branding`, `/api/users/*` |
| FC-05: Patient Management | RTK Query `patientApi` | `/api/patients/*` |
| FC-06: OPD Module UI | RTK Query `opdApi` | `/api/opd/*` |
| FC-07: IPD Module UI | RTK Query `ipdApi` | `/api/ipd/*` |
| FC-08: Lab Module UI | RTK Query `labApi` | `/api/lab/*` |
| FC-09: Inventory Module UI | RTK Query `inventoryApi` | `/api/inventory/*` |
| FC-10: Payment Module UI | RTK Query `paymentApi` | `/api/payments/*`, `/api/webhooks/razorpay` |
| FC-11: Notification Panel | `notificationSlice` (WebSocket-driven) | `WS /ws`, `/api/notifications/*` |
| FC-12: Audit Log Viewer | RTK Query `auditApi` | `/api/audit` |
