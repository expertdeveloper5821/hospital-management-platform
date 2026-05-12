# Unit of Work — Hospital Management Platform (HMS)

**Total Units**: 7  
**Execution Order**: Strictly sequential (each unit fully complete before next begins)  
**Frontend Strategy**: Backend units first (1–6), dedicated frontend unit last (7)  
**Shared Types**: Generated in Unit 1 (Foundation), imported by all subsequent units  
**Tests**: Unit tests + integration tests generated inline during each unit's Code Generation

---

## Unit 1: Foundation

**Modules**: Auth Module (BC-01), Tenant Module (BC-02), User Module (BC-03)  
**Shared Infrastructure**: Email Service (SI-01), S3 Service (SI-02, partial — logo upload only), WebSocket Service (SI-04, server setup only)

**Scope**:
- JWT authentication, session management, account lockout, password reset
- Super Admin credential management (`super_admins` collection)
- Tenant lifecycle (PENDING_VERIFICATION → ACTIVE → INACTIVE)
- Hospital onboarding with document upload to S3
- Invite link generation and consumption (signed JWT, 48h)
- Branding configuration (logo upload to S3, display name, primary color)
- User account CRUD with role assignment and RBAC enforcement
- Welcome emails, invite emails, account-lock emails, password-reset emails
- Express middleware chain: `authenticateJWT`, `scopeTenant`, `requireRole`, `requireFirstPasswordChange`, `requestLogger`, `errorHandler`
- All shared TypeScript types: `UserRole`, `TenantStatus`, `JWTPayload`, `PaginatedResult<T>`, `SuccessResponse<T>`, `ErrorResponse`, `AuditEntityType`
- MongoDB connection setup, Mongoose base configuration
- Environment configuration (`env.ts`)

**Backend folder scope**:
```
src/
  modules/auth/
  modules/tenant/
  modules/user/
  shared/middleware/
  shared/services/email.service.ts
  shared/services/s3.service.ts        (partial)
  shared/services/websocket.service.ts (server init only)
  shared/types/
  shared/config/
  app.ts
  server.ts
```

**Key deliverables**:
- Working auth endpoints (login, logout, change-password, forgot-password, reset-password)
- Working tenant endpoints (create, approve, deactivate, setup, branding)
- Working user endpoints (create, list, deactivate, update-role)
- All middleware functions tested and operational
- Shared types exported from `shared/types/`
- Unit tests + integration tests for all three modules

---

## Unit 2: Patient & OPD

**Modules**: Patient Module (BC-04), OPD Module (BC-05)  
**Shared Infrastructure**: PDF Service (SI-03, partial — Medical Card only), S3 Service (SI-02, Medical Card PDF upload)

**Dependencies**: Unit 1 must be complete (requires auth middleware, tenant scoping, user lookup for doctor assignment)

**Scope**:
- Patient registration with duplicate detection (mobile number)
- Medical Card PDF generation (PDFKit, synchronous) with tenant branding
- Patient search (by ID, name, mobile)
- Patient demographic update with audit log
- OPD visit lifecycle (OPEN → COMPLETED)
- Doctor consultation recording (chief complaint, diagnosis, free-text prescription, follow-up date)
- OPD queue (daily, filterable by doctor)
- Patient visit history
- Audit log entries for Patient and OPD Visit entities

**Backend folder scope**:
```
src/
  modules/patient/
  modules/opd/
  shared/services/pdf.service.ts  (Medical Card method)
```

**Key deliverables**:
- Working patient endpoints
- Working OPD endpoints
- Medical Card PDF generation functional
- Unit tests + integration tests for both modules

---

## Unit 3: IPD

**Modules**: IPD Module (BC-06)

**Dependencies**: Unit 1 (auth, tenant, user), Unit 2 (patient lookup)

**Scope**:
- Master bed registry (ward creation, bed addition by Hospital Admin)
- IPD admission lifecycle (ADMITTED → DISCHARGED)
- Bed conflict detection (occupied bed rejection with occupant admission ID)
- Daily progress notes (doctor, timestamp)
- Patient discharge (bed released)
- Admitted patient list (filterable by ward)
- Bed occupancy summary per ward (total / occupied / available)
- Audit log entries for IPD Admission entity

**Backend folder scope**:
```
src/
  modules/ipd/
```

**Key deliverables**:
- Working IPD endpoints (wards, beds, admissions, notes, discharge, occupancy)
- Bed conflict detection tested
- Unit tests + integration tests

---

## Unit 4: Lab & Inventory

**Modules**: Lab Module (BC-07), Inventory Module (BC-08)  
**Shared Infrastructure**: S3 Service (SI-02, report file upload), Notification Module (BC-10, partial — notification sending only; full notification persistence deferred to Unit 6)

**Dependencies**: Unit 1 (auth, tenant, user), Unit 2 (patient lookup), Unit 6 (Notification Module) — **Note**: Lab triggers notifications; Notification Module is built in Unit 6. To handle this dependency, Lab will call a `NotificationService.sendNotification()` stub in Unit 4 that writes to MongoDB directly (the Notification Module's repository). The full WebSocket delivery and notification history API are completed in Unit 6.

**Revised dependency approach**: Unit 4 generates the `notifications` MongoDB collection and `NotificationRepository` as part of its scope, so Lab can persist notifications. Unit 6 adds the WebSocket delivery layer and notification API on top.

**Scope**:
- Pathology test request lifecycle (PENDING → COMPLETED)
- Pathology report file upload to S3 (max 10 MB)
- Radiology imaging request lifecycle (PENDING → COMPLETED)
- Radiology report file upload to S3 (max 20 MB)
- Notification persistence on report completion (doctor notified)
- Pending queues for Pathologist and Radiologist
- Patient lab history (ordered by date descending)
- Inventory item CRUD (Equipment / Consumable)
- Stock quantity updates with audit log
- Non-negative stock enforcement
- Low-stock notification persistence (Manager + Admin roles)
- Minimum threshold updates
- Filterable/sortable inventory list
- Audit log entries for Pathology Request, Radiology Request, Inventory Item entities

**Backend folder scope**:
```
src/
  modules/lab/
  modules/inventory/
  modules/notification/  (repository + model only — no WebSocket delivery yet)
```

**Key deliverables**:
- Working lab endpoints (pathology + radiology requests, report upload)
- Working inventory endpoints
- Notification records persisted to MongoDB on lab completion and low-stock events
- Unit tests + integration tests for both modules

---

## Unit 5: Payments

**Modules**: Payment Module (BC-09)  
**Shared Infrastructure**: PDF Service (SI-03, receipt method), S3 Service (SI-02, receipt PDF upload), Razorpay SDK

**Dependencies**: Unit 1 (auth, tenant, user), Unit 2 (patient lookup)

**Scope**:
- Manual payment recording (Cash, Cheque) with amount > 0 validation
- Razorpay order creation (UPI, Card)
- Razorpay webhook endpoint (`POST /api/webhooks/razorpay`) with HMAC-SHA256 signature validation
- Receipt PDF generation (PDFKit, synchronous) with tenant branding
- Receipt PDF upload to S3, served via pre-signed URL
- Payment list (filterable by date range and method)
- Payment summary report (total by method for date range)
- Audit log entries for Payment Record entity

**Backend folder scope**:
```
src/
  modules/payment/
  shared/services/pdf.service.ts  (receipt method added)
```

**Key deliverables**:
- Working payment endpoints (manual + Razorpay)
- Webhook endpoint with signature validation
- Receipt PDF generation functional
- Unit tests + integration tests

---

## Unit 6: Notifications & Audit

**Modules**: Notification Module (BC-10, full), Audit Module (BC-11)

**Dependencies**: Unit 1 (auth, tenant, user), Unit 4 (notification repository already created)

**Scope**:
- WebSocket server activation and connection registry (`userId → WebSocket`)
- JWT authentication on WebSocket upgrade
- Real-time notification delivery to connected users
- Notification history API (last 30 days)
- Mark notification as READ
- Unread count endpoint
- Full `AuditService` implementation (log + query)
- Audit log query API (filterable by entityType, entityId, userId, dateRange)
- 365-day retention enforcement
- Audit failure alerting (Super Admin email on write failure)
- Access denial logging (HTTP 403 events)

**Backend folder scope**:
```
src/
  modules/notification/  (complete — WebSocket delivery + API added)
  modules/audit/
```

**Key deliverables**:
- WebSocket server operational with authenticated connections
- Real-time notification delivery tested
- Notification history API working
- Full audit log write + query API
- Unit tests + integration tests

---

## Unit 7: Frontend

**Technology**: Next.js (App Router), Redux Toolkit + RTK Query, shadcn/ui + Tailwind CSS  
**Scope**: All 12 frontend components (FC-01 through FC-12)

**Dependencies**: All backend units (1–6) must be complete — frontend is built against the finalized API

**Scope**:
- Auth Shell (FC-01): Login, first-login password change, forgot/reset password
- Layout Shell (FC-02): RBAC-aware sidebar, notification bell + badge, tenant branding via CSS variables
- Super Admin Console (FC-03): Tenant onboarding form, tenant list, approve/deactivate/resend-invite
- Hospital Admin Panel (FC-04): Branding config form, user management table
- Patient Management (FC-05): Registration form, duplicate alert, search, Medical Card download
- OPD Module UI (FC-06): Queue table, visit detail form, complete visit action
- IPD Module UI (FC-07): Admission form, ward/bed selector, admitted patient list, progress notes, discharge, occupancy summary
- Lab Module UI (FC-08): Request forms, pending queues, report upload, patient lab history
- Inventory Module UI (FC-09): Item form, stock update form, inventory list
- Payment Module UI (FC-10): Payment form (manual + Razorpay), receipt download, payment list, summary report
- Notification Panel (FC-11): Slide-out panel, WebSocket-driven updates, mark-as-read
- Audit Log Viewer (FC-12): Query form, results table
- Redux store setup (authSlice, notificationSlice, all RTK Query API slices)
- Tenant branding applied via CSS custom properties (logo, display name, primary color)
- RBAC-aware navigation (routes hidden/shown based on role)

**Frontend folder scope**:
```
app/
  (auth)/
  (dashboard)/
components/
store/
```

**Key deliverables**:
- All 12 frontend components implemented
- Redux store with RTK Query API slices
- WebSocket client connected to notification panel
- Tenant branding applied dynamically
- RBAC-aware routing
- Unit tests + integration tests for all components and store slices

---

## Execution Sequence

```
Unit 1: Foundation
    (strictly complete before Unit 2)
    |
    v
Unit 2: Patient & OPD
    (strictly complete before Unit 3)
    |
    v
Unit 3: IPD
    (strictly complete before Unit 4)
    |
    v
Unit 4: Lab & Inventory
    (strictly complete before Unit 5)
    |
    v
Unit 5: Payments
    (strictly complete before Unit 6)
    |
    v
Unit 6: Notifications & Audit
    (strictly complete before Unit 7)
    |
    v
Unit 7: Frontend
    |
    v
Build and Test
```

---

## Code Organization Strategy

**Backend root structure** (generated progressively across units):
```
hospital-management-platform/
  src/
    modules/
      auth/           ← Unit 1
      tenant/         ← Unit 1
      user/           ← Unit 1
      patient/        ← Unit 2
      opd/            ← Unit 2
      ipd/            ← Unit 3
      lab/            ← Unit 4
      inventory/      ← Unit 4
      notification/   ← Unit 4 (model/repo) + Unit 6 (full)
      payment/        ← Unit 5
      audit/          ← Unit 6
    shared/
      middleware/     ← Unit 1
      services/       ← Units 1–5
      types/          ← Unit 1
      config/         ← Unit 1
    app.ts            ← Unit 1
    server.ts         ← Unit 1
  tests/
    unit/             ← per unit
    integration/      ← per unit
  package.json
  tsconfig.json
  Dockerfile
  .env.example
```

**Frontend root structure** (generated in Unit 7):
```
hospital-management-platform/
  frontend/
    app/
    components/
    store/
    public/
    package.json
    tsconfig.json
    tailwind.config.ts
    next.config.ts
```
