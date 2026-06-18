# Components — Hospital Management Platform (HMS)

**Architecture**: Modular Monolith (Node.js + Express + TypeScript)  
**API Style**: REST + WebSocket  
**Middleware**: Express middleware chain  
**Data Access**: Repository pattern  
**Frontend**: Next.js + Redux Toolkit + shadcn/ui + Tailwind CSS

---

## Backend Components

---

### BC-01: Auth Module

**Purpose**: Handles all authentication and session management concerns.

**Responsibilities**:
- Issue and validate signed JWTs (user ID, tenant ID, role, 8h expiry)
- Enforce first-login password change
- Implement account lockout (5 failures / 15 min window, 30 min lockout)
- Maintain in-memory JWT denylist for logout invalidation
- Handle forgot-password and password-reset flows
- Send account-lock notification emails via Nodemailer

**Interfaces**:
- `POST /api/auth/login` — credential validation, JWT issuance
- `POST /api/auth/logout` — JWT denylist addition
- `POST /api/auth/change-password` — first-login and voluntary password change
- `POST /api/auth/forgot-password` — initiate reset flow
- `POST /api/auth/reset-password` — consume reset token, set new password
- `GET /api/auth/me` — return current user profile from JWT

**Middleware Provided**:
- `authenticateJWT` — validates JWT on every protected request
- `requireFirstPasswordChange` — blocks access until password changed on first login

---

### BC-02: Tenant Module

**Purpose**: Manages hospital tenant lifecycle and branding configuration.

**Responsibilities**:
- Create and manage Tenant records (PENDING_VERIFICATION → ACTIVE → INACTIVE)
- Store and serve Onboarding Documents (S3 URLs)
- Manage branding configuration (logo S3 URL, display name, primary color)
- Generate and validate one-time invite links (signed JWT, 48h expiry)
- Enforce tenant deactivation (blocks all tenant user logins)
- Send Invite Emails via Nodemailer

**Interfaces**:
- `POST /api/tenants` — Super Admin creates new tenant
- `GET /api/tenants` — Super Admin lists all tenants (paginated)
- `PATCH /api/tenants/:tenantId/approve` — Super Admin approves tenant
- `PATCH /api/tenants/:tenantId/deactivate` — Super Admin deactivates tenant
- `POST /api/tenants/:tenantId/resend-invite` — Super Admin regenerates invite link
- `POST /api/tenants/setup` — Hospital Admin completes initial setup via invite link
- `GET /api/tenants/:tenantId/branding` — fetch branding config (used at login)
- `PATCH /api/tenants/:tenantId/branding` — Hospital Admin updates branding
- `POST /api/tenants/:tenantId/branding/logo` — Hospital Admin uploads logo (max 2 MB)

---

### BC-03: User Module

**Purpose**: Manages user accounts within a tenant.

**Responsibilities**:
- Create user accounts with assigned roles within a tenant
- Send welcome emails with temporary passwords via Nodemailer
- Deactivate user accounts (with last-admin guard)
- Update user roles
- Enforce at-least-one-active-admin constraint per tenant

**Interfaces**:
- `POST /api/users` — Hospital Admin / HR creates user
- `GET /api/users` — list users within tenant (paginated, filterable by role/status)
- `GET /api/users/:userId` — get user details
- `PATCH /api/users/:userId/role` — update user role
- `PATCH /api/users/:userId/deactivate` — deactivate user account

---

### BC-04: Patient Module

**Purpose**: Manages patient registration, identity, and Medical Card generation.

**Responsibilities**:
- Register patients with required and optional fields
- Detect and flag duplicate mobile numbers within tenant
- Generate Medical Card PDFs (PDFKit, synchronous, with tenant branding)
- Support patient search by ID, name, or mobile number
- Record demographic update audit log entries

**Interfaces**:
- `POST /api/patients` — Receptionist / Nurse creates patient
- `GET /api/patients` — search patients (query: patientId, name, mobile)
- `GET /api/patients/:patientId` — get patient details
- `PATCH /api/patients/:patientId` — update patient demographics
- `GET /api/patients/:patientId/medical-card` — download Medical Card PDF

---

### BC-05: OPD Module

**Purpose**: Manages outpatient visit lifecycle.

**Responsibilities**:
- Create OPD visits (OPEN status) assigned to a doctor
- Allow doctors to record chief complaint, diagnosis, prescription (free-text), follow-up date
- Mark visits as COMPLETED with timestamp
- Prevent updates to COMPLETED visits
- Provide daily OPD queue filtered by doctor
- Provide full patient visit history

**Interfaces**:
- `POST /api/opd/visits` — Receptionist creates OPD visit
- `GET /api/opd/visits` — list today's OPD queue (filter: doctorId scoped via `doctorIds[]`, date)
- `GET /api/opd/visits/:visitId` — get visit details
- `PATCH /api/opd/visits/:visitId` — Doctor updates visit (complaint, diagnosis, prescription, follow-up)
- `PATCH /api/opd/visits/:visitId/complete` — Doctor marks visit COMPLETED
- `GET /api/opd/patients/:patientId/history` — full visit history for patient

---

### BC-06: IPD Module

**Purpose**: Manages inpatient admission lifecycle and bed registry.

**Responsibilities**:
- Maintain master bed registry — Hospital Admin pre-configures wards and beds per tenant
- Create IPD admissions with unique admission ID and bed conflict detection — Receptionist
- Reject occupied-bed assignment with descriptive error listing the occupant admission ID
- Record daily progress notes per admission with doctor user ID and timestamp — Doctor
- Discharge patients (DISCHARGED status, discharge date recorded, bed released) — Doctor, Hospital Admin, Admin, Receptionist
- Provide admitted patient list filterable by ward — Doctor, Nurse, Manager, Hospital Admin, Receptionist
- Provide bed occupancy summary per ward (total / occupied / available) — Manager, Hospital Admin

**Interfaces**:

| Method | Endpoint | Allowed Roles |
|--------|----------|---------------|
| `POST` | `/api/ipd/wards` | Hospital Admin |
| `POST` | `/api/ipd/wards/:wardId/beds` | Hospital Admin |
| `GET`  | `/api/ipd/wards` | Hospital Admin, Manager, Doctor, Nurse, Receptionist |
| `GET`  | `/api/ipd/wards/:wardId/beds` | Hospital Admin, Manager, Doctor, Nurse, Receptionist |
| `POST` | `/api/ipd/admissions` | Receptionist |
| `GET`  | `/api/ipd/admissions` | Doctor, Nurse, Manager, Hospital Admin, Receptionist |
| `GET`  | `/api/ipd/admissions/:admissionId` | Doctor, Nurse, Manager, Hospital Admin, Receptionist |
| `POST` | `/api/ipd/admissions/:admissionId/notes` | Doctor |
| `PATCH`| `/api/ipd/admissions/:admissionId/discharge` | Doctor, Hospital Admin, Admin, Receptionist |
| `GET`  | `/api/ipd/occupancy` | Manager, Hospital Admin |

**Bed conflict rule**: If a Receptionist attempts to assign an occupied bed, the service returns HTTP 409 with `{ occupantAdmissionId }` in the response body.

---

### BC-07: Lab Module

**Purpose**: Manages pathology and radiology test request lifecycle and report uploads.

**Responsibilities**:
- Create pathology test requests (PENDING status)
- Create radiology imaging requests (PENDING status)
- Accept report file uploads (S3 storage), enforce size limits (10 MB pathology, 20 MB radiology)
- Set request status to COMPLETED on upload
- Trigger in-app notification to requesting doctor on completion
- Provide pending queues per lab type
- Provide patient lab history ordered by date descending

**Interfaces**:
- `POST /api/lab/pathology` — Doctor / Receptionist creates pathology request
- `GET /api/lab/pathology` — list pathology requests (filter: patientId, status)
- `POST /api/lab/pathology/:requestId/report` — Pathologist uploads report (multipart)
- `POST /api/lab/radiology` — Doctor / Receptionist creates radiology request
- `GET /api/lab/radiology` — list radiology requests (filter: patientId, status)
- `POST /api/lab/radiology/:requestId/report` — Radiologist uploads report (multipart)

---

### BC-08: Inventory Module

**Purpose**: Manages hospital equipment and consumable stock.

**Responsibilities**:
- Add and manage inventory items (Equipment / Consumable categories)
- Update stock quantities with audit log entries
- Enforce non-negative stock constraint
- Trigger in-app notification when stock falls below minimum threshold
- Provide filterable, sortable inventory list
- Allow minimum threshold updates

**Interfaces**:
- `POST /api/inventory` — Manager / Admin creates inventory item
- `GET /api/inventory` — list items (filter: category, sort: stockQuantity)
- `GET /api/inventory/:itemId` — get item details
- `PATCH /api/inventory/:itemId/stock` — update stock quantity (with reason)
- `PATCH /api/inventory/:itemId/threshold` — update minimum stock threshold

---

### BC-09: Payment Module

**Purpose**: Manages payment recording, Razorpay integration, and receipt generation.

**Responsibilities**:
- Record manual payments (Cash, Cheque) with validation (amount > 0)
- Initiate Razorpay orders for UPI / Card payments
- Handle Razorpay webhook confirmations (signature validation, payment record creation)
- Generate receipt PDFs synchronously (PDFKit, with tenant branding, stored in S3)
- Provide payment records filterable by date range and method
- Provide payment summary reports broken down by method
- Serve receipt PDFs via S3 pre-signed URLs

**Interfaces**:
- `POST /api/payments` — Finance Manager / Receptionist records manual payment
- `POST /api/payments/razorpay/order` — initiate Razorpay order
- `POST /api/webhooks/razorpay` — Razorpay webhook (public, signature-validated)
- `GET /api/payments` — list payments (filter: dateRange, method)
- `GET /api/payments/:paymentId/receipt` — download receipt PDF
- `GET /api/payments/summary` — payment summary report (filter: dateRange)

---

### BC-10: Notification Module

**Purpose**: Manages real-time in-app notifications via WebSocket.

**Responsibilities**:
- Maintain WebSocket connections per authenticated user
- Deliver notifications to target users in real time
- Persist notification records in MongoDB (30-day history)
- Track UNREAD / READ status per notification
- Provide notification history API

**Interfaces**:
- `WS /ws` — WebSocket connection endpoint (authenticated via JWT query param)
- `GET /api/notifications` — list notifications for current user (last 30 days)
- `PATCH /api/notifications/:notificationId/read` — mark notification as READ
- `GET /api/notifications/unread-count` — get unread count for badge

---

### BC-11: Audit Module

**Purpose**: Provides append-only audit logging for all critical entity operations.

**Responsibilities**:
- Write audit log entries for CREATE / UPDATE / DELETE on: Patient, OPD Visit, IPD Admission, Pathology Request, Radiology Request, Inventory Item, Payment Record, User Account
- Store: entity type, entity ID, action, previous value, new value, user ID, tenant ID, UTC timestamp
- Enforce 365-day retention
- Provide queryable audit log API (filter: entityType, entityId, userId, dateRange)
- Never block primary operations on audit write failure; alert Super Admin on failure

**Interfaces**:
- `GET /api/audit` — Hospital Admin / Manager queries audit logs (filter: entityType, entityId, userId, dateRange)

---

## Shared Infrastructure Services

---

### SI-01: Email Service

**Purpose**: Sends all system emails via Nodemailer with configurable SMTP.

**Responsibilities**:
- Send Invite Emails (one-time setup link)
- Send welcome emails (temporary password)
- Send account-lock notification emails
- Send password-reset emails

**Used by**: Auth Module, Tenant Module, User Module

---

### SI-02: S3 Service

**Purpose**: Handles all file storage interactions with AWS S3.

**Responsibilities**:
- Upload files (logos, reports, PDFs) to S3
- Generate pre-signed URLs for file downloads (1h for reports, 24h for Medical Cards/receipts)
- Enforce bucket-level public access block

**Used by**: Tenant Module, Lab Module, Patient Module, Payment Module

---

### SI-03: PDF Service

**Purpose**: Generates PDFs synchronously using PDFKit.

**Responsibilities**:
- Generate Medical Card PDFs (with tenant branding)
- Generate receipt PDFs (with tenant branding)
- Apply tenant logo and hospital name to all documents

**Used by**: Patient Module, Payment Module

---

### SI-04: WebSocket Service

**Purpose**: Manages WebSocket server and connection registry.

**Responsibilities**:
- Maintain a map of `userId → WebSocket connection`
- Authenticate connections via JWT
- Broadcast notifications to specific users or role groups within a tenant

**Used by**: Notification Module, Lab Module, Inventory Module, Auth Module

---

## Frontend Components

---

### FC-01: Auth Shell

**Purpose**: Login, first-login password change, forgot/reset password pages.  
**State**: Redux auth slice (JWT, user profile, tenant branding)

---

### FC-02: Layout Shell

**Purpose**: Persistent app shell — sidebar navigation (RBAC-aware), header with notification bell + unread badge, tenant branding applied via CSS variables.  
**State**: Redux auth slice (role → visible nav items), Redux notification slice (unread count)

---

### FC-03: Super Admin Console

**Purpose**: Tenant onboarding form, tenant list with status, approve/deactivate actions, resend invite.  
**State**: Redux RTK Query — tenant endpoints

---

### FC-04: Hospital Admin Panel

**Purpose**: Branding configuration form (logo upload, display name, primary color), user management table (create, deactivate, role update).  
**State**: Redux RTK Query — tenant branding + user endpoints

---

### FC-05: Patient Management

**Purpose**: Patient registration form, duplicate detection alert, patient search, Medical Card download button.  
**State**: Redux RTK Query — patient endpoints

---

### FC-06: OPD Module UI

**Purpose**: OPD queue table (filterable by doctor), visit detail form (complaint, diagnosis, prescription, follow-up), complete visit action.  
**State**: Redux RTK Query — OPD endpoints

---

### FC-07: IPD Module UI

**Purpose**: Admission creation form (ward/bed selector from registry), admitted patient list (filterable by ward), progress note form, discharge action, bed occupancy summary.  
**State**: Redux RTK Query — IPD endpoints

---

### FC-08: Lab Module UI

**Purpose**: Pathology/radiology request forms, pending queue tables, report upload interface, patient lab history.  
**State**: Redux RTK Query — lab endpoints

---

### FC-09: Inventory Module UI

**Purpose**: Inventory item form, stock quantity update form (with reason), inventory list (filterable/sortable), threshold update.  
**State**: Redux RTK Query — inventory endpoints

---

### FC-10: Payment Module UI

**Purpose**: Payment recording form (manual + Razorpay flow), receipt download, payment list (filterable), payment summary report.  
**State**: Redux RTK Query — payment endpoints  
**Date filter validation**: The "To Date" picker is disabled until a "From Date" is selected, and its minimum selectable date is constrained to the selected "From Date". If the user changes "From Date" to a value after the current "To Date", the "To Date" is automatically cleared.

---

### FC-11: Notification Panel

**Purpose**: Slide-out notification panel, notification list (UNREAD/READ), mark-as-read action, unread badge on bell icon.  
**State**: Redux notification slice (WebSocket-driven updates)

---

### FC-12: Audit Log Viewer

**Purpose**: Audit log query form (filters: entity type, entity ID, user ID, date range), results table.  
**State**: Redux RTK Query — audit endpoints
