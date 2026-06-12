# Requirements Document — Hospital Management Platform (HMS)

**Version**: 1.0  
**Date**: 2026-05-12  
**Status**: Approved

---

## Intent Analysis Summary

| Field | Value |
|---|---|
| **User Request** | Build a multi-tenant Hospital Management System (HMS) for the Indian healthcare market |
| **Request Type** | New Project (Greenfield) |
| **Scope Estimate** | System-wide — 9 backend service modules, full-stack (Next.js + Node.js + MongoDB + AWS) |
| **Complexity Estimate** | Complex — multi-tenancy, RBAC, clinical workflows, file handling, real-time notifications, payment integration |

---

## Glossary

| Term | Definition |
|---|---|
| Super_Admin | Platform-level administrator managing hospital onboarding |
| Hospital_Admin | Tenant-level administrator managing roles, users, and branding |
| Manager | Hospital role for overall operations management |
| Doctor | Hospital role for patient consultations and prescriptions |
| Nurse | Hospital role for patient care and ward assistance |
| Receptionist | Hospital role for patient registration and Medical Card creation |
| Pathologist | Hospital role for managing pathology lab reports |
| Radiologist | Hospital role for managing radiology lab reports |
| Finance_Manager | Hospital role for payment processing and receipt generation |
| HR | Hospital role for staff management |
| Staff | General hospital support role |
| Tenant | A hospital entity onboarded onto the platform with isolated data and branding |
| Medical_Card | Patient identity PDF with hospital branding, demographics, and unique patient ID |
| OPD | Outpatient Department — patients visiting for consultation without admission |
| IPD | Inpatient Department — patients admitted to the hospital |
| Inventory | Module managing hospital equipment and consumable stock |
| Pathology_Module | Module managing lab test requests and pathology reports |
| Radiology_Module | Module managing imaging requests and radiology reports |
| Payment_Module | Module managing payment submissions and receipt generation |
| Invite_Email | System-generated email with a one-time setup link sent to Hospital Admin |
| Onboarding_Document | Hospital registration document submitted during onboarding |
| RBAC | Role-Based Access Control |
| JWT | JSON Web Token — authentication token format |

---

## Technology Stack Decisions

| Layer | Technology | Decision Rationale |
|---|---|---|
| Frontend | Next.js (React) | Specified in requirements |
| Backend | Node.js + Express + TypeScript | Specified in requirements; modular monolith architecture |
| Database | MongoDB (shared DB, shared collections, tenantId scoping) | Specified; shared collections with tenantId field for multi-tenancy |
| Deployment | AWS EC2 (Docker containers on EC2) | User selected EC2; containerized for portability |
| File Storage | AWS S3 with pre-signed URLs | All file uploads (logos, reports) stored in S3 |
| Token Denylist | In-memory store (single-instance) | User selected; suitable for initial phase |
| Real-time Notifications | WebSockets | User selected for real-time push |
| PDF Generation | PDFKit (Node.js) | Medical Cards and payment receipts |
| Email Delivery | Nodemailer with configurable SMTP | User selected; flexible for any SMTP provider |
| Payment | Manual recording (Cash/Cheque) + Razorpay SDK (UPI/Card) | Hybrid: offline recording for Cash/Cheque, Razorpay for UPI/Card |
| PBT Framework | fast-check (TypeScript/Jest integration) | Per PBT-09; TypeScript project |
| Architecture | Modular Monolith | Single deployable Node.js app, modules separated by folder structure |

---

## Functional Requirements

---

### FR-01: Super Admin — Hospital Onboarding

**Source**: Requirement 1

1. The Super_Admin SHALL authenticate using a unique platform-level credential stored in a dedicated `super_admins` MongoDB collection (no tenantId) before accessing the onboarding console.
2. When the Super_Admin submits a hospital onboarding form with required Onboarding_Documents, the Tenant_Service SHALL create a new Tenant record with a unique tenant ID and status `PENDING_VERIFICATION`.
3. When the Super_Admin approves a Tenant, the Tenant_Service SHALL transition the Tenant status from `PENDING_VERIFICATION` to `ACTIVE`.
4. If a required Onboarding_Document is missing during submission, the Tenant_Service SHALL return a descriptive validation error listing the missing documents.
5. The Tenant_Service SHALL store the following Onboarding_Documents for each hospital: registration certificate, GST number, PAN card, and address proof. All documents SHALL be stored as files in AWS S3.
6. When a Tenant is set to `ACTIVE`, the System SHALL send an Invite_Email to the designated Hospital Admin email address containing a one-time setup link valid for 48 hours. The link SHALL be secured using a signed JWT token embedded in the URL.
7. If the one-time setup link expires before use, the Auth_Service SHALL reject the link and the Super_Admin SHALL be able to regenerate a new Invite_Email for that Tenant.
8. The Super_Admin SHALL be able to view a paginated list of all Tenants with their current status.
9. When the Super_Admin deactivates a Tenant, the Tenant_Service SHALL set the Tenant status to `INACTIVE` and the Auth_Service SHALL reject all login attempts from users belonging to that Tenant.

---

### FR-02: Multi-Tenant Isolation

**Source**: Requirement 2

1. The System SHALL associate every data record (patients, visits, reports, payments, inventory) with a `tenantId` field at the time of creation.
2. When a user makes an API request, the Auth_Service SHALL validate the JWT and extract the `tenantId`, and the System SHALL scope all MongoDB queries to that `tenantId`.
3. If a user attempts to access a resource belonging to a different `tenantId`, the System SHALL return an HTTP 403 Forbidden response.
4. The System SHALL enforce tenant isolation at the MongoDB query layer (not only at the API routing layer) by including `tenantId` as a mandatory filter in all data access operations.

---

### FR-03: Hospital Admin — Branding Configuration

**Source**: Requirement 3

1. When a Hospital Admin completes the initial setup via the Invite_Email link, the User_Service SHALL prompt the Hospital Admin to upload a hospital logo, set a hospital display name, and choose a primary color.
2. The Tenant_Service SHALL store the branding configuration (logo S3 URL, display name, primary color hex code) against the Tenant record.
3. When any user within a Tenant logs in, the System SHALL serve the branding configuration for that Tenant to the frontend.
4. When a Medical_Card or payment receipt is generated, the System SHALL apply the Tenant's branding (logo and hospital name) to the document.
5. If a Hospital Admin uploads a logo file exceeding 2 MB, the Tenant_Service SHALL reject the upload and return a descriptive error.

---

### FR-04: Hospital Admin — Role and User Management

**Source**: Requirement 4

1. The Hospital_Admin SHALL be able to create user accounts with the following roles: Manager, Doctor, Nurse, Receptionist, Pathologist, Radiologist, Finance_Manager, HR, Admin, and Staff.
2. When a Hospital Admin creates a user account, the User_Service SHALL send a welcome email (via Nodemailer/SMTP) to the user's email address containing a temporary password and a login link.
3. The System SHALL enforce RBAC such that each role has access only to its permitted modules as defined in the role-permission matrix (see FR-13).
4. When a user attempts to access a module not permitted for their role, the Auth_Service SHALL return an HTTP 403 Forbidden response.
5. The Hospital_Admin SHALL be able to deactivate a user account, after which the Auth_Service SHALL reject all login attempts for that account.
6. The Hospital_Admin SHALL be able to update a user's role, and the Auth_Service SHALL apply the new permissions on the user's next login.
7. The User_Service SHALL enforce that at least one active Hospital_Admin account exists per Tenant at all times.
8. If a Hospital Admin attempts to deactivate the last active Hospital_Admin account, the User_Service SHALL reject the operation and return a descriptive error.

---

### FR-05: Authentication and Session Management

**Source**: Requirement 5

1. When a user submits valid credentials, the Auth_Service SHALL return a signed JWT containing the user ID, tenant ID, and role, with an expiry of 8 hours.
2. If a user submits invalid credentials, the Auth_Service SHALL return an HTTP 401 Unauthorized response without revealing whether the email or password was incorrect.
3. The Auth_Service SHALL lock a user account after 5 consecutive failed login attempts within a 15-minute window and SHALL send an account-lock notification email (via Nodemailer/SMTP) to the user.
4. When a locked account's lockout period of 30 minutes expires, the Auth_Service SHALL automatically unlock the account.
5. When a user logs out, the Auth_Service SHALL invalidate the user's current JWT by adding it to an in-memory token denylist.
6. When a user's JWT expires, the System SHALL redirect the user to the login page.
7. The Auth_Service SHALL require users to change their temporary password on first login before accessing any other module.
8. The System SHALL support a full forgot-password flow: a user can request a password reset link sent to their registered email address; the link SHALL be valid for a limited time and invalidated after use.
9. Passwords SHALL be hashed using an adaptive hashing algorithm (bcrypt with cost factor ≥ 12).
10. The login endpoint SHALL implement rate limiting to prevent brute-force attacks.

---

### FR-06: Patient Registration and Medical Card

**Source**: Requirement 6

1. When a Receptionist submits a patient registration form with required fields, the Patient_Service SHALL create a patient record with a unique patient ID and associate it with the current Tenant.
2. The Patient_Service SHALL require the following fields for patient registration: full name, date of birth, gender, mobile number, and address.
3. The Patient_Service SHALL accept the following optional fields: Aadhaar number, emergency contact name, emergency contact mobile number, and blood group.
4. If a patient record with the same mobile number already exists within the same Tenant, the Patient_Service SHALL alert the Receptionist of a potential duplicate and require explicit confirmation before creating a new record.
5. When a patient record is created, the Patient_Service SHALL generate a Medical_Card as a downloadable PDF (using PDFKit) containing: hospital logo, hospital name, patient full name, patient ID, date of birth, gender, blood group (if provided), and mobile number.
6. The Patient_Service SHALL allow the Receptionist to search for existing patients by patient ID, full name, or mobile number within the same Tenant.
7. When a Receptionist updates a patient's demographic information, the Patient_Service SHALL record the previous values in an audit log with the timestamp and the Receptionist's user ID.

---

### FR-07: OPD — Outpatient Visit Management

**Source**: Requirement 7

1. When a Receptionist creates an OPD visit for an existing patient, the OPD_Service SHALL create a visit record with a unique visit ID, the patient ID, the assigned Doctor's user ID, visit date, and status `OPEN`.
2. The OPD_Service SHALL allow a Doctor to record the following for an OPD visit: chief complaint, diagnosis, prescription (stored as free-text), and follow-up date.
3. When a Doctor marks an OPD visit as complete, the OPD_Service SHALL set the visit status to `COMPLETED` and record the completion timestamp.
4. The OPD_Service SHALL allow a Receptionist or Manager to view the OPD queue for the current day, filtered by Doctor.
5. If a Doctor attempts to update an OPD visit with status `COMPLETED`, the OPD_Service SHALL reject the update and return a descriptive error.
6. The OPD_Service SHALL allow a Hospital Admin, Receptionist, Nurse, Manager, or Doctor to retrieve the full visit history for a patient within the same Tenant. The history SHALL be accessible from the Patient detail panel as an "OPD History" tab, paginated at 10 visits per page, and SHALL display visit date, queue number, status, chief complaint, diagnosis, prescription, and notes for each visit.

---

### FR-08: IPD — Inpatient Admission Management

**Source**: Requirement 8

1. When a Receptionist creates an IPD admission for an existing patient, the IPD_Service SHALL create an admission record with a unique admission ID, patient ID, assigned Doctor's user ID, ward, bed number, admission date, and status `ADMITTED`.
2. The Hospital_Admin SHALL be able to pre-configure a master bed registry (wards and bed numbers) per Tenant. The IPD_Service SHALL track bed occupancy against this registry.
3. The IPD_Service SHALL prevent assigning a bed that is already occupied by another active admission within the same Tenant.
4. If a Receptionist attempts to assign an occupied bed, the IPD_Service SHALL return a descriptive error listing the bed's current occupant admission ID.
5. When a Doctor records a daily progress note for an admitted patient, the IPD_Service SHALL store the note with the Doctor's user ID and timestamp.
6. When a Doctor, Hospital Admin, Admin, or Receptionist discharges a patient, the IPD_Service SHALL set the admission status to `DISCHARGED`, record the discharge date, and release the bed for future assignments.
7. The IPD_Service SHALL allow a Nurse or Doctor to view all currently admitted patients within the same Tenant, filterable by ward.
8. The IPD_Service SHALL allow a Manager to view a summary of bed occupancy per ward, showing total beds, occupied beds, and available beds.
9. The IPD_Service SHALL expose `GET /api/ipd/patients/:patientId/history` to retrieve all IPD admissions for a patient (both ADMITTED and DISCHARGED), paginated at 10 per page, filterable by status. Allowed roles: Hospital Admin, Admin, Manager, Doctor, Nurse, Receptionist. The history SHALL be accessible from the Patient detail panel as an "IPD History" tab alongside the existing "OPD History" tab, displaying ward, bed number, admission date, discharge date, and status for each admission.

---

### FR-09: Pathology Lab Reports

**Source**: Requirement 9

1. When a Doctor or Nurse creates a pathology test request for a patient, the Lab_Service SHALL create a test request record with a unique request ID, patient ID, test name(s), requesting Doctor's user ID, and status `PENDING`.
2. When a Pathologist uploads a pathology report for a test request, the Lab_Service SHALL store the report file (PDF or image, max 10 MB) in AWS S3, attach the S3 URL to the test request record, and set the status to `COMPLETED`.
3. If a Pathologist attempts to upload a report file exceeding 10 MB, the Lab_Service SHALL reject the upload and return a descriptive error.
4. When a pathology report status is set to `COMPLETED`, the System SHALL notify the requesting Doctor via an in-app WebSocket notification.
5. The Lab_Service SHALL allow a Doctor, Nurse, or Manager to view all pathology test requests for a patient within the same Tenant, ordered by request date descending.
6. The Lab_Service SHALL allow a Pathologist to view all pending pathology test requests within the same Tenant.

---

### FR-10: Radiology Lab Reports

**Source**: Requirement 10

1. When a Doctor or Nurse creates a radiology imaging request for a patient, the Lab_Service SHALL create an imaging request record with a unique request ID, patient ID, imaging type (X-Ray, MRI, CT Scan, Ultrasound), requesting Doctor's user ID, and status `PENDING`.
2. When a Radiologist uploads a radiology report for an imaging request, the Lab_Service SHALL store the report file (PDF or image, max 20 MB) in AWS S3, attach the S3 URL to the imaging request record, and set the status to `COMPLETED`.
3. If a Radiologist attempts to upload a report file exceeding 20 MB, the Lab_Service SHALL reject the upload and return a descriptive error.
4. When a radiology report status is set to `COMPLETED`, the System SHALL notify the requesting Doctor via an in-app WebSocket notification.
5. The Lab_Service SHALL allow a Doctor, Nurse, or Manager to view all radiology imaging requests for a patient within the same Tenant, ordered by request date descending.
6. The Lab_Service SHALL allow a Radiologist to view all pending radiology imaging requests within the same Tenant.

---

### FR-11: Hospital Equipment Inventory

**Source**: Requirement 11

1. The Inventory_Service SHALL allow a Manager or Admin to add an inventory item with the following fields: item name, category (Equipment or Consumable), unit of measure, current stock quantity, and minimum stock threshold.
2. When a Manager or Admin updates the stock quantity of an inventory item, the Inventory_Service SHALL record the previous quantity, new quantity, reason for change, and the user ID of the person making the change in an audit log.
3. When the stock quantity of an inventory item falls below its minimum stock threshold, the Inventory_Service SHALL generate an in-app WebSocket notification to the Manager and Admin roles within the same Tenant.
4. The Inventory_Service SHALL allow a Manager or Admin to view a list of all inventory items within the same Tenant, filterable by category and sortable by stock quantity.
5. If a Manager or Admin attempts to set a stock quantity to a negative value, the Inventory_Service SHALL reject the update and return a descriptive error.
6. The Inventory_Service SHALL allow a Manager or Admin to update the minimum stock threshold for any inventory item.

---

### FR-12: Payment Submission and Receipt Generation

**Source**: Requirement 12

1. The Payment_Service SHALL support two payment modes:
   - **Manual recording** (Cash, Cheque): Staff records the payment amount, method, and description after collecting offline.
   - **Razorpay integration** (UPI, Card): The system initiates a payment request via the Razorpay API; on successful webhook confirmation, the payment record is created automatically.
2. When a Finance_Manager or Receptionist submits a payment record for a patient, the Payment_Service SHALL create a payment record with a unique payment ID, patient ID, amount (in INR), payment method (Cash, Card, UPI, Cheque), description, and timestamp.
3. When a payment record is created, the Payment_Service SHALL generate a receipt as a downloadable PDF (using PDFKit) containing: hospital logo, hospital name, receipt number, patient name, patient ID, payment date, amount in INR, payment method, and description.
4. The Payment_Service SHALL apply the Tenant's branding (logo and hospital name) to every generated receipt.
5. The Payment_Service SHALL allow a Finance_Manager or Manager to view all payment records for a Tenant, filterable by date range and payment method. The date range filter SHALL enforce that the "To Date" cannot be set to a date before the "From Date"; selecting a "From Date" later than the current "To Date" SHALL automatically clear the "To Date".
6. If a Finance_Manager or Receptionist submits a payment with an amount of zero or a negative value, the Payment_Service SHALL reject the submission and return a descriptive error.
7. The Payment_Service SHALL allow a Finance_Manager or Receptionist to retrieve a previously generated receipt PDF by payment ID (served via AWS S3 pre-signed URL).
8. When a Finance_Manager generates a payment summary report for a date range, the Payment_Service SHALL return the total amount collected, broken down by payment method, for that date range within the same Tenant.

---

### FR-13: Role-Permission Matrix

**Source**: Requirement 13

The System SHALL enforce the following module access permissions per role at the API level (read-only roles can only call GET endpoints for that module):

| Module | Super Admin | Hospital Admin | Manager | Doctor | Nurse | Receptionist | Pathologist | Radiologist | Finance Manager | HR | Admin | Staff |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Tenant Onboarding | ✓ | | | | | | | | | | | |
| User Management | | ✓ | Read | | | | | | | ✓ | | |
| Patient Registration | | | ✓ | | ✓ | ✓ | | | | | | |
| OPD | | | ✓ | ✓ | Read | ✓ | | | | | | |
| IPD | | | ✓ | ✓ | ✓ | ✓ | | | | | | |
| Pathology | | ✓ | Read | ✓ | ✓ | | ✓ | Read | | | ✓ | |
| Radiology | | ✓ | Read | ✓ | ✓ | | Read | ✓ | | | ✓ | |
| Inventory | | | ✓ | | | | | | | | ✓ | |
| Payments | | | Read | | | ✓ | | | ✓ | | | |
| Branding Config | | ✓ | | | | | | | | | | |

1. When a user's JWT is validated, the Auth_Service SHALL load the role-permission matrix from a configuration store and evaluate the user's role against the requested resource.
2. The System SHALL log every access denial (HTTP 403) with the user ID, tenant ID, role, requested resource, and timestamp for audit purposes.

---

### FR-14: Audit Logging

**Source**: Requirement 14

1. The System SHALL create an audit log entry for every create, update, and delete operation on the following entities: Patient, OPD Visit, IPD Admission, Pathology Request, Radiology Request, Inventory Item, Payment Record, and User Account.
2. Each audit log entry SHALL contain: entity type, entity ID, action (CREATE, UPDATE, DELETE), previous value (for updates), new value, user ID, tenant ID, and UTC timestamp.
3. The System SHALL retain audit log entries for a minimum of 365 days.
4. The Hospital_Admin or Manager SHALL be able to query audit logs filtered by entity type, entity ID, user ID, and date range within the same Tenant.
5. If an audit log write fails, the System SHALL not roll back the primary operation but SHALL alert the Super_Admin via an error notification.

---

### FR-15: In-App Notification System

**Source**: Requirement 15

1. The System SHALL deliver in-app notifications via WebSockets to the relevant user(s) for the following events: pathology report completed, radiology report completed, inventory item below minimum threshold, and account locked.
2. When a notification is delivered, the System SHALL display it in the user's notification panel with a title, message, timestamp, and an `UNREAD` status.
3. When a user marks a notification as read, the System SHALL update the notification status to `READ`.
4. The System SHALL allow a user to view all notifications (both `UNREAD` and `READ`) within the last 30 days.
5. When a user has more than 0 unread notifications, the System SHALL display an unread count badge on the notification icon.

---

## Non-Functional Requirements

---

### NFR-01: Performance

- API response time SHALL be < 500ms at the 95th percentile under normal load.
- The system SHALL support up to 50 concurrent hospitals (tenants) at launch.
- MongoDB queries SHALL use compound indexes on `(tenantId, <entity-specific-field>)` for all frequently queried collections.

---

### NFR-02: Security

The following security constraints apply as hard requirements (enforced via Security Baseline extension):

- **SECURITY-01**: All data at rest (MongoDB, S3) SHALL use encryption. All data in transit SHALL use TLS 1.2+.
- **SECURITY-03**: All application components SHALL use structured logging with correlation IDs. Sensitive data (passwords, tokens, PII) SHALL NOT appear in logs.
- **SECURITY-04**: All HTML-serving endpoints SHALL set required HTTP security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy).
- **SECURITY-05**: Every API endpoint SHALL validate all input parameters using a validation library (e.g., Zod or Joi). All MongoDB queries SHALL use parameterized operations (no string concatenation).
- **SECURITY-08**: Every endpoint SHALL require authentication by default. Object-level authorization SHALL verify tenantId ownership on every resource access. CORS SHALL be restricted to explicitly allowed origins.
- **SECURITY-09**: Production error responses SHALL NOT expose stack traces or internal details. S3 buckets SHALL block public access.
- **SECURITY-10**: All dependencies SHALL use exact versions with a committed lock file. A dependency vulnerability scanning step SHALL be included in CI/CD.
- **SECURITY-11**: Security-critical logic (auth, authorization, payment) SHALL be isolated in dedicated modules. Rate limiting SHALL be applied to public-facing endpoints.
- **SECURITY-12**: Passwords SHALL be hashed with bcrypt (cost ≥ 12). Sessions SHALL be invalidated on logout. MFA SHALL be supported for Hospital_Admin accounts.
- **SECURITY-15**: All external calls (DB, HTTP, file I/O) SHALL have explicit error handling. A global error handler SHALL be configured. Systems SHALL fail closed on error.

---

### NFR-03: Data Retention

- Patient records and clinical data SHALL be retained indefinitely (no automated deletion).
- Audit log entries SHALL be retained for a minimum of 365 days.

---

### NFR-04: Scalability

- The modular monolith architecture SHALL be structured to allow future extraction of individual modules into separate services without major refactoring.
- MongoDB collections SHALL be designed with horizontal scaling (sharding by `tenantId`) in mind.

---

### NFR-05: Localization

- The system SHALL support English only for this phase.
- The codebase SHALL use externalized string constants (not hardcoded UI strings) to facilitate future i18n additions.

---

### NFR-06: Availability

- The system SHALL target 99.5% uptime for the initial phase.
- AWS EC2 instances SHALL be deployed with health checks and auto-restart policies.

---

### NFR-07: Property-Based Testing

The following PBT constraints apply as hard requirements (enforced via PBT extension):

- **PBT-09**: `fast-check` SHALL be selected as the PBT framework (TypeScript + Jest integration).
- **PBT-01**: Every unit containing business logic, data transformations, or algorithmic operations SHALL be analyzed for testable properties during Functional Design.
- **PBT-02 through PBT-10**: Full PBT enforcement applies — round-trip, invariant, idempotency, oracle, stateful, generator quality, shrinking, reproducibility, and complementary testing rules all apply.

---

### NFR-08: Email Delivery

- All system emails (invite links, welcome emails, account lock notifications, password reset links) SHALL be delivered via Nodemailer with a configurable SMTP provider.
- SMTP credentials SHALL be stored in environment variables (never hardcoded).

---

### NFR-09: File Storage

- All file uploads (hospital logos, pathology reports, radiology reports, generated PDFs) SHALL be stored in AWS S3.
- Files SHALL be served via pre-signed URLs with a defined expiry (default: 1 hour for reports, 24 hours for Medical Cards and receipts).
- S3 buckets SHALL block all public access; access SHALL be granted only via pre-signed URLs.

---

### NFR-10: Audit Trail Integrity

- Audit log entries SHALL be append-only; application code SHALL NOT have permission to delete or modify audit log records.
- Critical data changes SHALL be logged with actor, timestamp, and before/after values (per SECURITY-13).

---

## Architecture Overview

```
+----------------------------------------------------------+
|                    FRONTEND (Next.js)                    |
|  Tenant-branded UI | RBAC-aware routing | WebSocket client|
+----------------------------------------------------------+
                          |  HTTPS / WSS
+----------------------------------------------------------+
|              BACKEND — Modular Monolith                  |
|              (Node.js + Express + TypeScript)            |
|                                                          |
|  +----------+  +-----------+  +----------+  +--------+  |
|  |  Auth    |  |  Tenant   |  |  User    |  | Patient|  |
|  |  Module  |  |  Module   |  |  Module  |  | Module |  |
|  +----------+  +-----------+  +----------+  +--------+  |
|                                                          |
|  +------+  +------+  +--------+  +-----------+          |
|  | OPD  |  | IPD  |  |  Lab   |  | Inventory |          |
|  | Mod  |  | Mod  |  |  Mod   |  |   Mod     |          |
|  +------+  +------+  +--------+  +-----------+          |
|                                                          |
|  +-----------+  +------------------+                     |
|  |  Payment  |  |  Notification    |                     |
|  |  Module   |  |  Module (WS)     |                     |
|  +-----------+  +------------------+                     |
+----------------------------------------------------------+
          |                    |                |
    +----------+         +---------+      +----------+
    | MongoDB  |         |  AWS S3 |      | Razorpay |
    | (Atlas / |         | (Files) |      |   API    |
    |  EC2)    |         +---------+      +----------+
    +----------+
```

---

## Module Boundaries

| Module | Responsibilities |
|---|---|
| Auth Module | JWT issuance/validation, login, logout, token denylist, account lockout, password reset, first-login enforcement |
| Tenant Module | Hospital onboarding, tenant lifecycle (PENDING → ACTIVE → INACTIVE), branding config, invite link management |
| User Module | User account CRUD, role assignment, welcome email, last-admin guard |
| Patient Module | Patient registration, duplicate detection, Medical Card PDF generation, patient search, demographic audit log |
| OPD Module | OPD visit lifecycle (OPEN → COMPLETED), queue management, visit history |
| IPD Module | IPD admission lifecycle (ADMITTED → DISCHARGED), bed registry, progress notes, bed occupancy summary |
| Lab Module | Pathology and radiology request lifecycle (PENDING → COMPLETED), report file upload to S3, notifications |
| Inventory Module | Inventory item CRUD, stock quantity management, low-stock notifications, audit log |
| Payment Module | Manual payment recording, Razorpay integration (UPI/Card), receipt PDF generation, payment summary reports |
| Notification Module | WebSocket connection management, notification delivery, read/unread status, 30-day history |
| Audit Module | Append-only audit log writes, audit log query API |

---

## Key Constraints and Decisions

1. **Multi-tenancy**: Shared MongoDB database, shared collections. Every document carries a `tenantId` field. All queries MUST include `tenantId` as a filter — enforced at the data access layer.
2. **Token denylist**: In-memory store for this phase. This means JWT invalidation on logout is not persistent across server restarts. Acceptable for initial phase; must be replaced with Redis before scaling to multiple instances.
3. **Bed management**: Master bed registry pre-configured by Hospital Admin. Bed conflicts checked by querying active admissions.
4. **OPD prescriptions**: Stored as free-text. No structured prescription fields in this phase.
5. **Payment**: Hybrid — Cash/Cheque are manual entries; UPI/Card use Razorpay SDK with webhook confirmation.
6. **PDF generation**: PDFKit used for both Medical Cards and payment receipts.
7. **Notifications**: WebSocket-based real-time delivery. Notification history stored in MongoDB for 30-day retrieval.
8. **Security**: Full Security Baseline extension enforced (15 rules, all blocking).
9. **Testing**: Full PBT extension enforced (fast-check, all 10 rules blocking).
10. **Deployment**: AWS EC2 with Docker containers. Single-instance for initial phase.

---

---

# Enhancement Requirements — v1.1 (QA Rework Phase)

**Version**: 1.1  
**Date**: 2026-05-27  
**Status**: Approved for Implementation Planning  
**Scope**: Incremental enhancements only — no existing functionality modified or removed  
**Backward Compatibility**: All existing APIs, routes, naming conventions, RBAC logic, and database structures remain intact

> The following requirements supplement the v1.0 baseline. They are numbered with an `E` prefix (FR-E01 through FR-E07) to clearly distinguish them from the original approved requirements. Implementation SHALL NOT begin on any enhancement until explicitly instructed.

---

## FR-E01: Dashboard Analytics

**Source**: QA Gap — Dashboard Analytics Missing  
**Affected Roles**: Hospital_Admin, Manager, Staff (role-scoped subsets)  
**Affected Components (existing)**: FC-02 (Layout Shell), FC-04 (Hospital Admin Panel)  
**New Components**: FC-13 (Dashboard Analytics Widget Layer)

---

### FR-E01.1: Backend — Analytics Aggregation API

1. The System SHALL expose a new endpoint `GET /api/v1/dashboard/stats` that returns a role-scoped analytics payload. The response data fields returned SHALL depend on the authenticated user's role as defined in FR-E01.4.
2. The Analytics_Service SHALL compute dashboard statistics using MongoDB aggregation pipelines against the existing collections (`patients`, `opd_visits`, `ipd_admissions`, `lab_requests`, `inventory_items`, `payments`, `users`) — no new collections are required.
3. The endpoint SHALL accept an optional query parameter `?refresh=true` to bypass any server-side cache and recompute statistics live; by default, stats MAY be cached for up to 60 seconds per tenant using an in-memory TTL map (keyed by `tenantId + role`).
4. The Analytics_Service SHALL aggregate the following statistics where role-permitted (see FR-E01.4):
   - **Total Patients**: count of patient records for the tenant.
   - **Today's Appointments (OPD)**: count of OPD visits with `visitDate` equal to the current calendar date (tenant timezone assumed UTC for initial phase).
   - **Active IPD Admissions**: count of IPD admissions with status `ADMITTED`.
   - **Pending Lab Reports**: count of lab requests (pathology + radiology combined) with status `PENDING`.
   - **Revenue Summary**: total payment amount (INR) for the current calendar month, and total for the current calendar day.
   - **Low Stock Items**: count of inventory items where `currentStock < minimumThreshold`.
   - **Total Active Staff**: count of user accounts with status `ACTIVE` within the tenant.
   - **Monthly OPD Trend**: count of OPD visits grouped by day for the last 30 calendar days (for chart rendering).
   - **Monthly Revenue Trend**: sum of payment amounts grouped by day for the last 30 calendar days (for chart rendering).
5. The `GET /api/v1/dashboard/stats` endpoint SHALL be protected by existing `authenticateJWT`, `scopeTenant`, and `requireRole` middleware. Allowed roles: `Admin`, `Manager`, `Staff`, `Doctor`, `Nurse`, `Receptionist`.
6. Each aggregation pipeline SHALL include `tenantId` as the first match stage to ensure tenant isolation (per FR-02).
7. The Analytics_Service SHALL be implemented as a new file `src/modules/dashboard/dashboard.service.ts` to avoid modifying existing module services.
8. The dashboard module SHALL expose routes at `src/modules/dashboard/dashboard.routes.ts` and be registered in `app.ts` without altering existing route registrations.

---

### FR-E01.2: Backend — Real-Time Refresh Strategy

1. The frontend SHALL poll `GET /api/v1/dashboard/stats` at a configurable interval (default: 60 seconds) using RTK Query's `pollingInterval` option.
2. Server-side cache TTL (60 seconds) and client-side polling interval (60 seconds) SHALL be independently configurable via environment variables `DASHBOARD_CACHE_TTL_SECONDS` and `DASHBOARD_POLL_INTERVAL_SECONDS`.
3. The endpoint SHALL return a `lastUpdated` ISO timestamp in the response so the frontend can display a "Last refreshed at HH:MM" label.
4. No WebSocket events are required for dashboard stats in this phase; polling is sufficient.

---

### FR-E01.3: Frontend — Dashboard Widget UI

1. The existing dashboard landing page (the route served after login within `(dashboard)/`) SHALL be enhanced to display analytics widgets/cards. The current empty or minimal dashboard layout SHALL be replaced with a responsive widget grid; no other existing pages or components are to be modified.
2. Widgets SHALL be implemented as reusable React components under `components/dashboard/` — one component per stat category (e.g., `StatCard`, `TrendChart`, `AlertBadge`).
3. The widget layout SHALL use a CSS grid with responsive breakpoints: 1 column on mobile (< 768px), 2 columns on tablet (768px–1279px), 4 columns on desktop (≥ 1280px).
4. Each stat card SHALL display: an icon, a label, a primary value, and a secondary context (e.g., "vs. yesterday" or "this month").
5. Monthly trend data SHALL be rendered as a line chart using a lightweight chart library (e.g., Recharts, which is already present in the Next.js ecosystem) — no new heavy charting dependencies unless Recharts is not already installed.
6. The dashboard SHALL show a loading skeleton state (shimmer placeholders) while stats are being fetched.
7. If the `GET /api/v1/dashboard/stats` request fails, the dashboard SHALL display a non-blocking error banner ("Unable to load statistics. Retrying…") without crashing the page.
8. A "Refresh" button SHALL be present on the dashboard to trigger a manual `?refresh=true` fetch.
9. The RTK Query slice for dashboard (`store/api/dashboard.api.ts`) SHALL be created as a new file; the existing `store/api/` files SHALL NOT be modified.

---

### FR-E01.4: Role-Based Analytics Visibility

| Statistic | Admin | Manager | Doctor | Nurse | Receptionist | Staff |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Total Patients | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Today's OPD Appointments | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Active IPD Admissions | ✓ | ✓ | ✓ | ✓ | | |
| Pending Lab Reports | ✓ | ✓ | ✓ | | | |
| Revenue Summary (today + month) | ✓ | ✓ | | | | |
| Low Stock Alerts | ✓ | ✓ | | | | |
| Total Active Staff | ✓ | ✓ | | | | |
| Monthly OPD Trend (chart) | ✓ | ✓ | ✓ | | | |
| Monthly Revenue Trend (chart) | ✓ | ✓ | | | | |

1. The backend SHALL only return fields permitted for the requesting role — omitting non-permitted fields entirely (not returning null/zero placeholders for restricted fields).
2. The frontend dashboard widget layer SHALL conditionally render widgets based on the role stored in the Redux auth slice; widget components not permitted for the current role SHALL NOT be rendered.

---

### FR-E01.5: Validation, Error Handling, and Edge Cases

1. If no data exists for a statistic (e.g., no payments recorded), the API SHALL return `0` for count/sum fields and an empty array for trend arrays — never `null`.
2. The analytics endpoint SHALL enforce a maximum cache bypass rate of 10 requests per minute per tenant (to prevent cache-busting abuse) using the existing rate-limiting middleware.
3. If the MongoDB aggregation exceeds 10 seconds, the Analytics_Service SHALL return an HTTP 504 with a descriptive message rather than hanging.
4. Audit logging is NOT required for read-only analytics queries.

---

## FR-E02: Header Action Items

**Source**: QA Gap — Header/Navbar Incomplete  
**Affected Components (existing)**: FC-02 (Layout Shell)  
**New Sub-components**: Global Search overlay, User Profile dropdown

---

### FR-E02.1: Global Search

1. The header SHALL include a global search input (keyboard shortcut: `Ctrl+K` / `Cmd+K`) that opens a full-width search overlay/modal.
2. The Search_Service SHALL expose a new endpoint `GET /api/v1/search?q=<term>&type=<entity>` that searches across the following entity types within the authenticated tenant:
   - `patients` — by patient name, patient ID, mobile number
   - `doctors` — by full name (users with role `Doctor`)
   - `staff` — by full name (users with roles other than Doctor)
   - `appointments` — OPD visits by patient name or visit ID
   - `reports` — lab requests (pathology/radiology) by patient name or request ID
3. The `q` parameter SHALL be required with a minimum length of 2 characters and maximum of 100 characters. If `q` is shorter than 2 characters, the API SHALL return HTTP 400 with a descriptive error.
4. The `type` parameter SHALL be optional; if omitted, all five entity types are searched simultaneously (parallel queries).
5. Each entity result SHALL include only the fields needed for display: entity type, entity ID, display name/title, and a subtitle (e.g., patient mobile number, visit date).
6. Search results SHALL be limited to a maximum of 5 results per entity type (25 total) to keep responses fast.
7. The search endpoint SHALL use case-insensitive regex matching against indexed fields. New compound text indexes MAY be added to existing collections (e.g., `{ tenantId: 1, name: "text" }`) without altering existing indexes.
8. The search endpoint SHALL be rate-limited to 30 requests per minute per user using the existing rate-limiting middleware.
9. The search module SHALL be implemented as `src/modules/search/search.service.ts` and `src/modules/search/search.routes.ts` — registered in `app.ts` without modifying other modules.
10. The frontend search overlay SHALL:
    - Debounce keystrokes with a 300ms delay before triggering the API call.
    - Show a spinner while results are loading.
    - Group results by entity type with a section heading.
    - Navigate to the relevant detail page when a result is clicked (e.g., clicking a patient result navigates to `/patients/<id>`).
    - Close on Escape key or clicking outside the overlay.
    - Show an "No results found" empty state when the query returns zero results.
11. The RTK Query slice for search SHALL be added as `store/api/search.api.ts`; existing API slices SHALL NOT be modified.

---

### FR-E02.2: User Profile Dropdown

1. The header SHALL display the logged-in user's avatar (initials-based fallback if no profile image) and full name. Clicking it SHALL open a dropdown menu.
2. The dropdown SHALL contain the following items:
   - **My Profile** — navigates to `/profile` (new page, see FR-E03)
   - **Change Password** — navigates to `/profile/change-password`
   - **Logout** — triggers logout action (calls existing `POST /api/v1/auth/logout`, clears Redux auth state, redirects to `/login`)
3. The dropdown SHALL be dismissible by pressing Escape or clicking outside.
4. The profile dropdown SHALL reuse the existing logout logic from the auth slice — no new Redux actions are required for logout.
5. The user's role SHALL be displayed as a badge in the dropdown (e.g., "Manager", "Doctor").

---

### FR-E02.3: Notification Placeholder Support

1. The existing notification bell icon (FC-11) SHALL be repositioned into the header action bar (right side) if it is currently in the sidebar. No functional changes to FC-11 are required.
2. If the notification panel component (FC-11) is already in the header, this requirement is satisfied with no changes needed.

---

### FR-E02.4: Mobile Responsive Header

1. On screens narrower than 768px, the sidebar navigation SHALL collapse to a hamburger menu toggle.
2. The global search, notification bell, and profile dropdown SHALL remain accessible on mobile — either inline in the header or in a collapsible top bar.
3. The hamburger menu SHALL open a slide-in drawer (using the existing shadcn/ui Sheet component if available) containing the full navigation items.

---

### FR-E02.5: Validation, Error Handling, and Edge Cases

1. If the search API returns an error, the search overlay SHALL display "Search unavailable. Please try again." without crashing.
2. Search queries containing only whitespace SHALL be treated as empty and SHALL NOT trigger an API call.
3. The profile dropdown avatar SHALL gracefully handle missing user name data by showing a generic icon.

---

## FR-E03: Staff Profile Update

**Source**: QA Gap — Staff Profile Cannot Be Updated  
**Affected Roles**: Admin, Manager, Staff (and all other non-Super-Admin, non-Hospital-Admin roles)  
**Affected Components (existing)**: BC-03 (User Module), FC-04 (Hospital Admin Panel)  
**New Components**: FC-14 (Profile Page)

---

### FR-E03.1: Backend — Profile Update API

1. The User_Service SHALL expose a new endpoint `PATCH /api/v1/users/me/profile` that allows the authenticated user to update their own profile fields.
2. Editable fields by role:
   - **All roles (self-editable)**: `firstName`, `lastName`, `phone`, `profileImageUrl`
   - **Admin only (self-editable)**: all of the above fields
   - **Manager only (self-editable)**: all of the above fields
   - Fields such as `role`, `tenantId`, `email`, and `status` SHALL NOT be editable via this endpoint.
3. The endpoint SHALL validate all input using an extended Zod schema; invalid fields SHALL return HTTP 400 with per-field error details.
4. On successful update, the User_Service SHALL write an audit log entry with entity type `USER`, action `UPDATE`, previous values of changed fields, new values, actor user ID, tenant ID, and timestamp — reusing the existing `AuditService.log()` method.

---

### FR-E03.2: Backend — Change Password API (Self-Service)

1. The Auth_Service SHALL expose a new endpoint `PATCH /api/v1/users/me/password` (distinct from the existing first-login `POST /api/v1/auth/change-password`) that allows an authenticated user to change their own password at any time.
2. The request body SHALL require `currentPassword` (plain text, for verification) and `newPassword` (minimum 8 characters, at least one uppercase letter, one digit, and one special character).
3. The Auth_Service SHALL verify `currentPassword` against the stored bcrypt hash before applying the change. If verification fails, the endpoint SHALL return HTTP 401 with the message "Current password is incorrect."
4. The new password SHALL be hashed with bcrypt (cost ≥ 12) before storage, consistent with FR-05.9.
5. On successful password change, the Auth_Service SHALL invalidate the user's current JWT by adding it to the token denylist and respond with HTTP 200 and a message instructing the frontend to re-authenticate.
6. An audit log entry SHALL be written on password change (entity type `USER`, action `UPDATE`, actor user ID, no before/after password values — only a flag `{ field: "password", changed: true }`).

---

### FR-E03.3: Backend — Profile Image Upload

1. The User_Service SHALL expose a new endpoint `POST /api/v1/users/me/profile-image` that accepts a multipart/form-data upload of a profile image.
2. Accepted file types: JPEG, PNG, WebP. Maximum file size: 2 MB. If the file type or size is invalid, the endpoint SHALL return HTTP 400 with a descriptive error.
3. The image SHALL be uploaded to AWS S3 under a path `profile-images/<tenantId>/<userId>.<ext>` using the existing S3 Service (SI-02). No new S3 service methods are required — the existing `uploadFile()` method SHALL be reused.
4. The S3 URL SHALL be stored as `profileImageUrl` on the user document. The old image (if any) SHALL be deleted from S3 to avoid orphaned files.
5. An audit log entry SHALL be written on profile image change.

---

### FR-E03.4: Backend — Get Own Profile API

1. The User_Service SHALL expose a new endpoint `GET /api/v1/users/me` that returns the authenticated user's full profile (excluding password hash).
2. This endpoint SHALL reuse the existing user repository — no new database queries are needed beyond `findById` scoped to `tenantId`.

---

### FR-E03.5: Frontend — Profile Page (FC-14)

1. A new page SHALL be created at `app/(dashboard)/profile/page.tsx` with:
   - A profile image upload section (with preview and "Change Photo" button).
   - An editable form for `firstName`, `lastName`, and `phone`.
   - A "Save Changes" button that calls `PATCH /api/v1/users/me/profile`.
   - A separate "Change Password" section (or sub-page at `/profile/change-password`) with fields for current password, new password, and confirm new password.
2. The profile page SHALL call `GET /api/v1/users/me` on mount to pre-populate fields.
3. All form fields SHALL have inline validation (required fields, phone format, password strength indicator).
4. On successful profile save, a toast notification SHALL be shown ("Profile updated successfully").
5. On successful password change, the user SHALL be logged out automatically (token invalidated server-side) and redirected to `/login` with a toast: "Password changed. Please log in again."
6. Profile image preview SHALL show the current image (via pre-signed S3 URL) or initials-based avatar if no image is set.

---

### FR-E03.6: RBAC and Security

1. The `PATCH /api/v1/users/me/profile`, `PATCH /api/v1/users/me/password`, and `POST /api/v1/users/me/profile-image` endpoints SHALL be accessible to ALL authenticated roles (Admin, Manager, Doctor, Nurse, Receptionist, Pathologist, Radiologist, Finance_Manager, HR, Staff) — a user can always update their own profile.
2. The `GET /api/v1/users/me` endpoint SHALL similarly be accessible to all authenticated roles.
3. A user SHALL NOT be able to update another user's profile via these endpoints. The user ID is always derived from the authenticated JWT — no `userId` path parameter is accepted.
4. Hospital_Admin profile updates SHALL continue to use existing admin management routes; the `/me` endpoints are for non-admin self-service only (Admin and Manager roles are also permitted as a convenience).

---

### FR-E03.7: Non-Breaking Migration

1. The `profileImageUrl` field SHALL be added as an optional field to the existing User Mongoose schema with a default of `null`. No data migration is required for existing user records.
2. The existing `GET /api/v1/users` and `PATCH /api/v1/users/:id` (admin management) endpoints are NOT modified.

---

## FR-E04: Users List Improvements

**Source**: QA Gap — Users Listing Lacks Management Capabilities  
**Affected Roles**: Hospital_Admin, HR, Manager (read)  
**Affected Components (existing)**: BC-03 (User Module), FC-04 (Hospital Admin Panel)

---

### FR-E04.1: Backend — Paginated and Filtered User List API

1. The existing `GET /api/v1/users` endpoint SHALL be enhanced to support the following query parameters without breaking the current response contract:
   - `page` (integer, default: 1)
   - `limit` (integer, default: 20, max: 100)
   - `search` (string, min 1 char) — case-insensitive match against `firstName`, `lastName`, `email`
   - `role` (enum of valid UserRole values) — filter by single role
   - `status` (enum: `ACTIVE`, `INACTIVE`) — filter by account status
   - `sortBy` (enum: `firstName`, `lastName`, `createdAt`, `role`) — default: `createdAt`
   - `sortOrder` (enum: `asc`, `desc`) — default: `desc`
2. The response envelope SHALL follow the existing pagination format: `{ status: "success", data: { users: User[], total: number, page: number, limit: number } }`.
3. If no filters are supplied, the endpoint SHALL behave identically to the current implementation (backward compatible).
4. The search filter SHALL use case-insensitive regex on `firstName`, `lastName`, and `email` fields. An existing compound index `{ tenantId: 1, role: 1, status: 1 }` MAY be added if not already present; existing indexes SHALL NOT be dropped.

---

### FR-E04.2: Backend — Soft Delete / Deactivate User

1. The existing `PATCH /api/v1/users/:id/deactivate` endpoint (FR-04.5) already supports deactivation. This requirement documents the UI-side requirement: no new backend endpoint is needed for soft-delete; deactivation IS the soft-delete mechanism.
2. If a hard-delete endpoint is required in a future phase, it will be documented separately. For this enhancement, "delete" in the UI SHALL trigger the existing deactivation endpoint.
3. The User_Service SHALL record an audit log entry on deactivation, confirming the existing behavior and ensuring it is applied consistently.

---

### FR-E04.3: Frontend — Enhanced Users Table (FC-04 enhancement)

1. The existing users table in the Hospital Admin Panel (FC-04) SHALL be enhanced in-place (no new page); the following capabilities SHALL be added without altering the table's visual identity:
   - **Search bar** above the table with debounced input (300ms) calling the enhanced `GET /api/v1/users` endpoint.
   - **Role filter** dropdown (All Roles | Doctor | Nurse | Receptionist | …).
   - **Status filter** dropdown (All | Active | Inactive).
   - **Sort controls** on column headers for `Name`, `Role`, and `Created At`.
   - **Pagination** controls (Previous / Next / page number display) below the table.
   - **Total count** label (e.g., "Showing 1–20 of 47 users").
2. Each table row SHALL include a **Deactivate** (or **Delete**) action button, visible only to `Hospital_Admin` and `HR` roles. Clicking it SHALL open a confirmation modal ("Are you sure you want to deactivate this user? This action will revoke their access.") before calling the deactivation endpoint.
3. The table SHALL display a **loading skeleton** state (shimmer rows) while data is being fetched.
4. The table SHALL display an **empty state** component ("No users found matching your filters.") when the result set is empty.
5. The RTK Query user API slice (`store/api/user.api.ts`) SHALL be enhanced with new query parameters; existing query definitions SHALL remain and not be removed.

---

### FR-E04.4: Validation, Edge Cases

1. If `search` query contains special regex characters, the User_Service SHALL escape them before constructing the regex.
2. If `limit` exceeds 100, the User_Service SHALL clamp it to 100 and return a warning in the response metadata.
3. The last-active-admin guard (FR-04.8) SHALL remain enforced — attempting to deactivate the last active admin SHALL still return HTTP 400 with a descriptive error, and the frontend SHALL display this error in the confirmation modal.

---

## FR-E05: Patients Module Missing Features

**Source**: QA Gap — Patients Module Lacks Management Capabilities  
**Affected Components (existing)**: BC-04 (Patient Module), FC-05 (Patient Management)

---

### FR-E05.1: Backend — Delete / Soft-Delete Patient

1. The Patient_Service SHALL expose a new endpoint `DELETE /api/v1/patients/:patientId` that soft-deletes a patient record by setting a `deletedAt` timestamp and `isDeleted: true` flag on the patient document.
2. Allowed roles for deletion: `Admin`, `Manager`. `Receptionist` SHALL NOT have delete permission.
3. A patient with active IPD admissions (status `ADMITTED`) SHALL NOT be deletable. If attempted, the Patient_Service SHALL return HTTP 409 with the message "Patient has an active IPD admission. Discharge the patient before deletion."
4. A patient with any recorded payments SHALL NOT be hard-deleted. The soft-delete strategy ensures financial records remain intact.
5. All existing queries (`GET /api/v1/patients`, `GET /api/v1/patients/:id`, patient search) SHALL include `{ isDeleted: { $ne: true } }` as a mandatory filter — soft-deleted patients SHALL NOT appear in any listing or search result.
6. An audit log entry SHALL be written on soft-delete (entity type `PATIENT`, action `DELETE`, actor user ID, timestamp).
7. The `isDeleted` and `deletedAt` fields SHALL be added as optional fields to the existing Patient Mongoose schema with defaults of `false` and `null` respectively. No data migration is required for existing records.

---

### FR-E05.2: Backend — OPD History Filters and Pagination Enhancement

1. The existing OPD visit history endpoint (`GET /api/v1/patients/:patientId/opd-history`) SHALL be enhanced to support:
   - `page` (integer, default: 1)
   - `limit` (integer, default: 10, max: 50)
   - `startDate` (ISO date string) — filter visits on or after this date
   - `endDate` (ISO date string) — filter visits on or before this date
   - `status` (enum: `OPEN`, `COMPLETED`) — filter by visit status
   - `search` (string) — case-insensitive search within `chiefComplaint`, `diagnosis`
2. The response SHALL follow the standard pagination envelope: `{ data: { visits: OpdVisit[], total, page, limit } }`.
3. Existing behavior (no query params → return all recent visits paginated at 10 per page) SHALL be preserved as the default.
4. A compound index `{ tenantId: 1, patientId: 1, visitDate: -1 }` SHALL be ensured on the `opd_visits` collection to support date-range queries efficiently.

---

### FR-E05.3: Frontend — Delete Patient Action (FC-05 enhancement)

1. The patient detail page/card SHALL include a **Delete Patient** button visible only to `Admin` and `Manager` roles.
2. Clicking **Delete Patient** SHALL open a confirmation modal with: "Are you sure you want to delete this patient? This action cannot be undone. All clinical history will be archived."
3. On confirmation, the frontend SHALL call `DELETE /api/v1/patients/:patientId`. On success, the patient SHALL be removed from the listing and a toast SHALL display: "Patient record deleted."
4. If the API returns HTTP 409 (active IPD admission), the modal SHALL display the server error message instead of proceeding.

---

### FR-E05.4: Frontend — OPD History Filters (FC-05 enhancement)

1. The OPD History tab on the patient detail panel SHALL be enhanced with:
   - **Date range filter** (From / To date pickers).
   - **Status filter** (All | Open | Completed).
   - **Search bar** for chief complaint or diagnosis (debounced 300ms).
   - **Pagination** controls (Previous / Next, page info).
2. Filter state SHALL be managed as local component state — no Redux changes required.
3. A loading skeleton SHALL be shown while OPD history is loading.
4. An empty state ("No visits found for the selected filters.") SHALL be displayed when the result set is empty.

---

### FR-E05.5: Edge Cases and Data Integrity

1. Soft-deleted patients SHALL remain in audit logs and payment records for data integrity.
2. If an OPD history date range has `startDate` after `endDate`, the API SHALL return HTTP 400 with a descriptive error.
3. Patient `search` on the main listing SHALL already exclude soft-deleted records (handled by the mandatory `isDeleted` filter in FR-E05.1.5).

---

## FR-E06: Pathology and Radiology Record Management

**Source**: QA Gap — Pathology and Radiology Modules Lack Edit/Delete Actions  
**Affected Roles**: Pathologist, Radiologist, Manager, Admin  
**Affected Components (existing)**: BC-07 (Lab Module), FC-08 (Lab Module UI)

---

### FR-E06.1: Backend — Edit Lab Request

1. The Lab_Service SHALL expose a new endpoint `PATCH /api/v1/lab/pathology/:requestId` for updating a pathology request.
2. The Lab_Service SHALL expose a new endpoint `PATCH /api/v1/lab/radiology/:requestId` for updating a radiology request.
3. Editable fields for `PENDING` requests:
   - `testNames` / `imagingType` — the test or imaging type can be corrected.
   - `notes` — free-text notes can be added or updated.
   - `priority` (enum: `ROUTINE`, `URGENT`) — if this field exists on the model; otherwise add as optional.
4. Once a request status is `COMPLETED` (report uploaded), the request SHALL NOT be editable via this endpoint. Attempting to edit a `COMPLETED` request SHALL return HTTP 409: "Report has been submitted. This request cannot be edited."
5. Allowed roles for edit:
   - Pathology edit: `Pathologist`, `Manager`, `Admin`
   - Radiology edit: `Radiologist`, `Manager`, `Admin`
6. An audit log entry SHALL be written on every edit (entity type `LAB_REQUEST`, action `UPDATE`, previous and new values).

---

### FR-E06.2: Backend — Delete Lab Request

1. The Lab_Service SHALL expose a new endpoint `DELETE /api/v1/lab/pathology/:requestId` for soft-deleting a pathology request.
2. The Lab_Service SHALL expose a new endpoint `DELETE /api/v1/lab/radiology/:requestId` for soft-deleting a radiology request.
3. Soft-delete SHALL set `isDeleted: true` and `deletedAt: <timestamp>` on the request document. Hard deletion of report files from S3 is NOT performed — file links are preserved in audit logs.
4. A request with status `COMPLETED` SHALL be deletable only by `Admin` and `Manager` roles. A `PENDING` request SHALL be deletable by `Pathologist` / `Radiologist`, `Manager`, and `Admin`.
5. If a `COMPLETED` request is deleted, a notification SHALL NOT be re-sent; no side effects beyond audit logging.
6. All existing lab request listing and pending queue endpoints SHALL include `{ isDeleted: { $ne: true } }` filter.
7. An audit log entry SHALL be written on soft-delete.

---

### FR-E06.3: Backend — Status Update Handling

1. The existing report upload endpoint (which transitions status to `COMPLETED`) SHALL remain unchanged.
2. If a request is soft-deleted while a Pathologist/Radiologist has its detail page open, the next API call on that request SHALL return HTTP 404 ("Lab request not found or has been deleted"). The frontend SHALL handle this 404 gracefully by redirecting back to the pending queue.

---

### FR-E06.4: Frontend — Edit and Delete Actions (FC-08 enhancement)

1. The pending lab request list SHALL include an **Edit** (pencil icon) action for each row, visible to permitted roles.
2. Clicking **Edit** SHALL open an inline form or modal with editable fields pre-populated from the current record.
3. Each row SHALL include a **Delete** (trash icon) action, visible to permitted roles.
4. Clicking **Delete** SHALL open a confirmation modal: "Are you sure you want to delete this lab request? This cannot be undone."
5. On successful delete, the row SHALL be removed from the list and a toast SHALL display: "Lab request deleted."
6. On successful edit save, the row SHALL update in-place and a toast SHALL display: "Lab request updated."
7. For `COMPLETED` requests (visible in the patient lab history), the Edit button SHALL be hidden; Delete SHALL be available only to `Admin` and `Manager`.

---

### FR-E06.5: Validation and Edge Cases

1. If `testNames` is updated to an empty array, the Lab_Service SHALL return HTTP 400: "At least one test name is required."
2. Regex/injection validation via Zod SHALL apply to all string fields in the PATCH body.
3. The `isDeleted` and `deletedAt` fields SHALL be added as optional fields to the existing lab request Mongoose schemas (no migration required for existing records).

---

## FR-E07: Inventory Module Edit and Delete

**Source**: QA Gap — Inventory Module Lacks Edit/Delete Functionality  
**Affected Roles**: Manager, Admin  
**Affected Components (existing)**: BC-08 (Inventory Module), FC-09 (Inventory Module UI)

---

### FR-E07.1: Backend — Edit Inventory Item

1. The Inventory_Service SHALL expose a new endpoint `PATCH /api/v1/inventory/:itemId` for updating an inventory item's metadata.
2. Editable fields: `itemName`, `category` (Equipment | Consumable), `unitOfMeasure`, `minimumThreshold`.
3. `currentStock` SHALL NOT be editable via this endpoint — stock quantity changes go through the existing stock-update endpoint (`PATCH /api/v1/inventory/:itemId/stock`).
4. Allowed roles: `Manager`, `Admin`.
5. If `minimumThreshold` is updated and the new threshold is higher than `currentStock`, the Inventory_Service SHALL immediately check the low-stock condition and generate a low-stock notification (via the existing NotificationService) if not already triggered.
6. An audit log entry SHALL be written on every edit (entity type `INVENTORY_ITEM`, action `UPDATE`, previous and new values of changed fields).
7. Validation: `itemName` max 200 characters; `minimumThreshold` must be ≥ 0.

---

### FR-E07.2: Backend — Delete Inventory Item

1. The Inventory_Service SHALL expose a new endpoint `DELETE /api/v1/inventory/:itemId` for soft-deleting an inventory item.
2. Soft-delete SHALL set `isDeleted: true` and `deletedAt: <timestamp>` on the inventory document.
3. **Dependency validation**: if any lab requests or IPD records reference this inventory item (e.g., consumables used in procedures — if such linkage exists in the data model), the Inventory_Service SHALL prevent deletion and return HTTP 409: "Inventory item is referenced by existing records and cannot be deleted." If no such foreign-key linkage exists in the current model, this check is skipped.
4. Allowed roles: `Manager`, `Admin`.
5. All existing inventory list and filter endpoints SHALL include `{ isDeleted: { $ne: true } }` filter.
6. An audit log entry SHALL be written on soft-delete (entity type `INVENTORY_ITEM`, action `DELETE`).

---

### FR-E07.3: Backend — Stock Adjustment Tracking Enhancement

1. The existing stock-update audit log (FR-11.2) already records stock changes. This requirement ensures the frontend surfaces this history.
2. The Inventory_Service SHALL expose a new endpoint `GET /api/v1/inventory/:itemId/stock-history` that returns the audit log entries for stock changes on that item, paginated at 20 per page.
3. This endpoint SHALL query the existing `audit_logs` collection filtered by `entityType: "INVENTORY_ITEM"`, `entityId: <itemId>`, `action: "UPDATE"` — reusing the existing `AuditRepository` without modification.
4. Allowed roles: `Manager`, `Admin`.

---

### FR-E07.4: Frontend — Edit and Delete Actions (FC-09 enhancement)

1. Each row in the inventory list SHALL include an **Edit** (pencil icon) and a **Delete** (trash icon) action button, visible only to `Manager` and `Admin` roles.
2. Clicking **Edit** SHALL open an edit form modal pre-populated with the current item's metadata fields (per FR-E07.1).
3. Clicking **Delete** SHALL open a confirmation modal: "Are you sure you want to delete this inventory item? Stock history will be preserved in audit logs."
4. On successful edit, the row SHALL update in-place; on successful delete, the row SHALL be removed. Both actions SHALL show toast notifications.
5. A **Stock History** drawer/panel accessible from each row SHALL display paginated stock adjustment entries from the `GET /api/v1/inventory/:itemId/stock-history` endpoint.
6. The existing item-add form and stock-update form SHALL NOT be modified.

---

### FR-E07.5: Transaction Safety and Data Integrity

1. The inventory item soft-delete operation SHALL be wrapped in a Mongoose session transaction if the dependency check (FR-E07.2.3) queries other collections — ensuring the read-then-write is atomic.
2. If the audit log write for a stock adjustment fails, the primary stock update SHALL NOT be rolled back (per FR-14.5); the failure SHALL be logged to the application error log.
3. The `isDeleted` and `deletedAt` fields SHALL be added as optional fields to the existing Inventory Mongoose schema (no migration required).

---

## FR-E08: Login Page UI Simplification

**Source**: QA Gap — Login UI Complexity  
**Affected Components (existing)**: FC-01 (Auth Shell — Login page)  
**Scope**: Frontend only — no backend changes required

---

### FR-E08.1: Login Form Design

1. The login page (`app/(auth)/login/page.tsx`) SHALL present a clean, minimal form containing exactly two input fields:
   - **Email** — type `email`, placeholder "Enter your email", auto-focused on page load.
   - **Password** — type `password`, placeholder "Enter your password", with a show/hide password toggle icon.
2. The form SHALL have a single primary action button labelled **"Sign In"** that spans the full width of the form.
3. No additional input fields (e.g., tenant ID, hospital code, username) SHALL appear on the login form. Tenant resolution SHALL continue to be handled server-side via the email domain or JWT payload — not via a separate UI field.
4. The form SHALL include a **"Forgot Password?"** link below the password field that navigates to the existing forgot-password page (`/forgot-password`). This link is already part of the auth flow and SHALL be preserved.
5. The hospital/platform logo (or a generic HMS branding mark) SHALL be displayed above the form. If tenant branding is not yet resolved at the login stage (pre-authentication), a default platform logo SHALL be shown.
6. No registration, sign-up, or social login options SHALL appear on this page — the HMS is an invite-only system.

---

### FR-E08.2: Validation and UX Behavior

1. Both fields SHALL display inline validation errors below the field on blur (not on submit only):
   - Email: "Please enter a valid email address." if format is invalid.
   - Password: "Password is required." if empty on submit.
2. The **Sign In** button SHALL be disabled and show a loading spinner while the login API call is in flight, to prevent double-submission.
3. If the API returns HTTP 401, the form SHALL display a non-field error banner above the submit button: "Invalid email or password." — without revealing which field is incorrect (per FR-05.2).
4. If the API returns HTTP 403 (account locked), the form SHALL display: "Your account has been locked. Please check your email or contact your administrator."
5. On successful login, the form SHALL redirect to the role-appropriate dashboard using the existing post-login redirect logic — no change to the redirect behavior.
6. The form SHALL prevent default browser autocomplete from interfering with the show/hide password toggle.

---

### FR-E08.3: Responsive and Accessibility Requirements

1. The login page SHALL be centered on screen (vertically and horizontally) on all viewport sizes (mobile ≥ 320px, tablet, desktop).
2. The form card SHALL have a maximum width of 400px on desktop and be full-width (with horizontal padding) on mobile.
3. All form elements SHALL have explicit `<label>` associations (or `aria-label`) for screen reader compatibility.
4. The form SHALL be fully keyboard-navigable: Tab moves focus between fields and the Sign In button; Enter within any field submits the form.
5. Error messages SHALL be announced to screen readers via `aria-live="polite"` regions.

---

### FR-E08.4: Non-Breaking Implementation Notes

1. The existing login form component SHALL be refactored in-place — no new page file is needed. Only the form UI is simplified; the underlying `POST /api/v1/auth/login` API call, Redux auth slice, and JWT handling are unchanged.
2. Any existing third-party login fields or extra inputs (if present) SHALL be removed. The existing Zod client-side schema for the login form SHALL be simplified to `{ email: z.string().email(), password: z.string().min(1) }`.
3. Existing unit tests for the login component SHALL be updated to reflect the simplified field set; the core auth logic tests are unaffected.

---

## FR-E09: Super Admin — Platform Settings (Logo, Favicon, Title)

**Source**: QA Gap — Super Admin Cannot Configure Platform-Level Branding  
**Affected Roles**: Super_Admin only  
**Affected Components (existing)**: BC-02 (Tenant Module), FC-03 (Super Admin Console)  
**Scope**: Platform-level settings distinct from per-tenant hospital branding (FR-03). These settings apply to the HMS platform itself — the login page, browser tab, and super-admin console — not to individual hospital tenants.

---

### FR-E09.1: Backend — Platform Settings Storage

1. The System SHALL maintain a single `platform_settings` document in a dedicated MongoDB collection (no `tenantId` — this is platform-level, similar to the `super_admins` collection).
2. The `platform_settings` document SHALL store the following fields:
   - `logoUrl` — S3 URL of the platform logo image (displayed on the login page and Super Admin console header).
   - `faviconUrl` — S3 URL of the platform favicon file.
   - `platformTitle` — string, the browser tab title and platform display name (e.g., "HMS Portal").
   - `updatedAt` — UTC timestamp of the last settings update.
   - `updatedBy` — Super Admin identifier who last made the change.
3. If no `platform_settings` document exists (fresh installation), the System SHALL return sensible defaults: `logoUrl: null`, `faviconUrl: null`, `platformTitle: "Hospital Management System"`.

---

### FR-E09.2: Backend — Platform Settings API

1. The Tenant_Service (BC-02) SHALL expose the following new endpoints under the Super Admin scope:

   | Method | Path | Description |
   |---|---|---|
   | GET | `/api/v1/super-admin/platform-settings` | Retrieve current platform settings (logo URL, favicon URL, title) |
   | PATCH | `/api/v1/super-admin/platform-settings` | Update `platformTitle`; returns updated settings |
   | POST | `/api/v1/super-admin/platform-settings/logo` | Upload platform logo image to S3; update `logoUrl` |
   | POST | `/api/v1/super-admin/platform-settings/favicon` | Upload platform favicon to S3; update `faviconUrl` |

2. All four endpoints SHALL be protected by Super Admin authentication. The existing `authenticateSuperAdmin` middleware (or equivalent JWT check used for the Super Admin console) SHALL be applied. No `tenantId` scoping is applied — these are global settings.
3. The `GET` endpoint SHALL also be accessible without authentication (public) so the frontend can load the platform logo and title on the login page before the user logs in.
4. `PATCH /platform-settings` body fields: `platformTitle` (string, min 1 character, max 100 characters). Only the title is updated via PATCH; files use dedicated POST endpoints.

---

### FR-E09.3: Backend — File Upload Constraints

1. **Logo upload** (`POST /super-admin/platform-settings/logo`):
   - Accepted file types: JPEG, PNG, SVG, WebP.
   - Maximum file size: 2 MB.
   - S3 storage path: `platform/logo.<ext>` (overwrites previous logo).
   - If the file type is invalid, return HTTP 400: "Only JPEG, PNG, SVG, and WebP files are accepted for the logo."
   - If the file size exceeds 2 MB, return HTTP 400: "Logo file must not exceed 2 MB."
   - On successful upload, the old logo file SHALL be deleted from S3 to prevent orphaned files.

2. **Favicon upload** (`POST /super-admin/platform-settings/favicon`):
   - Accepted file types: ICO, PNG (browsers accept both as favicons).
   - Maximum file size: 500 KB.
   - S3 storage path: `platform/favicon.<ext>` (overwrites previous favicon).
   - If the file type is invalid, return HTTP 400: "Only ICO and PNG files are accepted for the favicon."
   - If the file size exceeds 500 KB, return HTTP 400: "Favicon file must not exceed 500 KB."
   - On successful upload, the old favicon file SHALL be deleted from S3.

3. Both upload endpoints SHALL validate MIME type against magic bytes (not just the declared `Content-Type` header) before uploading to S3, consistent with NFR-E02.
4. Uploaded files SHALL be served via pre-signed S3 URLs with a 24-hour expiry, consistent with NFR-09.

---

### FR-E09.4: Backend — Audit Logging

1. Every call to `PATCH /platform-settings`, `POST /platform-settings/logo`, and `POST /platform-settings/favicon` SHALL write an audit log entry to the existing `audit_logs` collection with:
   - `entityType`: `"PLATFORM_SETTINGS"`
   - `action`: `UPDATE`
   - `previousValue`: snapshot of the previous field(s) being changed
   - `newValue`: the new value(s)
   - `actorId`: Super Admin identifier
   - `tenantId`: `null` (platform-level entry)
   - `timestamp`: UTC
2. `PLATFORM_SETTINGS` SHALL be added to the `AuditEntityType` enum.

---

### FR-E09.5: Frontend — Platform Settings Page (FC-03 enhancement)

1. The Super Admin Console (FC-03) SHALL include a new **"Platform Settings"** section/page, accessible via the Super Admin sidebar at the route `/super-admin/platform-settings`.
2. The page SHALL contain three distinct sections:
   - **Platform Logo** — current logo preview (or placeholder if none), a "Upload Logo" button that opens a file picker restricted to JPEG/PNG/SVG/WebP. Preview updates immediately on file selection (client-side preview before upload). "Save Logo" button triggers the upload API call.
   - **Favicon** — current favicon preview (16×16 rendered), a "Upload Favicon" button restricted to ICO/PNG. Same client-side preview + "Save Favicon" button pattern.
   - **Platform Title** — an editable text input pre-filled with the current `platformTitle`. A "Save Title" button calls `PATCH /platform-settings`. Character counter shown (max 100).
3. Each section SHALL operate independently — saving the logo does not affect the favicon or title, and vice versa.
4. On successful save of any setting, a toast notification SHALL display (e.g., "Platform logo updated successfully.").
5. On error (file too large, wrong type), the specific error message from the API SHALL be shown inline below the upload control.

---

### FR-E09.6: Frontend — Login Page Platform Branding Integration

1. The login page (`app/(auth)/login/page.tsx`) SHALL fetch platform settings on mount via `GET /api/v1/super-admin/platform-settings` (public endpoint — no auth required).
2. If `logoUrl` is present, it SHALL be displayed above the login form (replacing the static logo or placeholder described in FR-E08.1.5).
3. If `platformTitle` is present, it SHALL be set as the HTML `<title>` of the login page using Next.js `metadata` or `useEffect` with `document.title`.
4. If `faviconUrl` is present, it SHALL be injected as the `<link rel="icon">` tag for the login page.
5. If the platform settings fetch fails (network error or service unavailable), the login page SHALL fall back to the static default logo and title — the login form itself SHALL NOT be blocked.

---

### FR-E09.7: Frontend — Global Favicon and Title Application

1. The platform `favicon` and `platformTitle` SHALL also be applied globally to the authenticated dashboard layout (`app/(dashboard)/layout.tsx`) so that the browser tab always reflects the platform branding after login.
2. The RTK Query slice for platform settings (`store/api/platformSettings.api.ts`) SHALL be created as a new file. It SHALL expose a `getPlatformSettings` query used by both the login page and the dashboard layout.

---

### FR-E09.8: Validation and Edge Cases

1. If a Super Admin uploads the same file twice in succession, the System SHALL overwrite the previous file at the same S3 path without error.
2. If no logo or favicon has been uploaded, the frontend SHALL display a neutral placeholder (e.g., a grey image icon) rather than a broken image tag.
3. The `platformTitle` SHALL be sanitized (HTML-escaped) before being stored to prevent XSS when it is injected into `document.title` or `<meta>` tags.
4. The platform settings `GET` endpoint SHALL be exempt from authentication but SHALL still apply rate limiting (30 requests per minute per IP) to prevent abuse.
5. Pre-signed S3 URLs for logo and favicon SHALL have a 24-hour expiry; the frontend SHALL re-fetch settings if the URL has expired (detected via HTTP 403 response on the S3 URL).

---

### FR-E09.9: Non-Breaking Migration Strategy

1. The `platform_settings` collection does not exist in the current schema — creating it is purely additive and does not affect any existing collection or query.
2. Existing per-tenant branding (FR-03: hospital logo, display name, primary color stored on the `Tenant` document) is completely separate from platform settings and SHALL NOT be modified.
3. The new `/super-admin/platform-settings` routes are registered in `app.ts` as additional routes alongside existing super-admin routes — no existing route is modified.
4. `PLATFORM_SETTINGS` is added to `AuditEntityType` — this is an additive enum change.

---

## Enhancement Non-Functional Requirements

---

### NFR-E01: Performance (Enhancements)

- The `GET /api/v1/dashboard/stats` endpoint SHALL respond within 1 second at the 95th percentile (compensated by 60s cache).
- The `GET /api/v1/search` endpoint SHALL respond within 500ms at the 95th percentile for queries returning ≤ 25 results.
- All new paginated endpoints SHALL respond within 300ms at the 95th percentile for pages of ≤ 50 items.

---

### NFR-E02: Security (Enhancements)

- All new endpoints SHALL adhere to the same security baseline as existing endpoints (SECURITY-01 through SECURITY-15).
- Profile image uploads SHALL be scanned for MIME type mismatch (magic bytes vs. declared Content-Type) before S3 upload.
- The `PATCH /api/v1/users/me/password` endpoint SHALL be rate-limited to 5 requests per 15-minute window per user.
- Search queries SHALL sanitize user input against regex injection before constructing MongoDB queries.

---

### NFR-E03: Testing (Enhancements)

- Each new backend module/service (dashboard, search) SHALL have unit tests and at least one integration test per endpoint.
- Enhanced existing endpoints (user list pagination, OPD history filters) SHALL have new test cases added to the existing test files without removing any existing tests.
- Frontend components (StatCard, search overlay, profile page, login form) SHALL have unit tests using React Testing Library.
- PBT rules (NFR-07) apply to any new business logic functions (e.g., analytics aggregation helpers, search ranking).

---

### NFR-E04: Audit Trail (Enhancements)

- All new write operations (profile update, lab request edit/delete, inventory edit/delete, patient soft-delete) SHALL produce audit log entries using the existing `AuditService.log()` method — no new audit infrastructure is required.
- Audit log entries for enhancement features SHALL use existing `AuditEntityType` enum values where applicable; new entity types (`LAB_REQUEST`, `INVENTORY_ITEM`) SHALL be added to the enum if not already present.

---

### NFR-E05: Backward Compatibility

- All existing API routes SHALL continue to function unchanged after enhancements are applied.
- Existing RTK Query API slices SHALL NOT have existing query/mutation definitions removed or renamed.
- Existing Mongoose schemas SHALL only receive additive changes (new optional fields). No field renames, type changes, or deletions.
- Existing RBAC middleware configuration SHALL NOT be modified; new role permissions SHALL be added via new `requireRole()` calls on new routes only.
- Database indexes added for enhancements SHALL be additive and SHALL NOT replace or conflict with existing indexes.

---

## Enhancement Module Summary

| Enhancement ID | Module | New Backend Files | Existing Files Modified | New Frontend Files | Existing Frontend Files Modified |
|---|---|---|---|---|---|
| FR-E01 | Dashboard Analytics | `dashboard.service.ts`, `dashboard.routes.ts`, `dashboard.controller.ts` | `app.ts` (route registration) | `components/dashboard/`, `store/api/dashboard.api.ts`, `app/(dashboard)/page.tsx` | None |
| FR-E02 | Header Action Items | `search.service.ts`, `search.routes.ts`, `search.controller.ts` | `app.ts` (route registration) | `components/header/`, `store/api/search.api.ts` | `components/layout/` (header slot) |
| FR-E03 | Staff Profile Update | `users/me.controller.ts` (or new methods in `user.controller.ts`), `users/me.routes.ts` | `user.schema.ts` (add `profileImageUrl`), `app.ts` | `app/(dashboard)/profile/page.tsx`, `app/(dashboard)/profile/change-password/page.tsx` | `store/api/user.api.ts` (add `/me` queries) |
| FR-E04 | Users List Improvements | None | `user.service.ts` (filter/pagination), `user.controller.ts` | None | `store/api/user.api.ts` (add params), `app/(dashboard)/admin/users/` (table enhancements) |
| FR-E05 | Patients Module | None | `patient.service.ts` (soft-delete, OPD filter), `patient.schema.ts` (add `isDeleted`), `opd.service.ts` (filter params) | None | `store/api/patient.api.ts`, `app/(dashboard)/patients/` (delete btn, OPD filters) |
| FR-E06 | Pathology/Radiology | None | `lab.service.ts` (edit/delete endpoints), `lab.schema.ts` (add `isDeleted`) | None | `store/api/lab.api.ts`, `app/(dashboard)/lab/` (edit/delete actions) |
| FR-E07 | Inventory | None | `inventory.service.ts` (edit/delete), `inventory.schema.ts` (add `isDeleted`) | None | `store/api/inventory.api.ts`, `app/(dashboard)/inventory/` (edit/delete actions) |
| FR-E08 | Login UI | None | None (backend unchanged) | None | `app/(auth)/login/page.tsx` (form simplified to email + password) |
| FR-E09 | Super Admin Platform Settings | `platform_settings` collection + model; endpoints in `tenant.routes.ts` | `tenant.controller.ts` (new handlers), `app.ts`, `common.types.ts` (`PLATFORM_SETTINGS` enum) | `app/(super-admin)/platform-settings/page.tsx`, `store/api/platformSettings.api.ts` | `app/(auth)/login/page.tsx` (logo/favicon/title), `app/(dashboard)/layout.tsx` (global favicon/title) |
