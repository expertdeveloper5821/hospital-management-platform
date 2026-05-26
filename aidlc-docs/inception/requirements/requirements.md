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

---

### FR-09: Pathology Lab Reports

**Source**: Requirement 9

1. When a Doctor or Receptionist creates a pathology test request for a patient, the Lab_Service SHALL create a test request record with a unique request ID, patient ID, test name(s), requesting Doctor's user ID, and status `PENDING`.
2. When a Pathologist uploads a pathology report for a test request, the Lab_Service SHALL store the report file (PDF or image, max 10 MB) in AWS S3, attach the S3 URL to the test request record, and set the status to `COMPLETED`.
3. If a Pathologist attempts to upload a report file exceeding 10 MB, the Lab_Service SHALL reject the upload and return a descriptive error.
4. When a pathology report status is set to `COMPLETED`, the System SHALL notify the requesting Doctor via an in-app WebSocket notification.
5. The Lab_Service SHALL allow a Doctor, Receptionist, or Manager to view all pathology test requests for a patient within the same Tenant, ordered by request date descending.
6. The Lab_Service SHALL allow a Pathologist to view all pending pathology test requests within the same Tenant.

---

### FR-10: Radiology Lab Reports

**Source**: Requirement 10

1. When a Doctor or Receptionist creates a radiology imaging request for a patient, the Lab_Service SHALL create an imaging request record with a unique request ID, patient ID, imaging type (X-Ray, MRI, CT Scan, Ultrasound), requesting Doctor's user ID, and status `PENDING`.
2. When a Radiologist uploads a radiology report for an imaging request, the Lab_Service SHALL store the report file (PDF or image, max 20 MB) in AWS S3, attach the S3 URL to the imaging request record, and set the status to `COMPLETED`.
3. If a Radiologist attempts to upload a report file exceeding 20 MB, the Lab_Service SHALL reject the upload and return a descriptive error.
4. When a radiology report status is set to `COMPLETED`, the System SHALL notify the requesting Doctor via an in-app WebSocket notification.
5. The Lab_Service SHALL allow a Doctor, Receptionist, or Manager to view all radiology imaging requests for a patient within the same Tenant, ordered by request date descending.
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
| Pathology | | | Read | ✓ | | ✓ | ✓ | | | | | |
| Radiology | | | Read | ✓ | | ✓ | | ✓ | | | | |
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
