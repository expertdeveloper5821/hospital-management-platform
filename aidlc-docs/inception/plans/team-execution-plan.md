# Team Execution Plan - Hospital Management Platform (HMS)

**Purpose**: Collaborative team execution decomposition of all 7 units into sprint-ready tasks, parallelizable workstreams, dependency graphs, developer ownership, merge order, and branch strategy.

**Scope**: Documentation only - no implementation code.

---

## Developer Role Definitions

| Role | Abbrev | Responsibilities |
|---|---|---|
| Backend Developer | BE | Node.js modules, repositories, services, middleware |
| Frontend Developer | FE | Next.js pages, components, Redux store |
| Full-Stack Developer | FS | Can cover both BE and FE tasks |
| DevOps / Infra | OPS | Docker, EC2, S3 config, CI/CD, env setup |
| QA Engineer | QA | Test plan review, integration test execution, acceptance testing |

---

## Branch Strategy


main                          <- production-ready, protected
develop                       <- integration branch, all units merge here
unit/1-foundation             <- Unit 1 integration branch
unit/2-patient-opd            <- Unit 2 integration branch
unit/3-ipd                    <- Unit 3 integration branch
unit/4-lab-inventory          <- Unit 4 integration branch
unit/5-payments               <- Unit 5 integration branch
unit/6-notifications-audit    <- Unit 6 integration branch
unit/7-frontend               <- Unit 7 integration branch

feature/u1-auth-service       <- subunit feature branch
feature/u1-tenant-module      <- subunit feature branch
feature/u1-user-module        <- subunit feature branch
feature/u1-shared-middleware  <- shared foundation branch

---

## Branch Strategy

Merge flow: feature/* --> unit/N-* --> develop --> main

Rules:
- main is protected: requires PR + passing CI + 1 reviewer approval
- develop is protected: requires PR + passing CI
- unit/* branches: require passing CI before merging to develop
- feature/* branches: require passing unit tests before merging to unit/*
- No direct commits to main or develop

---

## Sprint Structure

| Sprint | Units | Focus |
|---|---|---|
| Sprint 0 | Pre-work | Repo setup, CI/CD, Docker, env config, DB provisioning |
| Sprint 1 | Unit 1 | Foundation (Auth + Tenant + User) |
| Sprint 2 | Unit 2 | Patient and OPD |
| Sprint 3 | Unit 3 | IPD |
| Sprint 4 | Unit 4 | Lab and Inventory |
| Sprint 5 | Unit 5 | Payments |
| Sprint 6 | Unit 6 | Notifications and Audit |
| Sprint 7 | Unit 7 | Frontend |
| Sprint 8 | Build and Test | Full integration, E2E, performance, security scan |

---

## Unit 1: Foundation

**Unit Branch**: unit/1-foundation | **Sprint**: Sprint 1
**Stories**: US-SA-01, US-SA-02, US-HA-01, US-HA-02, US-HR-01, US-ST-01, US-CC-01

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U1-A: Shared Foundation | Types, config, middleware, app scaffold | No - must be first |
| U1-B: Auth Module | JWT, login, logout, lockout, password reset | After U1-A |
| U1-C: Tenant Module | Onboarding, lifecycle, branding, invite links | After U1-A, parallel with U1-B |
| U1-D: User Module | User CRUD, role assignment, last-admin guard | After U1-A, parallel with U1-B and U1-C |

### U1-A: Shared Foundation Tasks (Sequential - All Depend On This)

| Task ID | Task | Owner | Branch |
|---|---|---|---|
| U1-A-01 | Shared types: UserRole, TenantStatus, JWTPayload, PaginatedResult, SuccessResponse, ErrorResponse, AuditEntityType | BE | feature/u1-shared-types |
| U1-A-02 | env.ts - typed env var loader with validation | BE | feature/u1-shared-types |
| U1-A-03 | database.ts - Mongoose connection setup | BE | feature/u1-shared-types |
| U1-A-04 | Middleware: authenticateJWT, scopeTenant, requireRole, requireFirstPasswordChange, requestLogger, errorHandler | BE | feature/u1-shared-middleware |
| U1-A-05 | email.service.ts - Nodemailer SMTP wrapper | BE | feature/u1-shared-middleware |
| U1-A-06 | s3.service.ts - upload + presigned URL | BE | feature/u1-shared-middleware |
| U1-A-07 | websocket.service.ts - server init + connection registry stub | BE | feature/u1-shared-middleware |
| U1-A-08 | app.ts + server.ts - Express app scaffold, global middleware wiring | BE | feature/u1-shared-middleware |
| U1-A-09 | AuditService stub (log() -> console.log, no DB) | BE | feature/u1-shared-middleware |

### U1-B: Auth Module (feature/u1-auth-service)

| Task ID | Task | Owner |
|---|---|---|
| U1-B-01 | Auth Mongoose models (users, super_admins) + schemas | BE |
| U1-B-02 | AuthRepository (findByEmail, incrementFailedAttempts, lockAccount, unlockAccount, saveResetToken, consumeResetToken, recordPasswordChange) | BE |
| U1-B-03 | AuthService (login, logout, changePassword, forgotPassword, resetPassword, validateJWT) | BE |
| U1-B-04 | Auth routes + controller (POST /api/auth/*) | BE |
| U1-B-05 | Unit tests: AuthService (login happy path, lockout, reset flow) | BE/QA |
| U1-B-06 | Integration tests: Auth endpoints | BE/QA |
| U1-B-07 | PBT: round-trip JWT encode/decode, lockout counter invariants (fast-check) | BE/QA |

### U1-C: Tenant Module (feature/u1-tenant-module)

| Task ID | Task | Owner |
|---|---|---|
| U1-C-01 | Tenant Mongoose model + schema | BE |
| U1-C-02 | TenantRepository (findById, save, updateStatus, updateBranding) | BE |
| U1-C-03 | TenantService (createTenant, approveTenant, deactivateTenant, listTenants, resendInvite, completeTenantSetup, updateBranding, getBranding) | BE |
| U1-C-04 | Tenant routes + controller | BE |
| U1-C-05 | Unit tests: TenantService (onboarding flow, invite expiry, branding validation, logo size limit) | BE/QA |
| U1-C-06 | Integration tests: Tenant endpoints | BE/QA |

### U1-D: User Module (feature/u1-user-module)

| Task ID | Task | Owner |
|---|---|---|
| U1-D-01 | User Mongoose model + schema (tenantId scoped) | BE |
| U1-D-02 | UserRepository (findById, findByEmail, countActiveAdmins, save, updateRole, setActive) | BE |
| U1-D-03 | UserService (createUser, deactivateUser, updateUserRole, listUsers, getUserById) | BE |
| U1-D-04 | User routes + controller | BE |
| U1-D-05 | Unit tests: UserService (last-admin guard, role update, deactivation) | BE/QA |
| U1-D-06 | Integration tests: User endpoints | BE/QA |

### Dependency Graph - Unit 1

U1-A (Shared Foundation) --> U1-B (Auth) [parallel]
U1-A (Shared Foundation) --> U1-C (Tenant) [parallel]
U1-A (Shared Foundation) --> U1-D (User) [parallel]
U1-B + U1-C + U1-D --> unit/1-foundation integration branch

### Merge Order - Unit 1
1. feature/u1-shared-types -> unit/1-foundation
2. feature/u1-shared-middleware -> unit/1-foundation
3. feature/u1-auth-service -> unit/1-foundation (parallel with 4, 5)
4. feature/u1-tenant-module -> unit/1-foundation (parallel with 3, 5)
5. feature/u1-user-module -> unit/1-foundation (parallel with 3, 4)
6. unit/1-foundation -> develop (after integration checkpoint passes)

### Integration Checkpoint - Unit 1
- [ ] POST /api/auth/login returns JWT with userId, tenantId, role
- [ ] Account lockout triggers after 5 failures within 15 min
- [ ] Invite link flow: create tenant -> approve -> email sent -> setup link consumed -> Hospital Admin created
- [ ] requireRole middleware returns 403 for unauthorized role
- [ ] scopeTenant middleware returns 401 for INACTIVE tenant
- [ ] All Unit 1 unit tests pass
- [ ] All Unit 1 integration tests pass
- [ ] No TypeScript errors (tsc --noEmit)

---

## Unit 2: Patient and OPD

**Unit Branch**: unit/2-patient-opd | **Sprint**: Sprint 2
**Stories**: US-RC-01, US-NU-01, US-RC-02, US-DR-01, US-MG-01
**Depends On**: Unit 1 fully merged to develop

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U2-A: Patient Module | Registration, duplicate detection, search, Medical Card PDF | No - first |
| U2-B: OPD Module | Visit lifecycle, queue, history | After U2-A (needs Patient model) |
| U2-C: PDF Service (Medical Card) | PDFKit Medical Card generation | Parallel with U2-A |

### U2-A: Patient Module (feature/u2-patient-module)

| Task ID | Task | Owner |
|---|---|---|
| U2-A-01 | Patient Mongoose model + schema (tenantId scoped) | BE |
| U2-A-02 | PatientRepository (findByMobile, findById, search, save, update) | BE |
| U2-A-03 | PatientService (createPatient with duplicate detection, updatePatient, searchPatients, getPatientById, generateMedicalCard) | BE |
| U2-A-04 | Patient routes + controller | BE |
| U2-A-05 | Unit tests: PatientService (duplicate detection, audit log on update) | BE/QA |
| U2-A-06 | Integration tests: Patient endpoints | BE/QA |
| U2-A-07 | PBT: patient ID uniqueness invariant, search result consistency | BE/QA |

### U2-B: OPD Module (feature/u2-opd-module)

| Task ID | Task | Owner |
|---|---|---|
| U2-B-01 | OPDVisit Mongoose model + schema | BE |
| U2-B-02 | OPDRepository (findById, findByDate, findByPatient, save, updateStatus) | BE |
| U2-B-03 | OPDService (createVisit, updateVisit, completeVisit, getQueue, getVisitById, getPatientHistory) | BE |
| U2-B-04 | OPD routes + controller | BE |
| U2-B-05 | Unit tests: OPDService (COMPLETED visit update rejection, queue filtering) | BE/QA |
| U2-B-06 | Integration tests: OPD endpoints | BE/QA |

### U2-C: PDF Service - Medical Card (feature/u2-pdf-medical-card)

| Task ID | Task | Owner |
|---|---|---|
| U2-C-01 | PDFService.generateMedicalCard() - PDFKit implementation with tenant branding | BE |
| U2-C-02 | Unit tests: Medical Card PDF contains required fields | BE/QA |
| U2-C-03 | PBT: round-trip branding data in PDF generation | BE/QA |

### Dependency Graph - Unit 2
U2-C (PDF Service) --> U2-A (Patient Module uses generateMedicalCard)
U2-A (Patient Module) --> U2-B (OPD Module uses Patient model)

### Merge Order - Unit 2
1. feature/u2-pdf-medical-card -> unit/2-patient-opd (parallel with U2-A start)
2. feature/u2-patient-module -> unit/2-patient-opd
3. feature/u2-opd-module -> unit/2-patient-opd
4. unit/2-patient-opd -> develop

### Integration Checkpoint - Unit 2
- [ ] POST /api/patients creates patient with unique ID scoped to tenant
- [ ] Duplicate mobile number triggers alert (not auto-reject)
- [ ] GET /api/patients/:id/medical-card returns downloadable PDF with branding
- [ ] POST /api/opd/visits creates visit with OPEN status
- [ ] PATCH /api/opd/visits/:id/complete sets COMPLETED and rejects further updates
- [ ] All Unit 2 tests pass

---

## Unit 3: IPD

**Unit Branch**: unit/3-ipd | **Sprint**: Sprint 3
**Stories**: US-RC-03, US-DR-02, US-NU-02, US-MG-02
**Depends On**: Unit 1, Unit 2 (patient lookup)

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U3-A: Bed Registry | Ward + bed CRUD, occupancy tracking | No - first |
| U3-B: Admission Lifecycle | Admissions, progress notes, discharge | After U3-A |

### U3-A: Bed Registry (feature/u3-bed-registry)

| Task ID | Task | Owner |
|---|---|---|
| U3-A-01 | Ward + Bed Mongoose models + schemas | BE |
| U3-A-02 | Ward/Bed repository (createWard, addBeds, listWards, findActiveBed) | BE |
| U3-A-03 | Ward/Bed routes + controller (POST /api/ipd/wards, /api/ipd/wards/:id/beds) | BE |
| U3-A-04 | Unit tests: bed conflict detection | BE/QA |

### U3-B: Admission Lifecycle (feature/u3-admissions)

| Task ID | Task | Owner |
|---|---|---|
| U3-B-01 | IPDAdmission Mongoose model + schema | BE |
| U3-B-02 | IPDRepository (findById, findActiveBed, findActiveAdmissions, save, updateStatus) | BE |
| U3-B-03 | IPDService (createAdmission, addProgressNote, dischargePatient, listAdmissions, getBedOccupancySummary) | BE |
| U3-B-04 | IPD routes + controller | BE |
| U3-B-05 | Unit tests: IPDService (bed conflict, discharge releases bed, occupancy summary) | BE/QA |
| U3-B-06 | Integration tests: IPD endpoints | BE/QA |
| U3-B-07 | PBT: bed occupancy count invariants (total = occupied + available) | BE/QA |

### Merge Order - Unit 3
1. feature/u3-bed-registry -> unit/3-ipd
2. feature/u3-admissions -> unit/3-ipd
3. unit/3-ipd -> develop

### Integration Checkpoint - Unit 3
- [ ] Occupied bed assignment returns error with occupant admission ID
- [ ] Discharge sets DISCHARGED status and releases bed
- [ ] Bed occupancy summary: total = occupied + available per ward
- [ ] All Unit 3 tests pass

---

## Unit 4: Lab and Inventory

**Unit Branch**: unit/4-lab-inventory | **Sprint**: Sprint 4
**Stories**: US-RC-04, US-DR-03, US-PT-01, US-RL-01, US-AD-01, US-MG-03
**Depends On**: Unit 1, Unit 2 (patient lookup)

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U4-A: Notification Model | Notification Mongoose model + repository (stub for Unit 6) | No - first |
| U4-B: Lab Module | Pathology + radiology request lifecycle, S3 report upload | After U4-A |
| U4-C: Inventory Module | Stock management, low-stock alerts | After U4-A, parallel with U4-B |

### U4-A: Notification Model Stub (feature/u4-notification-stub)

| Task ID | Task | Owner |
|---|---|---|
| U4-A-01 | Notification Mongoose model + schema (notifications collection) | BE |
| U4-A-02 | NotificationRepository (save, findByUser, markRead, countUnread) | BE |
| U4-A-03 | NotificationService.sendNotification() - writes to MongoDB only, no WebSocket delivery yet | BE |
| U4-A-04 | NotificationService.sendToRole() - queries users by role, calls sendNotification per user | BE |

### U4-B: Lab Module (feature/u4-lab-module)

| Task ID | Task | Owner |
|---|---|---|
| U4-B-01 | PathologyRequest + RadiologyRequest Mongoose models + schemas | BE |
| U4-B-02 | LabRepository (findPathologyById, findRadiologyById, findByPatient, findPending*, save*) | BE |
| U4-B-03 | LabService - pathology: createPathologyRequest, uploadPathologyReport (10MB limit, S3) | BE |
| U4-B-04 | LabService - radiology: createRadiologyRequest, uploadRadiologyReport (20MB limit, S3) | BE |
| U4-B-05 | Lab routes + controller | BE |
| U4-B-06 | Unit tests: file size limits, status transitions, notification trigger | BE/QA |
| U4-B-07 | Integration tests: Lab endpoints including file upload | BE/QA |

### U4-C: Inventory Module (feature/u4-inventory-module)

| Task ID | Task | Owner |
|---|---|---|
| U4-C-01 | InventoryItem Mongoose model + schema | BE |
| U4-C-02 | InventoryRepository (findById, findAll, save, updateStock) | BE |
| U4-C-03 | InventoryService (createItem, updateStock, updateThreshold, listItems, getItemById) | BE |
| U4-C-04 | Inventory routes + controller | BE |
| U4-C-05 | Unit tests: negative stock rejection, low-stock notification trigger | BE/QA |
| U4-C-06 | Integration tests: Inventory endpoints | BE/QA |
| U4-C-07 | PBT: stock quantity invariants (never negative after valid operations) | BE/QA |

### Merge Order - Unit 4
1. feature/u4-notification-stub -> unit/4-lab-inventory
2. feature/u4-lab-module -> unit/4-lab-inventory (parallel with 3)
3. feature/u4-inventory-module -> unit/4-lab-inventory (parallel with 2)
4. unit/4-lab-inventory -> develop

### Integration Checkpoint - Unit 4
- [ ] Pathology report upload > 10MB rejected with descriptive error
- [ ] Radiology report upload > 20MB rejected with descriptive error
- [ ] Report upload sets status COMPLETED and persists notification to MongoDB
- [ ] Negative stock update rejected
- [ ] Stock below threshold persists low-stock notification to MongoDB
- [ ] All Unit 4 tests pass

---

## Unit 5: Payments

**Unit Branch**: unit/5-payments | **Sprint**: Sprint 5
**Stories**: US-RC-05, US-FM-01, US-MG-04
**Depends On**: Unit 1, Unit 2 (patient lookup)

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U5-A: PDF Service - Receipt | PDFKit receipt generation | No - first |
| U5-B: Manual Payment | Cash/Cheque recording, receipt PDF, S3 storage | After U5-A |
| U5-C: Razorpay Integration | Order creation, webhook handler, signature validation | After U5-A, parallel with U5-B |

### U5-A: PDF Service - Receipt (feature/u5-pdf-receipt)

| Task ID | Task | Owner |
|---|---|---|
| U5-A-01 | PDFService.generateReceipt() - PDFKit with tenant branding | BE |
| U5-A-02 | Unit tests: receipt PDF contains all required fields | BE/QA |

### U5-B: Manual Payment (feature/u5-manual-payment)

| Task ID | Task | Owner |
|---|---|---|
| U5-B-01 | Payment Mongoose model + schema | BE |
| U5-B-02 | PaymentRepository (findById, findByFilters, save, sumByMethod) | BE |
| U5-B-03 | PaymentService.createManualPayment() (Cash/Cheque, amount > 0, PDF + S3) | BE |
| U5-B-04 | PaymentService.listPayments() + getReceiptUrl() + getPaymentSummary() | BE |
| U5-B-05 | Payment routes + controller (manual endpoints) | BE |
| U5-B-06 | Unit tests: zero/negative amount rejection, receipt generation | BE/QA |
| U5-B-07 | Integration tests: manual payment endpoints | BE/QA |

### U5-C: Razorpay Integration (feature/u5-razorpay)

| Task ID | Task | Owner |
|---|---|---|
| U5-C-01 | Razorpay SDK setup, env vars (RAZORPAY_KEY_ID, KEY_SECRET, WEBHOOK_SECRET) | BE |
| U5-C-02 | PaymentService.createRazorpayOrder() | BE |
| U5-C-03 | PaymentService.handleRazorpayWebhook() with HMAC-SHA256 signature validation | BE |
| U5-C-04 | Webhook route (POST /api/webhooks/razorpay - public, no auth middleware) | BE |
| U5-C-05 | Unit tests: webhook signature validation (valid + tampered payloads) | BE/QA |
| U5-C-06 | Integration tests: Razorpay order creation | BE/QA |

### Merge Order - Unit 5
1. feature/u5-pdf-receipt -> unit/5-payments
2. feature/u5-manual-payment -> unit/5-payments (parallel with 3)
3. feature/u5-razorpay -> unit/5-payments (parallel with 2)
4. unit/5-payments -> develop

### Integration Checkpoint - Unit 5
- [ ] Manual payment with zero amount rejected
- [ ] Receipt PDF generated with tenant branding and all required fields
- [ ] Razorpay webhook with invalid signature returns 400
- [ ] Payment summary report returns correct totals by method
- [ ] All Unit 5 tests pass

---

## Unit 6: Notifications and Audit

**Stories**: US-CC-02, US-MG-05
**Depends On**: Unit 1, Unit 4 (notification model + repository already created)

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U6-A: WebSocket Delivery | Activate WebSocket server, JWT auth on upgrade, real-time push | No - first |
| U6-B: Notification API | History endpoint, mark-as-read, unread count | After U6-A |
| U6-C: Audit Module | Full AuditService (replaces stub), audit log query API | Parallel with U6-A |

### U6-A: WebSocket Delivery (feature/u6-websocket-delivery)

| Task ID | Task | Owner |
|---|---|---|
| U6-A-01 | Activate WebSocket server in server.ts (ws library, upgrade handler) | BE |
| U6-A-02 | JWT authentication on WebSocket upgrade (token query param) | BE |
| U6-A-03 | WebSocketService: registerConnection, removeConnection, pushToUser (full implementation) | BE |
| U6-A-04 | Extend NotificationService.sendNotification() to call WebSocketService.pushToUser() | BE |
| U6-A-05 | Unit tests: WebSocket connection auth, push delivery | BE/QA |

### U6-B: Notification API (feature/u6-notification-api)

| Task ID | Task | Owner |
|---|---|---|
| U6-B-01 | Notification routes + controller (GET /api/notifications, PATCH /:id/read, GET /unread-count) | BE |
| U6-B-02 | Unit tests: 30-day history filter, mark-as-read idempotency | BE/QA |
| U6-B-03 | Integration tests: Notification endpoints | BE/QA |
| U6-B-04 | PBT: mark-as-read idempotency (applying twice = same result) | BE/QA |

### U6-C: Audit Module (feature/u6-audit-module)

| Task ID | Task | Owner |
|---|---|---|
| U6-C-01 | AuditLog Mongoose model + schema (append-only, 365-day TTL index) | BE |
| U6-C-02 | AuditRepository (save, query with filters) | BE |
| U6-C-03 | AuditService full implementation (replaces stub): log() + queryLogs() | BE |
| U6-C-04 | Audit routes + controller (GET /api/audit) | BE |
| U6-C-05 | Audit failure handling: try/catch in log(), alert Super Admin on failure | BE |
| U6-C-06 | Unit tests: audit log write, query filters, failure non-blocking | BE/QA |
| U6-C-07 | Integration tests: Audit query endpoint | BE/QA |

### Merge Order - Unit 6
1. feature/u6-websocket-delivery -> unit/6-notifications-audit
2. feature/u6-audit-module -> unit/6-notifications-audit (parallel with 1)
3. feature/u6-notification-api -> unit/6-notifications-audit (after 1)
4. unit/6-notifications-audit -> develop

### Integration Checkpoint - Unit 6
- [ ] WebSocket connection authenticated via JWT query param
- [ ] Lab report completion triggers real-time WebSocket notification to requesting doctor
- [ ] Low-stock event triggers real-time notification to Manager + Admin roles
- [ ] Notification history returns last 30 days only
- [ ] Audit log write failure does NOT roll back primary operation
- [ ] Audit query filters by entityType, entityId, userId, dateRange
- [ ] All Unit 6 tests pass

---

## Unit 6: Notifications and Audit

**Unit Branch**: unit/6-notifications-audit | **Sprint**: Sprint 6
**Stories**: US-CC-02, US-MG-05
**Depends On**: Unit 1, Unit 4 (notification model already created)

### Subunits
| Subunit | Description | Parallel? |
|---|---|---|
| U6-A: WebSocket Delivery | Activate WS server, JWT auth on upgrade, real-time push | No - first |
| U6-C: Audit Module | Full AuditService (replaces stub), audit query API | Parallel with U6-A |

### U6-A: WebSocket Delivery (feature/u6-websocket-delivery)
| Task ID | Task | Owner |
|---|---|---|
| U6-A-01 | Activate WebSocket server in server.ts (ws library, upgrade handler) | BE |
| U6-A-02 | JWT authentication on WebSocket upgrade (token query param) | BE |
| U6-A-03 | WebSocketService: registerConnection, removeConnection, pushToUser (full) | BE |
| U6-A-04 | Extend NotificationService.sendNotification() to call WebSocketService.pushToUser() | BE |
| U6-A-05 | Unit tests: WS connection auth, push delivery | BE/QA |

### U6-B: Notification API (feature/u6-notification-api)
| Task ID | Task | Owner |
|---|---|---|
| U6-B-01 | Notification routes + controller (GET /api/notifications, PATCH /:id/read, GET /unread-count) | BE |
| U6-B-02 | Unit tests: 30-day history filter, mark-as-read idempotency | BE/QA |
| U6-B-03 | Integration tests: Notification endpoints | BE/QA |
| U6-B-04 | PBT: mark-as-read idempotency (applying twice = same result) | BE/QA |

### U6-C: Audit Module (feature/u6-audit-module)
| Task ID | Task | Owner |
|---|---|---|
| U6-C-01 | AuditLog Mongoose model + schema (append-only, 365-day TTL index) | BE |
| U6-C-02 | AuditRepository (save, query with filters) | BE |
| U6-C-03 | AuditService full implementation (replaces stub): log() + queryLogs() | BE |
| U6-C-04 | Audit routes + controller (GET /api/audit) | BE |
| U6-C-05 | Audit failure handling: try/catch in log(), alert Super Admin on failure | BE |
| U6-C-06 | Unit + integration tests: audit log write, query filters, failure non-blocking | BE/QA |

### Merge Order - Unit 6
1. feature/u6-websocket-delivery -> unit/6-notifications-audit
2. feature/u6-audit-module -> unit/6-notifications-audit (parallel with 1)
3. feature/u6-notification-api -> unit/6-notifications-audit (after 1)
4. unit/6-notifications-audit -> develop

### Integration Checkpoint - Unit 6
- [ ] WebSocket connection authenticated via JWT query param
- [ ] Lab report completion triggers real-time WS notification to requesting doctor
- [ ] Low-stock event triggers real-time notification to Manager + Admin roles
- [ ] Notification history returns last 30 days only
- [ ] Audit log write failure does NOT roll back primary operation
- [ ] Audit query filters by entityType, entityId, userId, dateRange
- [ ] All Unit 6 tests pass

---

## Unit 7: Frontend

**Unit Branch**: unit/7-frontend | **Sprint**: Sprint 7
**Stories**: All 27 stories (UI layer)
**Depends On**: Units 1-6 fully merged to develop

### Subunits

| Subunit | Description | Parallel? |
|---|---|---|
| U7-A: Foundation Shell | Redux store, RTK Query base, auth shell, layout shell, branding | No - first |
| U7-B: Super Admin + Hospital Admin | Tenant console, user management, branding config | After U7-A |
| U7-C: Patient + OPD | Patient registration, Medical Card, OPD queue + visit | After U7-A, parallel with U7-B |
| U7-D: IPD | Admission form, bed selector, ward list, occupancy | After U7-A, parallel with U7-B/C |
| U7-E: Lab + Inventory | Lab request forms, report upload, inventory management | After U7-A, parallel with U7-B/C/D |
| U7-F: Payments | Payment form (manual + Razorpay), receipt, summary | After U7-A, parallel with U7-B/C/D/E |
| U7-G: Notifications + Audit | Notification panel (WS client), audit log viewer | After U7-A, parallel with others |

### U7-A: Foundation Shell (feature/u7-foundation-shell) - Sequential First
| Task ID | Task | Owner |
|---|---|---|
| U7-A-01 | Next.js project init, Tailwind CSS, shadcn/ui setup | FE |
| U7-A-02 | Redux store setup (configureStore, authSlice, notificationSlice) | FE |
| U7-A-03 | RTK Query base API setup (baseQuery with JWT header injection) | FE |
| U7-A-04 | Auth Shell (FC-01): login page, first-login password change, forgot/reset password | FE |
| U7-A-05 | Layout Shell (FC-02): sidebar nav (RBAC-aware), notification bell + badge, branding CSS vars | FE |
| U7-A-06 | Tenant branding: fetch on login, apply logo/name/color via CSS custom properties | FE |
| U7-A-07 | WebSocket client: connect on login, dispatch to notificationSlice on message | FE |
| U7-A-08 | Unit tests: authSlice reducers, RBAC nav filtering | FE/QA |

### Parallel Frontend Subunits (all after U7-A merges)

**U7-B: Super Admin + Hospital Admin** (feature/u7-admin-panels)
- FC-03: Tenant onboarding form, tenant list, approve/deactivate/resend-invite actions
- FC-04: Branding config form (logo upload, display name, color picker), user management table
- Owner: FE

**U7-C: Patient + OPD** (feature/u7-patient-opd)
- FC-05: Patient registration form, duplicate alert modal, search, Medical Card download
- FC-06: OPD queue table (filter by doctor), visit detail form, complete visit action
- Owner: FE

**U7-D: IPD** (feature/u7-ipd)
- FC-07: Admission form with ward/bed selector, admitted patient list, progress note form, discharge action, occupancy summary
- Owner: FE

**U7-E: Lab + Inventory** (feature/u7-lab-inventory)
- FC-08: Pathology/radiology request forms, pending queues, report upload, patient lab history
- FC-09: Inventory item form, stock update form, inventory list (filterable/sortable)
- Owner: FE

**U7-F: Payments** (feature/u7-payments)
- FC-10: Payment form (manual + Razorpay checkout), receipt download, payment list, summary report
- Owner: FE

**U7-G: Notifications + Audit** (feature/u7-notifications-audit)
- FC-11: Slide-out notification panel, WS-driven updates, mark-as-read
- FC-12: Audit log query form, results table
- Owner: FE

### Dependency Graph - Unit 7
U7-A (Foundation Shell)
    |
    +---> U7-B (Admin Panels)     [parallel]
    +---> U7-C (Patient + OPD)    [parallel]
    +---> U7-D (IPD)              [parallel]
    +---> U7-E (Lab + Inventory)  [parallel]
    +---> U7-F (Payments)         [parallel]
    +---> U7-G (Notifications)    [parallel]
All --> unit/7-frontend integration branch

### Merge Order - Unit 7
1. feature/u7-foundation-shell -> unit/7-frontend
2-7. feature/u7-admin-panels, u7-patient-opd, u7-ipd, u7-lab-inventory, u7-payments, u7-notifications-audit -> unit/7-frontend (all parallel after step 1)
8. unit/7-frontend -> develop

### Integration Checkpoint - Unit 7
- [ ] Login page authenticates and redirects to role-appropriate dashboard
- [ ] Sidebar shows only modules permitted for the logged-in role
- [ ] Tenant branding (logo, name, primary color) applied on login
- [ ] Patient registration form creates patient and downloads Medical Card PDF
- [ ] OPD queue shows today's visits filterable by doctor
- [ ] Notification bell shows unread count badge; panel updates in real time
- [ ] Razorpay checkout flow initiates and receipt downloads on success
- [ ] All Unit 7 unit tests pass
- [ ] All Unit 7 integration tests pass

---

## Full System Dependency Graph

Sprint 0 (Infra)
    |
    v
Unit 1: Foundation (Auth + Tenant + User)
    |
    v
Unit 2: Patient + OPD
    |
    v
Unit 3: IPD
    |
    v
Unit 4: Lab + Inventory
    |
    v
Unit 5: Payments
    |
    v
Unit 6: Notifications + Audit
    |
    v
Unit 7: Frontend
    |
    v
Build and Test (Sprint 8)

---

## Suggested Developer Ownership
| Unit | Subunit | Suggested Owner | Notes |
|---|---|---|---|
| Sprint 0 | Infra setup | OPS | Repo, CI/CD, AWS, Docker |
| Unit 1 | U1-A Shared Foundation | BE Lead | Critical path - blocks all other work |
| Unit 1 | U1-B Auth | BE-1 | Security-critical - senior developer recommended |
| Unit 1 | U1-C Tenant | BE-2 | Parallel with Auth |
| Unit 1 | U1-D User | BE-3 or BE-1 | Parallel with Auth + Tenant |
| Unit 2 | U2-A Patient + U2-C PDF | BE-1 | PDF generation is non-trivial |
| Unit 2 | U2-B OPD | BE-2 | Straightforward CRUD + status machine |
| Unit 3 | U3-A Bed Registry | BE-2 | |
| Unit 3 | U3-B Admissions | BE-1 | Bed conflict logic needs care |
| Unit 4 | U4-A Notification Stub | BE-3 | Simple model + repository |
| Unit 4 | U4-B Lab | BE-1 | File upload + S3 integration |
| Unit 4 | U4-C Inventory | BE-2 | Parallel with Lab |
| Unit 5 | U5-A PDF Receipt | BE-1 | Reuses PDFKit patterns from Unit 2 |
| Unit 5 | U5-B Manual Payment | BE-2 | |
| Unit 5 | U5-C Razorpay | BE-1 | Security-critical webhook validation |
| Unit 6 | U6-A WebSocket | BE-1 | Real-time infrastructure |
| Unit 6 | U6-B Notification API | BE-2 | |
| Unit 6 | U6-C Audit | BE-3 | Replaces stub - coordinate with all teams |
| Unit 7 | U7-A Foundation Shell | FE Lead | Blocks all other FE work |
| Unit 7 | U7-B Admin Panels | FE-1 | |
| Unit 7 | U7-C Patient + OPD | FE-2 | |
| Unit 7 | U7-D IPD | FE-1 or FE-3 | |
| Unit 7 | U7-E Lab + Inventory | FE-2 or FE-3 | |
| Unit 7 | U7-F Payments | FE-1 | Razorpay checkout integration |
| Unit 7 | U7-G Notifications + Audit | FE-2 | WebSocket client integration |

---

## Suggested Developer Ownership

| Unit | Subunit | Suggested Owner |
|---|---|---|
| Sprint 0 | Infra setup | OPS |
| Unit 1 | U1-A Shared Foundation | BE Lead (critical path) |
| Unit 1 | U1-B Auth | BE-1 (security-critical) |
| Unit 1 | U1-C Tenant | BE-2 (parallel) |
| Unit 1 | U1-D User | BE-3 (parallel) |
| Unit 2 | U2-A Patient + U2-C PDF | BE-1 |
| Unit 2 | U2-B OPD | BE-2 |
| Unit 3 | U3-A Bed Registry | BE-2 |
| Unit 3 | U3-B Admissions | BE-1 (bed conflict logic) |
| Unit 4 | U4-A Notification Stub | BE-3 |
| Unit 4 | U4-B Lab | BE-1 (S3 file upload) |
| Unit 4 | U4-C Inventory | BE-2 (parallel) |
| Unit 5 | U5-A PDF Receipt | BE-1 |
| Unit 5 | U5-B Manual Payment | BE-2 |
| Unit 5 | U5-C Razorpay | BE-1 (security-critical webhook) |
| Unit 6 | U6-A WebSocket | BE-1 (real-time infra) |
| Unit 6 | U6-B Notification API | BE-2 |
| Unit 6 | U6-C Audit | BE-3 (replaces stub) |
| Unit 7 | U7-A Foundation Shell | FE Lead (blocks all FE) |
| Unit 7 | U7-B Admin Panels | FE-1 |
| Unit 7 | U7-C Patient + OPD | FE-2 |
| Unit 7 | U7-D IPD | FE-1 or FE-3 |
| Unit 7 | U7-E Lab + Inventory | FE-2 or FE-3 |
| Unit 7 | U7-F Payments | FE-1 (Razorpay checkout) |
| Unit 7 | U7-G Notifications + Audit | FE-2 (WS client) |

---

## Sprint-Ready Task Summary

| Sprint | Task Count | Parallelizable Tasks | Sequential Tasks |
|---|---|---|---|
| Sprint 0 | 10 | 7 (S0-03 to S0-09) | 3 (S0-01, S0-02, S0-06) |
| Sprint 1 (Unit 1) | 22 | 18 (U1-B, U1-C, U1-D) | 4 (U1-A-01 to U1-A-04) |
| Sprint 2 (Unit 2) | 13 | 7 (U2-B, U2-C) | 6 (U2-A) |
| Sprint 3 (Unit 3) | 11 | 6 (U3-B) | 5 (U3-A) |
| Sprint 4 (Unit 4) | 16 | 11 (U4-B, U4-C) | 5 (U4-A) |
| Sprint 5 (Unit 5) | 12 | 8 (U5-B, U5-C) | 4 (U5-A) |
| Sprint 6 (Unit 6) | 13 | 8 (U6-A, U6-C) | 5 (U6-B after U6-A) |
| Sprint 7 (Unit 7) | 20 | 14 (U7-B through U7-G) | 6 (U7-A) |
| Sprint 8 (Build+Test) | TBD | - | - |

**Total sprint-ready tasks (Sprints 0-7)**: ~117 tasks
**Maximum parallelizable at any point**: 3 BE developers (Units 1-6) + 6 FE developers (Unit 7)

---

## PR Template Recommendation

Each PR should include:
- Unit and subunit reference (e.g., Unit 1 / U1-B Auth)
- Task IDs completed (e.g., U1-B-01, U1-B-02)
- Stories covered (e.g., US-CC-01)
- Tests added (unit / integration / PBT)
- Integration checkpoint items verified (checklist)
- Security compliance notes (SECURITY rules applicable to this PR)

---

## Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Unit 1 delays block all other units | Prioritize U1-A shared foundation; BE Lead owns it exclusively |
| AuditService stub diverges from full implementation | Define AuditService interface in Unit 1; stub and full impl share the same interface |
| NotificationService stub misses edge cases | Unit 4 writes integration tests against the stub; Unit 6 must pass all same tests |
| Frontend built against unstable APIs | All backend units merged to develop before Unit 7 starts |
| Razorpay webhook security flaw | BE-1 (senior) owns U5-C; mandatory security review before merge |
| File locking on team-execution-plan.md during editing | Close file in editor before running CI scripts that read it |
