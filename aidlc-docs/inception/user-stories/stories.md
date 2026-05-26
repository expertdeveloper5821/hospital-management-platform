# User Stories — Hospital Management Platform (HMS)

**Organization**: Persona-Based  
**Granularity**: Coarse-grained (Epic level — one story per role per module)  
**Acceptance Criteria Format**: Given/When/Then (Gherkin)  
**Prioritization**: MoSCoW (Must Have / Should Have / Could Have / Won't Have)  
**INVEST**: Each story is Independent, Negotiable, Valuable, Estimable, Small (at epic level), Testable

---

## Section 1: Super Admin (SuperAdmin)

---

### US-SA-01 — Hospital Onboarding
**Priority**: Must Have  
**Requirement Ref**: FR-01

> As a Super Admin, I want to onboard new hospitals onto the platform with their documents and activate them, so that each hospital can operate as an independent tenant.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Super Admin
When I submit a hospital onboarding form with all required documents (registration certificate, GST number, PAN card, address proof)
Then a new Tenant record is created with status PENDING_VERIFICATION

Given I am authenticated as a Super Admin
When I approve a Tenant in PENDING_VERIFICATION status
Then the Tenant status changes to ACTIVE
And an Invite Email is sent to the designated Hospital Admin email with a one-time setup link valid for 48 hours

Given I am authenticated as a Super Admin
When I submit an onboarding form with one or more missing required documents
Then the system returns a descriptive validation error listing the missing documents
And no Tenant record is created

Given I am authenticated as a Super Admin
When I view the tenant list
Then I see a paginated list of all Tenants with their current status (PENDING_VERIFICATION, ACTIVE, INACTIVE)

Given I am authenticated as a Super Admin
When I deactivate an ACTIVE Tenant
Then the Tenant status changes to INACTIVE
And all login attempts from users of that Tenant are rejected with HTTP 401
```

---

### US-SA-02 — Invite Link Management
**Priority**: Must Have  
**Requirement Ref**: FR-01

> As a Super Admin, I want to regenerate expired invite links for Hospital Admins, so that hospitals are not blocked from completing their setup.

**Acceptance Criteria**:

```gherkin
Given a Hospital Admin's one-time setup link has expired (older than 48 hours)
When the Hospital Admin attempts to use the link
Then the system rejects the link with a descriptive error

Given I am authenticated as a Super Admin
When I regenerate an Invite Email for a Tenant
Then a new one-time setup link is generated and sent to the Hospital Admin's email
And the previous link is invalidated
```

---

## Section 2: Hospital Admin (Priya)

---

### US-HA-01 — Initial Hospital Setup and Branding
**Priority**: Must Have  
**Requirement Ref**: FR-03

> As a Hospital Admin, I want to configure my hospital's branding during initial setup, so that all documents and the portal reflect my hospital's identity.

**Acceptance Criteria**:

```gherkin
Given I have received a valid Invite Email link
When I complete the initial setup flow
Then I am prompted to upload a hospital logo, set a display name, and choose a primary color

Given I am completing initial setup
When I upload a logo file that is 2 MB or smaller
Then the logo is stored and associated with my Tenant

Given I am completing initial setup
When I upload a logo file exceeding 2 MB
Then the system rejects the upload and returns a descriptive error

Given my Tenant's branding is configured
When any user in my Tenant logs in
Then the frontend displays my hospital's logo, name, and primary color

Given my Tenant's branding is configured
When a Medical Card or payment receipt is generated
Then the document includes my hospital's logo and name
```

---

### US-HA-02 — User Account and Role Management
**Priority**: Must Have  
**Requirement Ref**: FR-04

> As a Hospital Admin, I want to create, manage, and deactivate user accounts with appropriate roles, so that each staff member can access only the features relevant to their responsibilities.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Hospital Admin
When I create a new user account with a valid role (Manager, Doctor, Nurse, Receptionist, Pathologist, Radiologist, Finance_Manager, HR, Admin, Staff)
Then the user account is created within my Tenant
And a welcome email with a temporary password and login link is sent to the user's email address

Given I am authenticated as a Hospital Admin
When I deactivate a user account that is not the last active Hospital Admin
Then the account is deactivated
And all subsequent login attempts for that account are rejected

Given I am authenticated as a Hospital Admin
When I attempt to deactivate the last active Hospital Admin account in my Tenant
Then the system rejects the operation and returns a descriptive error

Given I am authenticated as a Hospital Admin
When I update a user's role
Then the new permissions are applied on the user's next login

Given a user attempts to access a module not permitted for their role
When the request is evaluated by the Auth Service
Then the system returns HTTP 403 Forbidden
```

---

## Section 3: Manager (Vikram)

---

### US-MG-01 — OPD Queue Oversight
**Priority**: Must Have  
**Requirement Ref**: FR-07

> As a Manager, I want to view and oversee the OPD queue for the current day, so that I can monitor patient flow and doctor workloads.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Manager
When I view the OPD queue for the current day
Then I see all OPD visits for today within my Tenant, filterable by Doctor

Given I am authenticated as a Manager
When I view a patient's OPD visit history
Then I see all past visits for that patient within my Tenant in chronological order
```

---

### US-MG-02 — IPD Bed Occupancy Management
**Priority**: Must Have  
**Requirement Ref**: FR-08

> As a Manager, I want to view bed occupancy across all wards, so that I can make informed decisions about admissions and resource allocation.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Manager
When I view the bed occupancy summary
Then I see total beds, occupied beds, and available beds per ward within my Tenant

Given I am authenticated as a Manager
When I view the list of currently admitted patients
Then I see all active IPD admissions within my Tenant, filterable by ward
```

---

### US-MG-03 — Inventory Oversight
**Priority**: Must Have  
**Requirement Ref**: FR-11

> As a Manager, I want to manage hospital inventory and receive low-stock alerts, so that critical supplies are always available.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Manager
When I add a new inventory item with name, category, unit of measure, stock quantity, and minimum threshold
Then the item is created and associated with my Tenant

Given I am authenticated as a Manager
When I update the stock quantity of an inventory item
Then the previous quantity, new quantity, reason, and my user ID are recorded in the audit log

Given the stock quantity of an inventory item falls below its minimum threshold
When the system evaluates stock levels
Then an in-app notification is sent to all Manager and Admin users within my Tenant

Given I am authenticated as a Manager
When I attempt to set a stock quantity to a negative value
Then the system rejects the update and returns a descriptive error

Given I am authenticated as a Manager
When I view the inventory list
Then I see all items within my Tenant, filterable by category and sortable by stock quantity
```

---

### US-MG-04 — Payment Summary Reporting
**Priority**: Must Have  
**Requirement Ref**: FR-12

> As a Manager, I want to view payment records and generate summary reports, so that I have financial visibility across the hospital.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Manager
When I view payment records filtered by a date range and payment method
Then I see all matching payment records within my Tenant

Given I am authenticated as a Manager
When I generate a payment summary report for a date range
Then I receive the total amount collected broken down by payment method (Cash, Card, UPI, Cheque) for that period within my Tenant
```

---

### US-MG-05 — Audit Log Access
**Priority**: Must Have  
**Requirement Ref**: FR-14

> As a Manager, I want to query audit logs for critical entity changes, so that I can investigate discrepancies and ensure accountability.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Manager
When I query audit logs filtered by entity type, entity ID, user ID, or date range
Then I see all matching audit log entries within my Tenant

Given an audit log entry exists
When I view it
Then I see the entity type, entity ID, action (CREATE/UPDATE/DELETE), previous value, new value, user ID, tenant ID, and UTC timestamp
```

---

## Section 4: Doctor (Dr. Meera)

---

### US-DR-01 — OPD Consultation Management
**Priority**: Must Have  
**Requirement Ref**: FR-07

> As a Doctor, I want to record and complete OPD consultations, so that patient visits are documented and my queue is managed efficiently.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Doctor
When I view my OPD queue for the current day
Then I see all OPD visits assigned to me with status OPEN

Given I am authenticated as a Doctor and viewing an OPEN OPD visit
When I record the chief complaint, diagnosis, prescription (free-text), and follow-up date
Then the information is saved against the visit record

Given I am authenticated as a Doctor
When I mark an OPD visit as complete
Then the visit status changes to COMPLETED and the completion timestamp is recorded

Given I am authenticated as a Doctor
When I attempt to update an OPD visit with status COMPLETED
Then the system rejects the update and returns a descriptive error

Given I am authenticated as a Doctor
When I view a patient's visit history
Then I see all past OPD visits for that patient within my Tenant in chronological order
```

---

### US-DR-02 — IPD Patient Management
**Priority**: Must Have  
**Requirement Ref**: FR-08

> As a Doctor, I want to manage admitted patients and record daily progress notes, so that inpatient care is documented throughout the hospital stay.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Doctor
When I view the list of currently admitted patients
Then I see all active IPD admissions within my Tenant

Given I am authenticated as a Doctor and viewing an active IPD admission
When I record a daily progress note
Then the note is stored with my user ID and the current timestamp

Given I am authenticated as a Doctor, Hospital Admin, Admin, or Receptionist
When I discharge a patient
Then the admission status changes to DISCHARGED, the discharge date is recorded, and the bed is released
```

---

### US-DR-03 — Lab Test Requests and Results
**Priority**: Must Have  
**Requirement Ref**: FR-09, FR-10

> As a Doctor, I want to request pathology and radiology tests and be notified when reports are ready, so that diagnostic results are linked to the patient's record and I can act on them promptly.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Doctor
When I create a pathology test request for a patient with one or more test names
Then a test request record is created with status PENDING and my user ID as the requesting doctor

Given I am authenticated as a Doctor
When I create a radiology imaging request for a patient with an imaging type (X-Ray, MRI, CT Scan, Ultrasound)
Then an imaging request record is created with status PENDING and my user ID as the requesting doctor

Given a pathology or radiology report has been uploaded and status set to COMPLETED
When the system processes the completion event
Then I receive an in-app notification indicating the report is ready

Given I am authenticated as a Doctor
When I view lab requests for a patient
Then I see all pathology and radiology requests for that patient within my Tenant, ordered by request date descending
```

---

## Section 5: Nurse (Sunita)

---

### US-NU-01 — Patient Registration Assistance
**Priority**: Should Have  
**Requirement Ref**: FR-06

> As a Nurse, I want to register new patients when the receptionist is unavailable, so that patient intake is not delayed.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Nurse
When I submit a patient registration form with all required fields (full name, date of birth, gender, mobile number, address)
Then a patient record is created with a unique patient ID within my Tenant

Given I am authenticated as a Nurse
When I submit a registration for a patient whose mobile number already exists in my Tenant
Then the system alerts me of a potential duplicate and requires explicit confirmation before creating a new record
```

---

### US-NU-02 — IPD Ward Monitoring
**Priority**: Must Have  
**Requirement Ref**: FR-08

> As a Nurse, I want to view all admitted patients in my ward, so that I can monitor patient status and provide appropriate care.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Nurse
When I view the IPD patient list filtered by ward
Then I see all currently admitted patients in that ward within my Tenant

Given I am authenticated as a Nurse
When I view an OPD visit record for a patient
Then I can read the visit details (read-only access, no edits permitted)
```

---

## Section 6: Receptionist (Kavya)

---

### US-RC-01 — Patient Registration and Medical Card
**Priority**: Must Have  
**Requirement Ref**: FR-06

> As a Receptionist, I want to register new patients and generate Medical Cards, so that each patient has a unique identity within the hospital.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Receptionist
When I submit a patient registration form with all required fields
Then a patient record is created with a unique patient ID within my Tenant

Given I am authenticated as a Receptionist
When a patient record is successfully created
Then a Medical Card PDF is generated containing the hospital logo, hospital name, patient full name, patient ID, date of birth, gender, blood group (if provided), and mobile number

Given I am authenticated as a Receptionist
When I search for a patient by patient ID, full name, or mobile number
Then I see matching patient records within my Tenant

Given I am authenticated as a Receptionist
When I submit a registration for a patient whose mobile number already exists in my Tenant
Then the system alerts me of a potential duplicate and requires explicit confirmation before creating a new record

Given I am authenticated as a Receptionist
When I update a patient's demographic information
Then the previous values are recorded in an audit log with the timestamp and my user ID
```

---

### US-RC-02 — OPD Visit Creation
**Priority**: Must Have  
**Requirement Ref**: FR-07

> As a Receptionist, I want to create OPD visits for existing patients and assign them to a doctor, so that patient consultations are tracked from the moment of arrival.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Receptionist
When I create an OPD visit for an existing patient and assign a Doctor
Then a visit record is created with a unique visit ID, the patient ID, the Doctor's user ID, today's date, and status OPEN

Given I am authenticated as a Receptionist
When I view the OPD queue for the current day
Then I see all OPD visits for today within my Tenant, filterable by Doctor
```

---

### US-RC-03 — IPD Admission Creation
**Priority**: Must Have  
**Requirement Ref**: FR-08

> As a Receptionist, I want to create IPD admissions and assign beds, so that admitted patients are tracked from the moment of admission.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Receptionist
When I create an IPD admission for an existing patient with a ward, bed number, and assigned Doctor
Then an admission record is created with a unique admission ID, status ADMITTED, and today's admission date

Given I am authenticated as a Receptionist
When I attempt to assign a bed that is already occupied by an active admission
Then the system returns a descriptive error listing the current occupant's admission ID

Given I am authenticated as a Receptionist
When I select a bed from the master bed registry
Then only available (unoccupied) beds are shown as selectable options
```

---

### US-RC-04 — Lab Test Request Submission
**Priority**: Must Have  
**Requirement Ref**: FR-09, FR-10

> As a Receptionist, I want to submit pathology and radiology test requests on behalf of doctors, so that lab workflows begin promptly after a consultation.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Receptionist
When I create a pathology test request for a patient with one or more test names and the requesting Doctor's name
Then a test request record is created with status PENDING

Given I am authenticated as a Receptionist
When I create a radiology imaging request for a patient with an imaging type and the requesting Doctor's name
Then an imaging request record is created with status PENDING

Given I am authenticated as a Receptionist
When I view lab requests for a patient
Then I see all pathology and radiology requests for that patient within my Tenant, ordered by request date descending
```

---

### US-RC-05 — Payment Processing
**Priority**: Must Have  
**Requirement Ref**: FR-12

> As a Receptionist, I want to record patient payments and generate receipts, so that financial transactions are documented and patients receive proof of payment.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Receptionist
When I submit a payment record for a patient with amount, payment method (Cash or Cheque), and description
Then a payment record is created with a unique payment ID and the current timestamp

Given I am authenticated as a Receptionist
When I submit a UPI or Card payment via Razorpay
Then the system initiates a Razorpay payment request
And upon successful webhook confirmation, a payment record is created automatically

Given a payment record is created
When the system processes the payment
Then a receipt PDF is generated containing the hospital logo, hospital name, receipt number, patient name, patient ID, payment date, amount in INR, payment method, and description

Given I am authenticated as a Receptionist
When I submit a payment with an amount of zero or a negative value
Then the system rejects the submission and returns a descriptive error

Given I am authenticated as a Receptionist
When I retrieve a previously generated receipt by payment ID
Then the receipt PDF is returned as a downloadable file
```

---

## Section 7: Pathologist (Dr. Rajan)

---

### US-PT-01 — Pathology Report Management
**Priority**: Must Have  
**Requirement Ref**: FR-09

> As a Pathologist, I want to view pending test requests and upload completed reports, so that diagnostic results are linked to patient records and doctors are notified promptly.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Pathologist
When I view the pathology queue
Then I see all pending pathology test requests within my Tenant

Given I am authenticated as a Pathologist
When I upload a pathology report file (PDF or image, 10 MB or smaller) for a test request
Then the file is stored in S3, the S3 URL is attached to the test request, and the status changes to COMPLETED
And the requesting Doctor receives an in-app notification

Given I am authenticated as a Pathologist
When I attempt to upload a report file exceeding 10 MB
Then the system rejects the upload and returns a descriptive error
```

---

## Section 8: Radiologist (Dr. Ananya)

---

### US-RL-01 — Radiology Report Management
**Priority**: Must Have  
**Requirement Ref**: FR-10

> As a Radiologist, I want to view pending imaging requests and upload completed reports, so that imaging results are linked to patient records and doctors are notified promptly.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Radiologist
When I view the radiology queue
Then I see all pending radiology imaging requests within my Tenant

Given I am authenticated as a Radiologist
When I upload a radiology report file (PDF or image, 20 MB or smaller) for an imaging request
Then the file is stored in S3, the S3 URL is attached to the imaging request, and the status changes to COMPLETED
And the requesting Doctor receives an in-app notification

Given I am authenticated as a Radiologist
When I attempt to upload a report file exceeding 20 MB
Then the system rejects the upload and returns a descriptive error
```

---

## Section 9: Finance Manager (Rohit)

---

### US-FM-01 — Payment Management and Reporting
**Priority**: Must Have  
**Requirement Ref**: FR-12

> As a Finance Manager, I want to record payments, generate receipts, and produce payment summary reports, so that all financial transactions are documented and reportable.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as a Finance Manager
When I submit a payment record for a patient with amount, payment method, and description
Then a payment record is created and a branded receipt PDF is generated

Given I am authenticated as a Finance Manager
When I submit a UPI or Card payment via Razorpay
Then the system initiates a Razorpay payment request
And upon successful webhook confirmation, a payment record and receipt are created automatically

Given I am authenticated as a Finance Manager
When I view payment records filtered by date range and payment method
Then I see all matching payment records within my Tenant

Given I am authenticated as a Finance Manager
When I generate a payment summary report for a date range
Then I receive the total amount collected broken down by payment method for that period within my Tenant

Given I am authenticated as a Finance Manager
When I retrieve a receipt by payment ID
Then the receipt PDF is returned as a downloadable file

Given I am authenticated as a Finance Manager
When I submit a payment with an amount of zero or a negative value
Then the system rejects the submission and returns a descriptive error
```

---

## Section 10: HR (Deepa)

---

### US-HR-01 — Staff Account Management
**Priority**: Should Have  
**Requirement Ref**: FR-04

> As an HR officer, I want to create and deactivate staff user accounts, so that system access is aligned with current employment status.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as an HR officer
When I create a new user account with a valid role
Then the user account is created within my Tenant
And a welcome email with a temporary password and login link is sent to the user

Given I am authenticated as an HR officer
When I deactivate a user account that is not the last active Hospital Admin
Then the account is deactivated and all subsequent login attempts are rejected

Given I am authenticated as an HR officer
When I view the user list
Then I see all user accounts within my Tenant with their current status and role
```

---

## Section 11: Admin (Suresh)

---

### US-AD-01 — Inventory Management
**Priority**: Must Have  
**Requirement Ref**: FR-11

> As an Admin, I want to manage hospital equipment and consumable inventory, so that stock levels are tracked and shortages are prevented.

**Acceptance Criteria**:

```gherkin
Given I am authenticated as an Admin
When I add a new inventory item with name, category (Equipment or Consumable), unit of measure, stock quantity, and minimum threshold
Then the item is created and associated with my Tenant

Given I am authenticated as an Admin
When I update the stock quantity of an inventory item
Then the previous quantity, new quantity, reason, and my user ID are recorded in the audit log

Given the stock quantity of an inventory item falls below its minimum threshold
When the system evaluates stock levels
Then an in-app notification is sent to all Manager and Admin users within my Tenant

Given I am authenticated as an Admin
When I attempt to set a stock quantity to a negative value
Then the system rejects the update and returns a descriptive error

Given I am authenticated as an Admin
When I view the inventory list
Then I see all items within my Tenant, filterable by category and sortable by stock quantity
```

---

## Section 12: Staff (Ramesh)

---

### US-ST-01 — System Identity
**Priority**: Could Have  
**Requirement Ref**: FR-04

> As a Staff member, I want to have a system account, so that I have a digital identity within the hospital for HR and access control purposes.

**Acceptance Criteria**:

```gherkin
Given I am a Staff member with a system account
When I log in with valid credentials
Then I am authenticated successfully
And I am presented with a dashboard that reflects my role (no module access in this phase)

Given I am a Staff member
When I attempt to access any clinical or administrative module
Then the system returns HTTP 403 Forbidden
```

---

## Cross-Cutting Stories

---

### US-CC-01 — Authentication and Session Management
**Priority**: Must Have  
**Requirement Ref**: FR-05

> As any system user, I want to securely log in, manage my session, and reset my password, so that my account and data are protected.

**Acceptance Criteria**:

```gherkin
Given I am a registered user
When I submit valid credentials
Then I receive a signed JWT containing my user ID, tenant ID, and role, valid for 8 hours

Given I am a registered user
When I submit invalid credentials
Then the system returns HTTP 401 without revealing whether the email or password was incorrect

Given I have failed to log in 5 times within 15 minutes
When I attempt another login
Then my account is locked and I receive an account-lock notification email

Given my account has been locked for 30 minutes
When the lockout period expires
Then my account is automatically unlocked

Given I am logged in
When I log out
Then my JWT is invalidated and added to the token denylist

Given I am logging in for the first time with a temporary password
When I submit my credentials
Then I am required to change my password before accessing any module

Given I have forgotten my password
When I request a password reset
Then a reset link is sent to my registered email address
And the link is valid for a limited time and invalidated after use
```

---

### US-CC-02 — In-App Notifications
**Priority**: Must Have  
**Requirement Ref**: FR-15

> As any system user, I want to receive and manage in-app notifications for relevant events, so that I am informed of actions that require my attention.

**Acceptance Criteria**:

```gherkin
Given a relevant event occurs (pathology report completed, radiology report completed, inventory below threshold, account locked)
When the system processes the event
Then an in-app notification is delivered to the relevant user(s) via WebSocket with a title, message, timestamp, and UNREAD status

Given I have unread notifications
When I view the notification icon
Then I see an unread count badge showing the number of unread notifications

Given I am viewing my notification panel
When I mark a notification as read
Then the notification status changes to READ

Given I am viewing my notification panel
When I view my notification history
Then I see all notifications (UNREAD and READ) from the last 30 days
```

---

## Story Summary

| Story ID | Persona | Module | Priority | Req Ref |
|---|---|---|---|---|
| US-SA-01 | Super Admin | Tenant Onboarding | Must Have | FR-01 |
| US-SA-02 | Super Admin | Invite Link Management | Must Have | FR-01 |
| US-HA-01 | Hospital Admin | Branding Configuration | Must Have | FR-03 |
| US-HA-02 | Hospital Admin | User Management | Must Have | FR-04 |
| US-MG-01 | Manager | OPD Oversight | Must Have | FR-07 |
| US-MG-02 | Manager | IPD Bed Occupancy | Must Have | FR-08 |
| US-MG-03 | Manager | Inventory Management | Must Have | FR-11 |
| US-MG-04 | Manager | Payment Reporting | Must Have | FR-12 |
| US-MG-05 | Manager | Audit Logs | Must Have | FR-14 |
| US-DR-01 | Doctor | OPD Consultations | Must Have | FR-07 |
| US-DR-02 | Doctor | IPD Patient Management | Must Have | FR-08 |
| US-DR-03 | Doctor | Lab Requests & Results | Must Have | FR-09, FR-10 |
| US-NU-01 | Nurse | Patient Registration | Should Have | FR-06 |
| US-NU-02 | Nurse | IPD Ward Monitoring | Must Have | FR-08 |
| US-RC-01 | Receptionist | Patient Registration & Medical Card | Must Have | FR-06 |
| US-RC-02 | Receptionist | OPD Visit Creation | Must Have | FR-07 |
| US-RC-03 | Receptionist | IPD Admission Creation | Must Have | FR-08 |
| US-RC-04 | Receptionist | Lab Test Requests | Must Have | FR-09, FR-10 |
| US-RC-05 | Receptionist | Payment Processing | Must Have | FR-12 |
| US-PT-01 | Pathologist | Pathology Report Management | Must Have | FR-09 |
| US-RL-01 | Radiologist | Radiology Report Management | Must Have | FR-10 |
| US-FM-01 | Finance Manager | Payment Management & Reporting | Must Have | FR-12 |
| US-HR-01 | HR | Staff Account Management | Should Have | FR-04 |
| US-AD-01 | Admin | Inventory Management | Must Have | FR-11 |
| US-ST-01 | Staff | System Identity | Could Have | FR-04 |
| US-CC-01 | All Users | Authentication & Session | Must Have | FR-05 |
| US-CC-02 | All Users | In-App Notifications | Must Have | FR-15 |

**Total Stories**: 27  
**Must Have**: 24 | **Should Have**: 2 | **Could Have**: 1
