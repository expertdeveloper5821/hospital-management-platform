# Requirements Document — Hospital Features Enhancement

## Introduction

This document defines requirements for six enhancement features on the existing Hospital Management Platform (HMS). The platform is a multi-tenant, role-based system built on Next.js (frontend), Node.js/Express/TypeScript (backend), and MongoDB. The enhancements cover:

1. **Staff ID Cards** — Printable/downloadable ID card PDF for each staff member
2. **Patient Medical ID Card Redesign** — Updated layout and content for the existing patient Medical Card PDF
3. **Patient Packages** — Admin-defined care/service bundles that can be created and managed
4. **Package Assignment** — Assigning packages to patients by authorised roles
5. **Staff Document Onboarding** — Uploading and managing compliance documents (Aadhaar, PAN, Certificates, etc.) per staff member
6. **Patient Billing / Charges** — Itemised charge tracking for OPD visits, IPD stays, and lab services, contributed by multiple roles, culminating in a consolidated patient bill

---

## Glossary

| Term | Definition |
|---|---|
| System | The Hospital Management Platform (HMS) as a whole |
| Staff_ID_Card_Service | Backend service responsible for generating and serving Staff ID Card PDFs |
| Medical_Card_Service | Backend service responsible for generating and serving Patient Medical Card PDFs |
| Package_Service | Backend service managing care/service package definitions and assignments |
| Charge_Service | Backend service managing itemised patient charges and billing |
| Document_Service | Backend service managing staff onboarding document uploads and retrieval |
| Staff_ID_Card | A downloadable PDF identity card for a hospital staff member containing photo, name, role, department, employee ID, hospital branding, and validity period |
| Medical_Card | The existing patient identity PDF; redesigned under this feature with updated layout, QR code, and expanded fields |
| Package | A named, pre-defined bundle of hospital services (e.g., "Maternity Package", "Diabetic Care Package") with a fixed price (minimum 0.00 INR), created by a Hospital_Admin or Admin |
| Package_Assignment | A record linking a Package to a Patient for a specific encounter or duration |
| Charge | An itemised financial entry for a specific service rendered to a patient (e.g., doctor consultation fee, lab test fee, IPD daily bed charge, nursing fee) |
| Bill | A consolidated, read-only view of all non-voided Charges for a patient, grouped by charge category, with a subtotal per category and a grand total |
| Staff_Document | An uploaded compliance document associated with a staff member (e.g., Aadhaar Card, PAN Card, Medical Registration Certificate, Degree Certificate) |
| Document_Category | Enumerated type for staff documents: AADHAAR, PAN, MEDICAL_REGISTRATION, DEGREE_CERTIFICATE, OTHER |
| Tenant | A hospital entity onboarded onto the platform with isolated data and branding |
| Hospital_Admin | Tenant-level administrator; can manage users, packages, documents, and charges |
| Admin | Operational admin role within a tenant; can manage packages, charges, and documents |
| Manager | Hospital operations manager; read access to billing and packages |
| Finance_Manager | Finance-focused role within a tenant; read access to billing, charges, and package assignments |
| Doctor | Clinical role; can add CONSULTATION and PROCEDURE charges for OPD visits |
| Nurse | Clinical support role; can add NURSING charges |
| Receptionist | Front-desk role; can assign packages and add service charges |
| Pathologist | Lab role; can add LAB_TEST charges for pathology services |
| Radiologist | Imaging role; can add LAB_TEST charges for radiology services |
| HR | Human Resources role; manages staff document onboarding and Staff ID Card generation |
| Staff | General hospital support staff |
| OPD | Outpatient Department visit record |
| IPD | Inpatient Department admission record |
| PDFKit | Node.js library used for PDF generation throughout the platform |
| S3 | AWS S3 object storage used for all file uploads and generated PDFs |
| tenantId | Unique identifier scoping all data records to a single Tenant |
| RBAC | Role-Based Access Control |
| Pre-signed URL | A time-limited AWS S3 URL granting temporary read access to a stored object without requiring AWS credentials |
| Soft-delete | A logical deletion where the record's `isDeleted` flag is set to `true` and the record is excluded from normal queries, but the underlying data and S3 object are retained |

---

## Requirements

---

### Requirement 1: Staff ID Cards

**User Story:** As a Hospital Admin or HR, I want to generate a downloadable Staff ID Card PDF for each staff member, so that every employee has a standardised identity document bearing hospital branding.

#### Acceptance Criteria

1. WHEN a Hospital_Admin or HR user requests a Staff ID Card for a staff member within the same Tenant, THE Staff_ID_Card_Service SHALL generate a PDF containing all of the following fields: hospital logo, hospital display name, staff full name, staff role label, staff employee ID (the staff member's userId), staff profile photo (if available — see AC-5), department (derived from role label), issue date (the UTC date of generation), and expiry date (exactly 365 days after the issue date).

2. THE Staff_ID_Card_Service SHALL apply the Tenant's branding (logo S3 asset and hospital display name from the Tenant's branding configuration) to every generated Staff ID Card PDF. WHEN a Tenant has no logo configured, THE Staff_ID_Card_Service SHALL render the card without a logo image and SHALL NOT abort generation.

3. WHEN a Staff ID Card PDF is generated or regenerated successfully, THE Staff_ID_Card_Service SHALL store the PDF in AWS S3 under the key pattern `tenants/{tenantId}/staff-id-cards/{userId}.pdf`, overwriting any previously stored object at that key, and SHALL return a Pre-signed URL valid for exactly 24 hours.

4. IF a Hospital_Admin or HR user requests a Staff ID Card for a userId whose tenantId differs from the requesting user's tenantId, THEN THE System SHALL return an HTTP 403 Forbidden response without generating, storing, or returning any PDF or Pre-signed URL.

5. IF the staff member's profile photo is unavailable (profileImageUrl is null or the S3 fetch fails), THEN THE Staff_ID_Card_Service SHALL render a placeholder silhouette icon in the photo area of the ID card and SHALL continue PDF generation without returning an error.

6. WHEN a Hospital_Admin or HR user submits a regeneration request for a Staff ID Card, THE Staff_ID_Card_Service SHALL overwrite the existing S3 object at the same key pattern defined in AC-3 and SHALL return a fresh Pre-signed URL valid for 24 hours.

7. WHEN a Staff ID Card PDF is generated for the first time for a given userId within a Tenant, THE Staff_ID_Card_Service SHALL log a CREATE audit entry with entity type STAFF_ID_CARD, the staff member's userId as the entityId, and the requesting user's userId as the actor. WHEN a Staff ID Card PDF is regenerated for a userId that already has an existing S3 object, THE Staff_ID_Card_Service SHALL log an UPDATE audit entry with the same entity type, entityId, and actor fields.

8. WHEN a user whose role is not Hospital_Admin or HR within the same Tenant requests Staff ID Card generation or regeneration, THE System SHALL return an HTTP 403 Forbidden response without generating, storing, or returning any PDF or Pre-signed URL.

9. IF the userId supplied in the Staff ID Card request does not correspond to any user record within the requesting user's tenantId, THEN THE Staff_ID_Card_Service SHALL return an HTTP 404 Not Found response without generating any PDF.

10. IF the AWS S3 store operation fails during Staff ID Card generation or regeneration, THEN THE Staff_ID_Card_Service SHALL return an HTTP 502 Bad Gateway response with a descriptive error message and SHALL NOT return a Pre-signed URL.

11. FOR ALL generated Staff ID Cards, the expiry date on the card SHALL be exactly 365 days after the issue date regardless of the time zone of the requesting user.

---

### Requirement 2: Patient Medical ID Card Redesign

**User Story:** As a Receptionist or Hospital Admin, I want the Patient Medical ID Card to have a modern, information-rich layout with a QR code, so that the card is more useful for quick patient identification at the point of care.

#### Acceptance Criteria

1. WHEN a Medical Card is generated or regenerated for a patient, THE Medical_Card_Service SHALL produce a PDF rendered at a credit-card-proportioned landscape size (85.6 mm × 54 mm at 300 DPI) containing the following mandatory fields: hospital logo (top-left), hospital display name, patient full name, unique patient ID, date of birth, gender, mobile number, and card generation date (UTC). THE Medical_Card_Service SHALL include each of the following fields only when the corresponding value is present on the patient record, and SHALL omit the field label and value entirely when absent: blood group, Aadhaar number (masked — see AC-2b), emergency contact name, and emergency contact mobile number.

2. WHEN a Medical Card includes an Aadhaar number, THE Medical_Card_Service SHALL display only the last 4 digits of the Aadhaar number in the format `XXXX-XXXX-{last4}`, masking the first 8 digits. THE Medical_Card_Service SHALL NOT include the raw Aadhaar digits in any form other than this masked format in the rendered PDF.

3. WHEN a Medical Card is generated or regenerated, THE Medical_Card_Service SHALL embed a QR code at the bottom-right of the card face. The QR code SHALL encode a JSON object containing exactly two keys: `patientId` and `tenantId`, both sourced from the patient record. IF QR code generation fails for any reason, THE Medical_Card_Service SHALL abort PDF generation, discard any partially generated content, and return an HTTP 500 response with a descriptive error message.

4. WHEN a Tenant has a `primaryColor` hex value configured in its branding settings, THE Medical_Card_Service SHALL apply that color as the card header and footer accent color. WHEN a Tenant does not have a `primaryColor` configured, THE Medical_Card_Service SHALL apply the default accent color `#2563EB`.

5. WHEN a Medical Card PDF is generated or regenerated successfully, THE Medical_Card_Service SHALL store the PDF in AWS S3 under the same key pattern used by the existing Medical Card implementation and SHALL return a Pre-signed URL valid for exactly 24 hours. The existing Medical Card download endpoint and key pattern SHALL remain functionally unchanged so that previously issued links continue to resolve. IF the AWS S3 store operation fails, THE Medical_Card_Service SHALL return an HTTP 502 Bad Gateway response and SHALL NOT return a Pre-signed URL.

6. WHEN a Medical Card is generated for the first time for a given patientId, THE Medical_Card_Service SHALL log a CREATE audit entry with entity type PATIENT, the patientId as the entityId, and the requesting user's userId as the actor. WHEN a Medical Card is regenerated for a patientId that already has an existing Medical Card in S3, THE Medical_Card_Service SHALL log an UPDATE audit entry with the same entity type, entityId, and actor fields.

7. WHEN a user with role Receptionist, Hospital_Admin, Admin, or Manager submits a Medical Card generation or regeneration request for a patient within the same Tenant, THE Medical_Card_Service SHALL process the request. No additional authorization checks beyond role membership and tenantId equality are required.

8. WHEN a user whose role is not Receptionist, Hospital_Admin, Admin, or Manager submits a Medical Card generation or regeneration request, THE Medical_Card_Service SHALL return an HTTP 403 Forbidden response without generating, storing, or returning any PDF or Pre-signed URL.

9. IF the patientId supplied to the Medical Card endpoint does not exist within the requesting user's tenantId, THEN THE Medical_Card_Service SHALL return an HTTP 404 Not Found response without generating any PDF. IF a user supplies a patientId that exists in a different Tenant, THEN THE Medical_Card_Service SHALL also return an HTTP 404 Not Found response, in order to avoid revealing whether a patient record exists in another Tenant.

10. FOR ALL generated Medical Cards, the QR code SHALL encode the patientId and tenantId such that decoding the QR code and parsing the resulting JSON always returns the original patientId and tenantId values (round-trip correctness).

---

### Requirement 3: Patient Packages — Definition and Management

**User Story:** As a Hospital Admin or Admin, I want to create, update, and manage care/service packages, so that the hospital can offer standardised bundles of services to patients.

#### Acceptance Criteria

1. WHEN a Hospital_Admin or Admin user submits a create-package request containing all required fields, THE Package_Service SHALL create a Package record containing all of the following: a system-generated unique packageId, the requesting user's tenantId, name, description (optional, may be omitted), price (in INR), a non-empty list of included service descriptions, status set to ACTIVE, createdAt timestamp, and updatedAt timestamp.

2. THE Package_Service SHALL enforce the following validation rules on both create-package and update-package requests: (a) name must be between 1 and 200 characters inclusive; (b) description, if provided, must be between 0 and 500 characters inclusive; (c) price must be a non-negative decimal number (minimum 0.00 INR); (d) the includedServices array must contain at least 1 entry and no more than 50 entries; (e) each individual includedService description must be between 1 and 300 characters inclusive. IF any field fails validation, THE Package_Service SHALL return an HTTP 422 Unprocessable Entity response containing a descriptive error that identifies the failing field name and the specific constraint violated.

3. WHEN a Hospital_Admin or Admin user submits an update-package request for an existing Package within the same Tenant, THE Package_Service SHALL update the supplied fields (any subset of: name, description, price, includedServices, status), set the updatedAt timestamp to the current UTC time, and log an UPDATE audit entry that records the previous value and new value of each changed field.

4. THE Package_Service SHALL recognise exactly two valid Package status values: ACTIVE and INACTIVE. Any create or update request supplying any other status value SHALL be rejected with an HTTP 422 response.

5. WHEN a Package's status is set to INACTIVE, THE Package_Service SHALL prevent new Package_Assignments from referencing that Package. WHEN an assignment request references an INACTIVE Package, THE Package_Service SHALL return an HTTP 422 Unprocessable Entity response with a message stating "Package {packageId} is INACTIVE and cannot be assigned."

6. WHEN a Hospital_Admin, Admin, Manager, Finance_Manager, Receptionist, or Doctor requests a list of Packages within the same Tenant, THE Package_Service SHALL return Package records scoped to that tenantId, filterable by status (ACTIVE or INACTIVE), paginated with a maximum of 20 records per page, and ordered by createdAt descending. WHEN no status filter is applied, THE Package_Service SHALL return records of both statuses.

7. WHEN a user attempts to create or update a Package and the tenantId derived from the requesting user's JWT differs from any tenantId supplied in the request body, THE System SHALL return an HTTP 403 Forbidden response without creating or modifying any record.

8. THE Package_Service SHALL scope all create, read, update, and list operations exclusively to the tenantId extracted from the requesting user's JWT. Direct client-supplied tenantId values in request bodies SHALL be ignored in favour of the JWT-derived tenantId.

9. WHEN a Hospital_Admin or Admin user creates a Package successfully, THE Package_Service SHALL log a CREATE audit entry with entity type PACKAGE, the new packageId as the entityId, and the requesting user's userId as the actor.

10. IF a Hospital_Admin or Admin submits a create-package or update-package request with a package name that already exists within the same Tenant (comparison is case-insensitive and ignores leading/trailing whitespace), THEN THE Package_Service SHALL reject the request with an HTTP 409 Conflict response and a message stating "A package with this name already exists in this tenant."

11. IF a get-by-ID request references a packageId that does not exist within the requesting user's tenantId, THEN THE Package_Service SHALL return an HTTP 404 Not Found response.

12. FOR ALL valid create-package requests where all validation rules pass, the resulting Package record SHALL have status ACTIVE, a non-null packageId, a non-null tenantId equal to the requesting user's tenantId, and both createdAt and updatedAt set to the same UTC timestamp at creation time.

---

### Requirement 4: Package Assignment to Patients

**User Story:** As a Receptionist, Admin, or Doctor, I want to assign one or more packages to a patient, so that the patient's care plan is documented and associated services can be tracked.

#### Acceptance Criteria

1. WHEN a Receptionist, Admin, Hospital_Admin, or Doctor submits a package assignment request with a valid patientId and packageId within the same Tenant, THE Package_Service SHALL create a Package_Assignment record containing all of the following: a system-generated unique assignmentId, the requesting user's tenantId, the supplied patientId, the supplied packageId, assigned date defaulting to the current UTC date if not supplied, the requesting user's userId as assignedBy, and status ACTIVE.

2. WHEN a Package_Assignment is being created, THE Package_Service SHALL verify that both the patient record and the Package record carry a tenantId equal to the requesting user's tenantId. IF either record's tenantId does not match, THE System SHALL return an HTTP 403 Forbidden response without creating any assignment record.

3. IF the packageId supplied in an assignment request does not exist within the requesting user's tenantId, THEN THE Package_Service SHALL return an HTTP 404 Not Found response with a message identifying the packageId as not found in this Tenant.

4. IF the patientId supplied in an assignment request does not exist within the requesting user's tenantId, THEN THE Package_Service SHALL return an HTTP 404 Not Found response with a message identifying the patientId as not found in this Tenant.

5. WHEN a user submits an assignment request for a Package whose status is INACTIVE, THE Package_Service SHALL reject the request and return an HTTP 422 Unprocessable Entity response with a message stating "Package {packageId} is no longer active and cannot be assigned."

6. THE Package_Service SHALL permit a patient to hold multiple simultaneous ACTIVE Package_Assignments for different packages. IF a user submits an assignment request for a packageId that already has an ACTIVE Package_Assignment for the same patientId within the same Tenant, THEN THE Package_Service SHALL return an HTTP 409 Conflict response with a message stating "An active assignment already exists for this patient and package" and including the existing assignmentId.

7. WHEN a Receptionist, Admin, Hospital_Admin, Manager, Finance_Manager, or Doctor requests the list of Package_Assignments for a patientId within the same Tenant, THE Package_Service SHALL return all Package_Assignment records for that patient ordered by assignedDate descending. IF no assignments exist, THE Package_Service SHALL return an empty array (not an error).

8. WHEN a Receptionist, Admin, or Hospital_Admin submits a cancellation request for a Package_Assignment within the same Tenant, THE Package_Service SHALL transition the assignment status from ACTIVE to CANCELLED, record the cancelling user's userId as cancelledBy, and record the cancellation timestamp as cancelledAt.

9. IF a user submits a cancellation request for a Package_Assignment whose current status is not ACTIVE, THEN THE Package_Service SHALL return an HTTP 409 Conflict response with a message stating "Assignment {assignmentId} cannot be cancelled because it is already {currentStatus}."

10. WHEN a Package_Assignment is created, THE Package_Service SHALL log a CREATE audit entry with entity type PACKAGE_ASSIGNMENT and the assignmentId as the entityId. WHEN a Package_Assignment is cancelled, THE Package_Service SHALL log an UPDATE audit entry with entity type PACKAGE_ASSIGNMENT, the assignmentId as the entityId, previousValue of `{status: "ACTIVE"}`, and newValue of `{status: "CANCELLED", cancelledBy, cancelledAt}`.

11. FOR ALL Package_Assignments lists returned for a given patientId, the records SHALL be ordered strictly by assignedDate descending, and at most one record per (patientId, packageId) pair SHALL have status ACTIVE at any point in time.

---

### Requirement 5: Staff Document Onboarding

**User Story:** As an HR user or Hospital Admin, I want to upload and manage compliance documents for staff members during and after onboarding, so that all required credentials and identity documents are stored securely and can be reviewed at any time.

#### Acceptance Criteria

1. WHEN an HR user or Hospital_Admin uploads a document for a staff member within the same Tenant, THE Document_Service SHALL create a Staff_Document record containing all of the following: a system-generated unique documentId, the requesting user's tenantId, the target staff member's userId, document category (exactly one of: AADHAAR, PAN, MEDICAL_REGISTRATION, DEGREE_CERTIFICATE, OTHER), document name (1–200 characters, required), the S3 key of the uploaded file, upload timestamp (UTC), and the uploading user's userId as uploadedBy.

2. THE Document_Service SHALL accept file uploads with MIME types `application/pdf`, `image/jpeg`, and `image/png` only. MIME type SHALL be verified from the file's magic bytes, not solely from the declared Content-Type header. IF a file's detected MIME type is not in the accepted set, THE Document_Service SHALL reject the upload with an HTTP 422 Unprocessable Entity response stating that the format is not supported and listing the accepted formats (PDF, JPEG, PNG).

3. THE Document_Service SHALL enforce a maximum file size of 10 MB (10,485,760 bytes) per document. IF the uploaded file's byte count exceeds 10,485,760, THE Document_Service SHALL reject the upload with an HTTP 413 Payload Too Large response indicating the file exceeds the 10 MB limit.

4. WHEN a Staff_Document file is accepted and stored, THE Document_Service SHALL use the S3 key pattern `tenants/{tenantId}/staff-documents/{userId}/{documentId}.{ext}`, where `{ext}` is the lowercase file extension derived from the accepted MIME type: `pdf` for `application/pdf`, `jpg` for `image/jpeg`, and `png` for `image/png`.

5. WHEN an HR user or Hospital_Admin requests the list of documents for a staff member within the same Tenant, THE Document_Service SHALL return all Staff_Document records for that userId where `isDeleted` is false and tenantId matches the requesting user's tenantId. Each returned record SHALL include a Pre-signed URL for the corresponding S3 object valid for exactly 1 hour. IF the target staff member's userId belongs to a tenantId that differs from the requesting user's tenantId, THE System SHALL return an HTTP 403 Forbidden response without returning any document records.

6. WHEN an HR user or Hospital_Admin submits a soft-delete request for a Staff_Document record within the same Tenant, THE Document_Service SHALL set `isDeleted` to `true`, record the requesting user's userId as deletedBy, and record the deletion UTC timestamp as deletedAt. Soft-deleted documents SHALL be excluded from all list results returned by AC-5, but the corresponding S3 object SHALL NOT be deleted. IF the Staff_Document record's tenantId differs from the requesting user's tenantId, THE System SHALL return an HTTP 403 Forbidden response without modifying any record.

7. WHEN a user attempts to upload documents for a staff member whose userId belongs to a different Tenant, THE System SHALL return an HTTP 403 Forbidden response without creating any record or storing any file.

8. IF an HR user or Hospital_Admin submits an upload request for a staff member who already has 20 non-deleted Staff_Document records in the same Document_Category within the same Tenant, THEN THE Document_Service SHALL reject the upload with an HTTP 422 Unprocessable Entity response indicating the maximum of 20 documents has been reached for that category.

9. WHEN a Staff_Document record is created, THE Document_Service SHALL log a CREATE audit entry with entity type STAFF_DOCUMENT and the documentId as the entityId before returning a success response. WHEN a Staff_Document record is soft-deleted, THE Document_Service SHALL log an UPDATE audit entry with entity type STAFF_DOCUMENT and the documentId as the entityId before returning a success response. IF the audit log operation fails, THE Document_Service SHALL abort the create or soft-delete operation, return an HTTP 500 response, and SHALL NOT persist the primary record change.

10. WHEN an HR user or Hospital_Admin requests the onboarding checklist summary for a staff member within the same Tenant, THE Document_Service SHALL return a summary object for each Document_Category value containing: the category name, and a status of "complete" if at least one non-deleted Staff_Document exists for that category and userId, or "missing" if no such document exists. IF the requesting user's tenantId does not match the target staff member's tenantId, THE System SHALL return an HTTP 403 Forbidden response without returning any status data.

11. IF an HR user or Hospital_Admin submits an upload request where the document name is an empty string or a string exceeding 200 characters, THEN THE Document_Service SHALL reject the request with an HTTP 422 Unprocessable Entity response stating "documentName must be between 1 and 200 characters."

12. IF an HR user or Hospital_Admin submits a soft-delete request for a Staff_Document record where `isDeleted` is already `true`, THEN THE Document_Service SHALL return an HTTP 409 Conflict response with a message stating "Document {documentId} has already been deleted."

13. FOR ALL file uploads accepted by the Document_Service, the S3 key generated per AC-4 SHALL be unique per documentId and SHALL follow the pattern `tenants/{tenantId}/staff-documents/{userId}/{documentId}.{ext}` exactly, with no path traversal characters, regardless of the values of tenantId, userId, or documentId.

---

### Requirement 6: Patient Billing and Charges

**User Story:** As a Doctor, Nurse, Receptionist, Admin, or Hospital Admin, I want to record itemised charges for services rendered to a patient during OPD visits, IPD admissions, or lab requests, so that a consolidated and accurate bill can be generated for the patient.

#### Acceptance Criteria

1. WHEN an authorised user adds a Charge for a patient within the same Tenant, THE Charge_Service SHALL create a Charge record containing all of the following: a system-generated unique chargeId, the requesting user's tenantId, the supplied patientId, charge category (exactly one of: CONSULTATION, IPD_BED, NURSING, LAB_TEST, PROCEDURE, MEDICATION, PACKAGE, OTHER), charge description (free-text, 1–500 characters), amount (in INR, minimum 0.01, maximum 999,999,999.99), an optional encounter reference (visitId for OPD visits or admissionId for IPD admissions), the requesting user's userId as addedBy, status UNPAID, and a createdAt timestamp.

2. THE Charge_Service SHALL enforce the following role-to-category permission rules when processing add-charge requests: Doctor may add charges of category CONSULTATION and PROCEDURE only; Nurse may add charges of category NURSING only; Pathologist may add charges of category LAB_TEST only; Radiologist may add charges of category LAB_TEST only; Receptionist may add charges of category CONSULTATION, PROCEDURE, LAB_TEST, MEDICATION, PACKAGE, and OTHER; Admin and Hospital_Admin may add charges of any category. IF a user attempts to add a Charge of a category not in the set permitted for their role, THE Charge_Service SHALL return an HTTP 403 Forbidden response with a message identifying the user's role and the disallowed category.

3. WHEN a user attempts to add a Charge for a patient whose tenantId differs from the requesting user's tenantId, THE System SHALL return an HTTP 403 Forbidden response without creating any Charge record.

4. IF a user submits a create-charge request where the amount is less than 0.01 INR, is negative, or exceeds 999,999,999.99 INR, THEN THE Charge_Service SHALL reject the request with an HTTP 422 Unprocessable Entity response identifying the amount field and the violated constraint. IF a user submits a create-charge request where the description is an empty string or exceeds 500 characters, THEN THE Charge_Service SHALL reject the request with an HTTP 422 Unprocessable Entity response identifying the description field and the violated constraint.

5. WHEN a Receptionist, Admin, Hospital_Admin, Manager, Finance_Manager, Doctor, Nurse, Pathologist, or Radiologist requests the Bill for a patientId within the same Tenant, THE Charge_Service SHALL return a Bill containing: all non-voided Charge records for that patient grouped by charge category, a subtotal (sum of amounts) per category, and a grand total equal to the sum of all category subtotals. IF the requesting user's tenantId does not match the target patient's tenantId, THE System SHALL return an HTTP 403 Forbidden response. IF the patientId does not exist within the requesting user's tenantId, THE Charge_Service SHALL return an HTTP 404 Not Found response.

6. WHEN a Receptionist, Admin, or Hospital_Admin submits a void request for a Charge within the same Tenant, THE Charge_Service SHALL transition the Charge status from UNPAID to VOIDED, record the voiding user's userId as voidedBy, record the void UTC timestamp as voidedAt, and exclude the voided Charge from all subsequent Bill calculations. WHEN a user whose role is not Receptionist, Admin, or Hospital_Admin submits a void request, THE Charge_Service SHALL return an HTTP 403 Forbidden response without modifying any Charge record. IF a void request targets a Charge that is already VOIDED, THE Charge_Service SHALL return an HTTP 409 Conflict response. WHEN a Charge is voided by a user other than the user who originally added the Charge, THE Charge_Service SHALL create an in-app notification for the original charge creator (addedBy userId) containing: the chargeId, the charge description, the charge amount, the name of the voiding user, and the voidedAt timestamp. A Doctor, Nurse, Pathologist, or Radiologist SHALL NOT be permitted to void charges they created themselves; the restriction applies to all users whose role is not Receptionist, Admin, or Hospital_Admin regardless of charge ownership.

7. WHEN a Manager, Finance_Manager, Admin, or Hospital_Admin requests a list of Charges for the Tenant, THE Charge_Service SHALL return Charge records filterable by any combination of: patientId, charge category, charge creation date range (startDate inclusive, endDate inclusive), and addedBy userId. Results SHALL be paginated with a maximum of 20 records per page and ordered by createdAt descending.

8. WHEN a Package_Assignment record is created for a patient and the associated Package has a price of at least 0.01 INR, THE Charge_Service SHALL automatically create a Charge record with: category PACKAGE, amount equal to the Package's price, description equal to the Package's name, patientId from the assignment, and encounter reference set to the assignmentId. IF the Package price is less than 0.01 INR (including 0.00), THE Charge_Service SHALL NOT create an automatic Charge and SHALL log a warning entry including the packageId, assignmentId, and the package price.

9. WHEN a Charge is created or voided, THE Charge_Service SHALL log the corresponding CREATE or UPDATE audit entry with entity type CHARGE and the chargeId as the entityId before returning a success response.

10. THE Charge_Service SHALL expose a bill-summary endpoint that returns: all Charge line items for the patient (including voided, for display) ordered by createdAt descending, total charges grouped by category (excluding VOIDED charges), and a grand total excluding VOIDED charges. WHEN a Charge status transitions from UNPAID to VOIDED, THE Charge_Service SHALL recalculate the affected category subtotal and the grand total to exclude the voided amount; the recalculated totals SHALL equal the sum of all remaining UNPAID Charges.

11. FOR ALL Bill responses, the grand total SHALL equal the arithmetic sum of all category subtotals, and each category subtotal SHALL equal the sum of amounts of all non-voided Charges in that category for the patient. This invariant SHALL hold regardless of the number of Charges, the mix of categories, or the order in which Charges were created or voided.

---

## Non-Functional Requirements

### NFR-A: Multi-Tenancy

THE System SHALL include a `tenantId` field in all new MongoDB collections (packages, package_assignments, charges, staff_documents, staff_id_cards). All queries against these collections SHALL include `tenantId` as a mandatory filter applied at the data-access layer, consistent with FR-02.

### NFR-B: Audit Trail

All create, update (including soft-delete, cancellation, and void), and regenerate operations on new entities SHALL produce audit log entries via the existing `auditService.log()` function, consistent with FR-14. The new entity types STAFF_ID_CARD, PACKAGE, PACKAGE_ASSIGNMENT, STAFF_DOCUMENT, and CHARGE SHALL be added to the `AuditEntityType` enum. Audit log failures for Staff_Document operations SHALL abort the triggering operation (Requirement 5, AC-9).

### NFR-C: File Storage

All new generated files (Staff ID Card PDFs, Patient Medical Card PDFs, staff compliance documents) SHALL be stored in AWS S3. Files SHALL be served exclusively via Pre-signed URLs with the expiry periods defined per requirement. S3 objects SHALL block public access, consistent with NFR-09.

### NFR-D: Performance

All new API endpoints SHALL respond within 500 ms at the 95th percentile under a sustained load of up to 50 concurrent requests. New MongoDB collections SHALL carry compound indexes with `tenantId` as the leading key, consistent with NFR-01.

### NFR-E: Security

All new endpoints SHALL require JWT authentication and tenant-scoped authorization verified at the data-access layer. All request body and query parameter inputs SHALL be validated using Zod schemas before processing. No stack traces or internal error details SHALL be exposed in production error responses, consistent with NFR-02 and the Security Baseline.

### NFR-F: Input Validation

All monetary amounts SHALL be stored and compared as decimal values with exactly 2 decimal places of precision to avoid floating-point rounding errors. Validation SHALL occur at the API boundary using Zod and SHALL be re-enforced at the service layer before any database write.

### NFR-G: Role-Permission Matrix (additions)

The updated role-permission matrix for new modules is:

| Module | Hospital Admin | Admin | Manager | Finance Manager | Doctor | Nurse | Pathologist | Radiologist | Receptionist | HR |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Staff ID Cards | ✓ | | | | | | | | | ✓ |
| Medical Card Redesign | ✓ | ✓ | ✓ | | | | | | ✓ | |
| Package Management (write) | ✓ | ✓ | | | | | | | | |
| Package Management (read) | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ | |
| Package Assignment (write) | ✓ | ✓ | | | ✓ | | | | ✓ | |
| Package Assignment (read) | ✓ | ✓ | ✓ | ✓ | ✓ | | | | ✓ | |
| Package Assignment (cancel) | ✓ | ✓ | | | | | | | ✓ | |
| Staff Documents | ✓ | | | | | | | | | ✓ |
| Patient Billing — Add Charges | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Patient Billing — View Bill | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Patient Billing — Void Charges | ✓ | ✓ | | | | | | | ✓ | |
| Patient Billing — List All Charges | ✓ | ✓ | ✓ | ✓ | | | | | | |
