# Requirements Verification Questions — Hospital Management Platform (HMS)

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
If none of the options match your needs, choose the last option (X) and describe your preference.

Let me know when you are done answering all questions.

---

## SECTION A: Technical Architecture & Deployment

### Question A1
The requirements mention Next.js frontend, Node.js + Express + TypeScript backend, and MongoDB. Should the backend follow a microservices architecture (one service per domain) or a modular monolith (all services in one deployable unit)?

A) Microservices — each service (Auth, Tenant, User, Patient, OPD, IPD, Lab, Inventory, Payment) is a separate deployable Node.js application
B) Modular Monolith — all services are modules within a single Node.js application, separated by folder structure
C) Hybrid — a small number of deployable units (e.g., Auth + Core + Lab + Finance as 3–4 services)
X) Other (please describe after [Answer]: tag below)

[Answer]: B, Modular Monolith

---

### Question A2
For the AWS deployment, which compute model should be used?

A) AWS ECS (Elastic Container Service) with Docker containers
B) AWS Lambda (serverless functions) for the backend
C) AWS EC2 instances (traditional VMs)
D) AWS App Runner (managed container service)
X) Other (please describe after [Answer]: tag below)

[Answer]: C, AWS EC2 instances

---

### Question A3
How should file uploads (hospital logos, pathology/radiology reports) be stored?

A) AWS S3 — store all files in S3 and serve via pre-signed URLs
B) MongoDB GridFS — store files directly in MongoDB
C) AWS S3 for reports, MongoDB for small assets like logos
X) Other (please describe after [Answer]: tag below)

[Answer]: A, AWS S3

---

### Question A4
For the JWT token denylist (logout invalidation — Requirement 5.5), which storage mechanism should be used?

A) Redis — fast in-memory store for token denylist with TTL matching JWT expiry
B) MongoDB — store invalidated tokens in a dedicated collection
C) In-memory store (suitable only for single-instance deployments)
X) Other (please describe after [Answer]: tag below)

[Answer]: C, In-memory store

---

### Question A5
For in-app notifications (Requirement 15), what delivery mechanism should be used?

A) Polling — frontend polls a `/notifications` endpoint every N seconds
B) WebSockets — real-time push via a persistent WebSocket connection
C) Server-Sent Events (SSE) — one-way real-time push from server to client
X) Other (please describe after [Answer]: tag below)

[Answer]: B, WebSockets

---

## SECTION B: Multi-Tenancy & Data Isolation

### Question B1
For MongoDB multi-tenant isolation (Requirement 2), which strategy should be used?

A) Shared database, shared collections — every document has a `tenantId` field; all queries are scoped by `tenantId`
B) Shared database, separate collections per tenant — e.g., `tenant_abc_patients`, `tenant_xyz_patients`
C) Separate database per tenant — each hospital gets its own MongoDB database
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Shared database, shared collections

---

### Question B2
The requirements state the Super Admin has "platform-level credentials" (Requirement 1.1). Should the Super Admin be stored in the same MongoDB instance as tenant data, or in a completely separate system/database?

A) Same MongoDB instance, separate `super_admins` collection (no tenantId)
B) Separate MongoDB database dedicated to platform administration
C) External identity provider (e.g., AWS Cognito) for Super Admin only
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Same MongoDB instance, separate `super_admins` collection

---

## SECTION C: Authentication & Security

### Question C1
For the invite email one-time setup link (Requirement 1.6), how should the link be secured?

A) Signed JWT token embedded in the URL, validated server-side on use
B) Random UUID token stored in the database with expiry timestamp
C) HMAC-signed token with expiry encoded in the URL
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Signed JWT token

---

### Question C2
Should the system support password reset (forgot password) functionality beyond the initial temporary password flow?

A) Yes — include a full forgot-password flow with email-based reset link
B) No — only the initial temporary password and first-login change are required for this phase
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes

---

### Question C3
The role-permission matrix (Requirement 13) shows some roles have "Read" access to certain modules. How should read-only access be enforced?

A) At the API level — read-only roles can only call GET endpoints for that module
B) At the API level with UI enforcement — backend enforces read-only, frontend also hides write actions
C) Separate permission flags per action (CREATE, READ, UPDATE, DELETE) per role per module
X) Other (please describe after [Answer]: tag below)

[Answer]: A, At the API level


---

## SECTION D: Patient & Clinical Operations

### Question D1
For the Medical Card PDF (Requirement 6.5), which PDF generation library should be used?

A) PDFKit — Node.js native PDF generation library
B) Puppeteer — headless Chrome to render HTML/CSS to PDF
C) jsPDF — JavaScript PDF generation
D) React-PDF — render React components to PDF
X) Other (please describe after [Answer]: tag below)

[Answer]: A, PDFKit


---

### Question D2
The OPD prescription (Requirement 7.2) includes medicine name, dosage, frequency, and duration. Should prescriptions be stored as structured data (individual fields) or as free-text?

A) Structured data — each prescription line item is a separate object with typed fields (enables future analytics)
B) Free-text — the doctor types the prescription as plain text
C) Both — structured fields with an optional free-text notes field
X) Other (please describe after [Answer]: tag below)

[Answer]: B, Free-text


---

### Question D3
For IPD bed management (Requirement 8), should the system maintain a master bed registry (pre-defined wards and beds), or should beds be ad-hoc (entered at admission time)?

A) Master bed registry — Hospital Admin pre-configures wards and bed numbers; system tracks occupancy against this registry
B) Ad-hoc — ward and bed number are free-text fields entered at admission; system checks for conflicts by querying active admissions
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Master bed registry


---

## SECTION E: Finance & Payments

### Question E1
The requirements mention payment methods: Cash, Card, UPI, Cheque (Requirement 12.1). Should the system integrate with any payment gateway (e.g., Razorpay, PayU) for online payments, or is this strictly a manual payment recording system?

A) Manual recording only — no payment gateway integration; staff records payments that were collected offline
B) Integrate with Razorpay for UPI and Card payments
C) Integrate with PayU for UPI and Card payments
X) Other (please describe after [Answer]: tag below)

[Answer]: A and B, Manual recording only and Integrate with Razorpay for UPI and Card payments

---

### Question E2
For receipt PDF generation (Requirement 12.2), should the same PDF library be used as for Medical Cards?

A) Yes — use the same library for consistency
B) No — use a different library optimized for receipts/invoices
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes

---

## SECTION F: Non-Functional Requirements

### Question F1
What are the expected performance targets for the system?

A) Standard SaaS — API response time < 500ms for 95th percentile; support up to 50 concurrent hospitals at launch
B) High performance — API response time < 200ms for 95th percentile; support up to 200 concurrent hospitals
C) No specific targets defined for this phase — optimize as needed
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Standard SaaS


---

### Question F2
What is the expected data retention policy beyond the 365-day audit log requirement?

A) Patient records and clinical data retained indefinitely (no deletion)
B) Patient records retained for 7 years (standard Indian healthcare regulation)
C) Configurable per tenant — Hospital Admin sets retention policy
X) Other (please describe after [Answer]: tag below)

[Answer]: A

---

### Question F3
Should the system support localization / internationalization (i18n) for the Indian market?

A) English only for this phase
B) English + Hindi
C) English + multiple regional languages (specify which after [Answer]: tag)
X) Other (please describe after [Answer]: tag below)

[Answer]: A, English only


---

### Question F4
What is the expected email delivery mechanism for system emails (invite emails, welcome emails, account lock notifications)?

A) AWS SES (Simple Email Service)
B) SendGrid
C) Nodemailer with SMTP (configurable)
X) Other (please describe after [Answer]: tag below)

[Answer]: C, Nodemailer with SMTP (configurable)


---

## SECTION G: Extensions

### Question G1 — Security Extension
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)
B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes


---

### Question G2 — Property-Based Testing Extension
Should property-based testing (PBT) rules be enforced for this project?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)
B) Partial — enforce PBT rules only for pure functions and serialization round-trips (suitable for projects with limited algorithmic complexity)
C) No — skip all PBT rules (suitable for simple CRUD applications, UI-only projects, or thin integration layers with no significant business logic)
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes



---
