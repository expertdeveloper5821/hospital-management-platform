# Implementation Plan: Hospital Features Enhancement

## Overview

Implement six hospital platform enhancements across four new backend modules (`staff-id-card`, `packages`, `staff-documents`, `charges`) plus in-place enhancement to the existing `patient` module. The frontend receives four new RTK Query API slices, new Next.js App Router pages, and sidebar navigation updates. All modules follow the established `model → repository → service → controller → routes` stack with Zod validation, tenant-scoped queries, `auditService.log()` for mutations, and S3/pre-signed URLs for file operations.

The implementation language is **TypeScript** (matching the existing codebase).

---

## Tasks

---

### 0. Prerequisites — Install Required npm Packages

- [ ] 0.1 Install server-side production dependencies
  - Run in `server/`: `npm install pdfkit qrcode multer uuid`
  - Run in `server/`: `npm install -D @types/pdfkit @types/qrcode @types/multer @types/uuid`
  - Verify all packages resolve without peer-dependency conflicts
  - _Requirements: 1.1 (PDFKit), 2.1 (PDFKit + qrcode), 5.1 (multer), all modules (uuid)_

- [ ] 0.2 Install property-based testing library
  - Run in `server/`: `npm install -D fast-check`
  - Verify `fast-check` is listed under `devDependencies` in `server/package.json`
  - _Requirements: PBT properties 1–17_

---

### 1. Shared Foundation — Types, Error Classes, and Utilities

- [ ] 1.1 Extend server shared types with new AuditEntityType values
  - Open `server/src/shared/types/common.types.ts`
  - Add five new keys to the `AuditEntityType` const object: `STAFF_ID_CARD`, `PACKAGE`, `PACKAGE_ASSIGNMENT`, `STAFF_DOCUMENT`, `CHARGE`
  - The new values must be string literals matching the key name exactly
  - _Requirements: NFR-B, 1.7, 3.9, 4.10, 5.9, 6.9_

- [ ] 1.2 Add `ForbiddenError` to shared error-handler middleware
  - Open `server/src/shared/middleware/error-handler.ts`
  - Add `export class ForbiddenError extends AppError { constructor(message = 'Forbidden') { super(message, 403); } }`
  - Ensure the global error handler already handles `AppError` subclasses (it does — verify `statusCode` is forwarded)
  - _Requirements: 1.4, 1.8, 2.8, 3.7, 4.2, 5.7, 6.3, 6.6_

- [ ] 1.3 Extend client shared types in `client/store/types.ts`
  - Add `'STAFF_ID_CARD'`, `'PACKAGE'`, `'PACKAGE_ASSIGNMENT'`, `'STAFF_DOCUMENT'`, `'CHARGE'` to the `AuditEntityTypes` array
  - Add all new response/request type interfaces from the design document's "Shared Type Updates" section:
    - `PackageStatus`, `AssignmentStatus`, `PackageResponse`, `CreatePackageRequest`, `UpdatePackageRequest`, `AssignmentResponse`, `AssignPackageRequest`, `PackageListResult`
    - `ChargeCategory`, `ChargeStatus`, `ChargeResponse`, `AddChargeRequest`, `BillResponse`, `ChargeListResult`
    - `DocumentCategory`, `StaffDocumentResponse`, `ChecklistItem`
    - `StaffIdCardResponse`
  - _Requirements: NFR-B_

- [ ] 1.4 Add new RTK Query tag types to `client/store/api/base.api.ts`
  - Add `'Package'`, `'PackageAssignment'`, `'Charge'`, `'Bill'`, `'StaffDocument'`, `'StaffIdCard'` to the `tagTypes` array in `createApi`
  - _Requirements: NFR-B (frontend cache management)_

- [ ]* 1.5 Write unit tests for the `ForbiddenError` class
  - Verify `new ForbiddenError().message === 'Forbidden'` and `statusCode === 403`
  - Verify custom message is preserved: `new ForbiddenError('Cross-tenant access').message === 'Cross-tenant access'`
  - _Requirements: 1.4, 1.8_

---

### 2. Staff ID Card Module — Backend

- [ ] 2.1 Create `StaffIdCardModel` in `server/src/modules/staff-id-card/staff-id-card.model.ts`
  - Define `IStaffIdCard` interface with fields: `tenantId`, `userId`, `s3Key`, `issuedAt`, `expiresAt`, `createdAt`, `updatedAt`
  - Define `StaffIdCardSchema` with required field constraints per the design document
  - Add compound unique index `{ tenantId: 1, userId: 1 }` (NFR-01: tenantId first)
  - Export `StaffIdCardModel`
  - _Requirements: 1.1, 1.3, 1.6, 1.7_

- [ ] 2.2 Create `StaffIdCardRepository` in `server/src/modules/staff-id-card/staff-id-card.repository.ts`
  - Implement `findByUserId(tenantId: string, userId: string): Promise<IStaffIdCard | null>`
  - Implement `upsert(tenantId: string, userId: string, data: Partial<IStaffIdCard>): Promise<IStaffIdCard>` using `findOneAndUpdate` with `upsert: true`
  - All queries must include `tenantId` as a mandatory filter
  - Export singleton `staffIdCardRepository`
  - _Requirements: 1.1, 1.3, 1.6, NFR-A_

- [ ] 2.3 Create `StaffIdCardPdfBuilder` in `server/src/modules/staff-id-card/staff-id-card.pdf.ts`
  - Implement `buildPdfBuffer(drawFn: (doc: PDFKit.PDFDocument) => void): Promise<Buffer>` using PDFKit in-memory buffer (no filesystem writes)
  - Implement `buildStaffIdCardPdf(options: StaffIdCardPdfOptions): Promise<Buffer>` with A6 landscape page (148×105 mm), top color band, logo area, photo/silhouette area, fields (name, role, department, employee ID), footer band with issued/expires dates
  - If `logoUrl` is null or fetch fails, leave logo area blank and continue (do not abort)
  - If `profileImageUrl` is null or fetch fails, render a 60×70 grey rectangle as placeholder silhouette
  - Render dates as UTC ISO strings sliced to 10 chars: `date.toISOString().slice(0, 10)`
  - Implement pure helper `computeExpiryDate(issuedAt: Date): Date` returning `new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000)`
  - Implement pure helper `buildS3Key(tenantId: string, userId: string): string` returning `tenants/${tenantId}/staff-id-cards/${userId}.pdf`
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.11_

- [ ] 2.4 Create `StaffIdCardService` in `server/src/modules/staff-id-card/staff-id-card.service.ts`
  - Follow the `OPDService` class pattern with singleton export
  - Implement `generate(tenantId: string, userId: string, requesterId: string): Promise<StaffIdCardResult>`
  - Inside `generate`: look up user by `(tenantId, userId)` via `userRepository` → throw `NotFoundError` if absent; fetch tenant branding from `TenantModel`; check if `staff_id_cards` record exists to determine CREATE vs UPDATE audit action; build PDF via `StaffIdCardPdfBuilder`; upload to S3; upsert record; `auditService.log`; generate 24-hour pre-signed URL and return
  - Wrap S3 `putObject` in try/catch — throw `HttpError(502, 'File storage operation failed.')` on failure
  - `computeIssuedAt()`: returns `new Date()` normalized to UTC midnight
  - Export singleton `staffIdCardService`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 1.10, 1.11_

- [ ] 2.5 Create `StaffIdCardController` in `server/src/modules/staff-id-card/staff-id-card.controller.ts`
  - Implement `POST /:userId/generate` handler
  - Extract `tenantId` and `userId` (requester) from `req.user`
  - Compare `req.params.userId` against the requester's `tenantId` via user lookup — throw `ForbiddenError` if target user belongs to a different tenant
  - Delegate to `staffIdCardService.generate`
  - Return `201` on first generation, `200` on regeneration (service returns a flag)
  - Use Zod to validate `req.params.userId` is a non-empty string
  - _Requirements: 1.4, 1.8, 1.9, 1.10_

- [ ] 2.6 Create `StaffIdCardRouter` in `server/src/modules/staff-id-card/staff-id-card.routes.ts`
  - Use `protect` middleware chain: `[authenticateJWT, scopeTenant, requireFirstPasswordChange]`
  - Add `requireRole(['HOSPITAL_ADMIN', 'HR'])` guard on the generate route
  - Mount `POST /:userId/generate` → controller handler
  - Export `staffIdCardRouter`
  - _Requirements: 1.4, 1.8_

- [ ]* 2.7 Write unit tests for `StaffIdCardService` pure helpers
  - Test `computeExpiryDate` with Jan 1, Feb 28/29 (leap year), Dec 31 as issuedAt — verify exact 365-day millisecond arithmetic
  - Test `buildS3Key` returns the correct pattern for arbitrary tenantId/userId strings
  - Test audit action selection: mock `staffIdCardRepository.findByUserId` returning null → expect `'CREATE'`; returning a record → expect `'UPDATE'`
  - _Requirements: 1.3, 1.7, 1.11_

- [ ]* 2.8 Write property test for expiry date arithmetic (Property 4)
  - **Property 4: Expiry date is exactly 365 days after issue date**
  - **Validates: Requirement 1.11**
  - Use `fc.date()` to generate arbitrary UTC dates; assert `computeExpiryDate(d).getTime() === d.getTime() + 365*24*60*60*1000`
  - Run minimum 100 iterations

---

### 3. Staff ID Card Module — Frontend

- [ ] 3.1 Create `client/store/api/staffIdCards.api.ts`
  - Inject into `baseApi` with endpoint `generateStaffIdCard: build.mutation<StaffIdCardResponse, string>` — POST to `/api/staff-id-cards/${userId}/generate`
  - Add `transformResponse` unwrapping `ApiSuccess<StaffIdCardResponse>` → `raw.data`
  - Add `invalidatesTags: ['StaffIdCard']`
  - Export `useGenerateStaffIdCardMutation`
  - _Requirements: 1.1, 1.3_

- [ ] 3.2 Create staff ID card page at `client/app/(dashboard)/staff/[userId]/id-card/page.tsx`
  - Role-gate: accessible to `HOSPITAL_ADMIN` and `HR` only (check `profile.role` from Redux store; redirect to `/dashboard` otherwise)
  - Display current card details if available (userId, issuedAt, cardExpiresAt from query result)
  - Provide "Generate / Regenerate ID Card" button that calls `useGenerateStaffIdCardMutation`
  - On success, show a clickable download link using the `presignedUrl` from the response
  - Handle loading and error states with accessible UI feedback
  - _Requirements: 1.1, 1.3, 1.4, 1.8_

- [ ] 3.3 Update sidebar navigation
  - Open `client/components/shared/Sidebar.tsx`
  - Import `FileBadge`, `Receipt`, `FolderOpen`, `Gift` from `lucide-react` (four new icons)
  - Add all four entries to `ICON_MAP`: `'file-badge': FileBadge`, `'receipt': Receipt`, `'folder-open': FolderOpen`, `'gift': Gift`
  - Open `client/lib/rbac-nav.ts`
  - Add `{ label: 'Staff Docs', href: '/staff', icon: 'folder-open' }` to the `HR` nav array
  - Add `{ label: 'Packages', href: '/packages', icon: 'gift' }` to nav arrays for `HOSPITAL_ADMIN`, `ADMIN`, `MANAGER`, `FINANCE_MANAGER`, `DOCTOR`, and `RECEPTIONIST`
  - Add `{ label: 'Billing', href: '/billing', icon: 'receipt' }` to nav arrays for `HOSPITAL_ADMIN`, `ADMIN`, `MANAGER`, and `FINANCE_MANAGER`
  - _Requirements: NFR-G (frontend role-based navigation)_

---

### 4. Patient Medical Card Redesign — Backend

- [ ] 4.1 Create `MedicalCardPdfBuilder` in `server/src/modules/patient/medical-card.pdf.ts`
  - Implement `buildMedicalCardPdf(patient: IPatient, tenantBranding: BrandingConfig): Promise<Buffer>` using PDFKit
  - Page size: 85.6×54 mm at 300 DPI landscape (243×153 points)
  - Top header band using `tenant.branding.primaryColor` or fallback `'#2563EB'`
  - Logo top-left (24×24); hospital display name; patient fields: full name, patientId, date of birth, gender, mobile number, card generation date (UTC)
  - Include optional fields only when non-null: blood group, Aadhaar (masked), emergency contact name, emergency contact mobile
  - Implement `maskAadhaar(aadhaar: string): string` — returns `'XXXX-XXXX-' + aadhaar.replace(/\D/g, '').slice(-4)`
  - Generate QR code using `qrcode` npm package: `await QRCode.toBuffer(JSON.stringify({ patientId, tenantId }), { type: 'png' })` — if QR generation throws, abort and rethrow (service will return 500)
  - Bottom footer band with generation date
  - Do not write to filesystem; buffer only
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [ ] 4.2 Update `patient.service.ts` to use the new `MedicalCardPdfBuilder`
  - Locate the existing `generateMedicalCard` method (or equivalent) in `server/src/modules/patient/patient.service.ts`
  - Replace the existing PDF generation logic with a call to `MedicalCardPdfBuilder.buildMedicalCardPdf`
  - Fetch tenant branding from `TenantModel` using the patient's `tenantId`
  - Apply `primaryColor` from branding or fallback to `'#2563EB'`
  - Check if S3 object already exists at the existing key to determine CREATE vs UPDATE audit action (entity type `AuditEntityType.PATIENT`)
  - Keep the S3 key pattern and endpoint path identical to the existing implementation (must not break existing links)
  - Wrap S3 `putObject` in try/catch → throw `HttpError(502)` on failure
  - Return 24-hour pre-signed URL
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [ ]* 4.3 Write unit tests for `MedicalCardPdfBuilder` pure helpers
  - Test `maskAadhaar('123456789012')` → `'XXXX-XXXX-9012'`
  - Test `maskAadhaar('1234-5678-9012')` → `'XXXX-XXXX-9012'` (ignores non-digit chars)
  - Test `maskAadhaar` with leading zeros: `'000000000001'` → `'XXXX-XXXX-0001'`
  - Test QR code round-trip: encode `{ patientId: 'PAT-1', tenantId: 'TEN-1' }` → decode → assert equality
  - _Requirements: 2.2, 2.3, 2.10_

- [ ]* 4.4 Write property tests for Medical Card PDF builder (Properties 5 and 6)
  - **Property 5: Aadhaar masking preserves only last 4 digits**
  - **Validates: Requirement 2.2**
  - Use `fc.stringMatching(/^\d{12,}$/)` for Aadhaar inputs; assert output matches `XXXX-XXXX-{last4}` pattern and original digits 1-8 are absent
  - **Property 6: QR code round-trip correctness**
  - **Validates: Requirements 2.3, 2.10**
  - Use `fc.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }))` for `(patientId, tenantId)` pairs; assert decoded JSON contains exactly these two keys with original values
  - Run minimum 100 iterations each

---

### 5. Patient Packages Module — Backend (Package Definitions)

- [ ] 5.1 Create `PackageModel` in `server/src/modules/packages/packages.model.ts`
  - Define `IPackage` interface with fields: `packageId`, `tenantId`, `name`, `description`, `price`, `includedServices`, `status`, `isDeleted`, `createdAt`, `updatedAt`
  - Define `PackageSchema` with constraints: name trim/maxlength 200, description nullable/maxlength 500, price min 0, includedServices array, status enum `['ACTIVE','INACTIVE']`
  - Add compound unique index `{ tenantId: 1, packageId: 1 }`; add `{ tenantId: 1, status: 1, createdAt: -1 }`; add `{ tenantId: 1, name: 1 }` for duplicate name detection
  - Export `PackageModel`
  - _Requirements: 3.1, 3.2, 3.4, NFR-A, NFR-D_

- [ ] 5.2 Create `PackageRepository` in `server/src/modules/packages/packages.repository.ts`
  - Implement `save(data: Partial<IPackage>): Promise<IPackage>`
  - Implement `findById(tenantId: string, packageId: string): Promise<IPackage | null>`
  - Implement `findByName(tenantId: string, name: string): Promise<IPackage | null>` — case-insensitive search using regex
  - Implement `update(tenantId: string, packageId: string, data: Partial<IPackage>): Promise<IPackage | null>`
  - Implement `list(tenantId: string, filters: PackageListFilters): Promise<PaginatedResult<IPackage>>` — filter by `status`, paginate max 20, sort `createdAt: -1`
  - All queries scope to `tenantId` and exclude `isDeleted: true`
  - Export singleton `packageRepository`
  - _Requirements: 3.1, 3.6, 3.8, NFR-A_

- [ ] 5.3 Create `PackageModel` for assignments in `server/src/modules/packages/package-assignment.model.ts`
  - Define `IPackageAssignment` interface and `PackageAssignmentSchema` per the design document
  - Add indexes: `{ tenantId: 1, assignmentId: 1 }` unique, `{ tenantId: 1, patientId: 1, assignedDate: -1 }`, `{ tenantId: 1, patientId: 1, packageId: 1, status: 1 }`
  - Export `PackageAssignmentModel`
  - _Requirements: 4.1, 4.6, 4.11, NFR-A, NFR-D_

- [ ] 5.4 Create `PackageAssignmentRepository` in `server/src/modules/packages/package-assignment.repository.ts`
  - Implement `save(data: Partial<IPackageAssignment>): Promise<IPackageAssignment>`
  - Implement `findById(tenantId: string, assignmentId: string): Promise<IPackageAssignment | null>`
  - Implement `findActiveAssignment(tenantId: string, patientId: string, packageId: string): Promise<IPackageAssignment | null>` — query where status = 'ACTIVE'
  - Implement `update(tenantId: string, assignmentId: string, data: Partial<IPackageAssignment>): Promise<IPackageAssignment | null>`
  - Implement `findByPatient(tenantId: string, patientId: string): Promise<IPackageAssignment[]>` — sorted by `assignedDate: -1`
  - All queries scope to `tenantId`
  - Export singleton `packageAssignmentRepository`
  - _Requirements: 4.1, 4.6, 4.7, 4.11, NFR-A_

- [ ] 5.5 Create `PackageService` in `server/src/modules/packages/packages.service.ts`
  - Implement `createPackage(tenantId, data, createdBy)`: normalize name (`trim().toLowerCase()`) for duplicate check; throw `ConflictError` with message "A package with this name already exists in this tenant." if found; generate `packageId = 'PKG-' + uuidv4().replace(/-/g,'').substring(0,8).toUpperCase()`; save; `auditService.log(CREATE, PACKAGE)`
  - Implement `updatePackage(tenantId, packageId, data, updatedBy)`: fetch or throw `NotFoundError`; duplicate name check (excluding self); build `previousValue`/`newValue` diffs; save; `auditService.log(UPDATE, PACKAGE)`
  - Implement `getPackageById(tenantId, packageId)`: fetch or throw `NotFoundError`
  - Implement `listPackages(tenantId, filters)`: delegate to repository
  - Implement `assignPackage(tenantId, packageId, data, assignedBy)`: fetch package (NotFoundError if absent; 422 if INACTIVE); fetch patient (NotFoundError); check for duplicate ACTIVE assignment (ConflictError with message "An active assignment already exists for this patient and package" including existing assignmentId); create assignment; `auditService.log(CREATE, PACKAGE_ASSIGNMENT)`; call `chargeService.createPackageCharge` wrapped in try/catch (log warn on failure, do not rethrow)
  - Implement `cancelAssignment(tenantId, assignmentId, cancelledBy)`: fetch; throw ConflictError if not ACTIVE ("Assignment {assignmentId} cannot be cancelled because it is already {currentStatus}."); update to CANCELLED; `auditService.log(UPDATE, PACKAGE_ASSIGNMENT)`
  - Implement `listAssignmentsByPatient(tenantId, patientId)`: return all assignments sorted by `assignedDate: -1`
  - Export singleton `packageService`
  - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.8, 3.9, 3.10, 3.11, 4.1, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

- [ ] 5.6 Create `PackageController` in `server/src/modules/packages/packages.controller.ts`
  - Implement handlers for all 6 package+assignment endpoints (create package, list packages, get package by ID, update package, assign package, cancel assignment)
  - Use Zod schemas to validate request bodies:
    - `createPackageSchema`: name 1-200 chars, description optional 0-500 chars, price `z.number().min(0)`, includedServices array min 1 max 50 items each 1-300 chars
    - `updatePackageSchema`: all fields optional, same constraints
    - `assignPackageSchema`: patientId required string, assignedDate optional YYYY-MM-DD string
  - Extract `tenantId` and `userId` from `req.user` (JWT payload); ignore any tenantId in request body
  - _Requirements: 3.2, 3.4, 3.7, 3.8, 4.1, 4.8_

- [ ] 5.7 Create `PackagesRouter` in `server/src/modules/packages/packages.routes.ts`
  - Use `protect` middleware chain on all routes
  - `POST /` — `requireRole(['HOSPITAL_ADMIN','ADMIN'])` → createPackage
  - `GET /` — `requireRole(['HOSPITAL_ADMIN','ADMIN','MANAGER','FINANCE_MANAGER','RECEPTIONIST','DOCTOR'])` → listPackages
  - `GET /:packageId` — same roles as GET list → getPackage
  - `PATCH /:packageId` — `requireRole(['HOSPITAL_ADMIN','ADMIN'])` → updatePackage
  - `POST /:packageId/assignments` — `requireRole(['HOSPITAL_ADMIN','ADMIN','RECEPTIONIST','DOCTOR'])` → assignPackage
  - `PATCH /:packageId/assignments/:assignmentId/cancel` — `requireRole(['HOSPITAL_ADMIN','ADMIN','RECEPTIONIST'])` → cancelAssignment
  - Export `packagesRouter`
  - _Requirements: 3.7, 3.8, 4.1, 4.8, NFR-G_

- [ ]* 5.8 Write unit tests for `PackageService` business logic
  - Test duplicate name detection: mock `findByName` returning a record → expect `ConflictError`; mock returning null → expect record created
  - Test INACTIVE package guard in `assignPackage`: mock package with `status: 'INACTIVE'` → expect 422 ValidationError
  - Test duplicate active assignment guard: mock `findActiveAssignment` returning a record → expect `ConflictError` with existing `assignmentId`
  - Test `cancelAssignment` when already CANCELLED → expect `ConflictError`
  - _Requirements: 3.10, 4.5, 4.6, 4.9_

- [ ]* 5.9 Write property tests for package validation and assignment invariants (Properties 7, 8, 9, 10, 11)
  - **Property 7: Package validation rejects invalid inputs and accepts valid ones**
  - **Validates: Requirements 3.2, 3.12**
  - **Property 8: INACTIVE package cannot be assigned**
  - **Validates: Requirements 3.5, 4.5**
  - **Property 9: Duplicate package name detection is case- and whitespace-insensitive**
  - **Validates: Requirement 3.10**
  - **Property 10: At most one ACTIVE assignment per (patientId, packageId) pair**
  - **Validates: Requirements 4.6, 4.11**
  - **Property 11: Assignment list is always ordered by assignedDate descending**
  - **Validates: Requirement 4.11**
  - Run minimum 100 iterations each

---

### 6. Checkpoint — Backend Foundation and First Module

- [ ] 6.1 Register new routers in `app.ts` (partial — packages only so far)
  - Open `server/src/app.ts`
  - Add import for `packagesRouter` from `./modules/packages/packages.routes`
  - Register `app.use('/api/packages', packagesRouter)` following the existing registration pattern
  - Verify server compiles without TypeScript errors
  - Ensure all tests pass up to this point, ask the user if questions arise.

---

### 7. Patient Packages Module — Frontend

- [ ] 7.1 Create `client/store/api/packages.api.ts`
  - Inject endpoints into `baseApi`:
    - `listPackages: build.query<PackageListResult, { status?: PackageStatus; page?: number; limit?: number }>` — GET `/api/packages` with query params; `providesTags: ['Package']`
    - `getPackage: build.query<PackageResponse, string>` — GET `/api/packages/${packageId}`; `providesTags: ['Package']`
    - `createPackage: build.mutation<PackageResponse, CreatePackageRequest>` — POST `/api/packages`; `invalidatesTags: ['Package']`
    - `updatePackage: build.mutation<PackageResponse, { packageId: string } & UpdatePackageRequest>` — PATCH `/api/packages/${packageId}`; `invalidatesTags: ['Package']`
    - `assignPackage: build.mutation<AssignmentResponse, AssignPackageRequest>` — POST `/api/packages/${packageId}/assignments`; `invalidatesTags: ['PackageAssignment']`
    - `cancelAssignment: build.mutation<AssignmentResponse, { packageId: string; assignmentId: string }>` — PATCH `/api/packages/${packageId}/assignments/${assignmentId}/cancel`; `invalidatesTags: ['PackageAssignment']`
    - `listPatientAssignments: build.query<AssignmentResponse[], string>` — GET `/api/patients/${patientId}/assignments`; `providesTags: ['PackageAssignment']`
  - Add `transformResponse` unwrapping `ApiSuccess<T>` on all endpoints
  - Export all generated hooks
  - _Requirements: 3.1, 3.3, 3.6, 4.1, 4.7, 4.8_

- [ ] 7.2 Create packages list page at `client/app/(dashboard)/packages/page.tsx`
  - Fetch packages with `useListPackagesQuery`; support optional status filter via local state
  - Display packages in a table/card list: name, price (formatted as ₹), status badge, included services count
  - Show "Create Package" button visible only to `HOSPITAL_ADMIN` and `ADMIN` roles
  - Handle empty state, loading spinner, and error display
  - _Requirements: 3.1, 3.6, NFR-G_

- [ ] 7.3 Create new package page at `client/app/(dashboard)/packages/new/page.tsx`
  - Role-gate: accessible to `HOSPITAL_ADMIN` and `ADMIN` only; redirect to `/packages` otherwise
  - Form fields: name (text), description (textarea, optional), price (number, min 0), included services (dynamic list add/remove, min 1)
  - On submit call `useCreatePackageMutation`; navigate to `/packages` on success
  - Client-side validation mirrors server-side constraints (name 1-200, description 0-500, price >= 0, services 1-50 each 1-300 chars)
  - _Requirements: 3.1, 3.2, NFR-G_

- [ ] 7.4 Create package detail page at `client/app/(dashboard)/packages/[packageId]/page.tsx`
  - Fetch package with `useGetPackageQuery`
  - Show package details (name, description, price, status, included services list, createdAt)
  - Edit form visible only to `HOSPITAL_ADMIN` and `ADMIN` — inline edit or side panel using `useUpdatePackageMutation`
  - Assignment section: form to assign package to a patient (patientId input, optional assignedDate); list of existing assignments with cancel buttons for authorized roles
  - _Requirements: 3.3, 4.1, 4.7, 4.8_

- [ ] 7.5 Create patient assignments page at `client/app/(dashboard)/patients/[patientId]/assignments/page.tsx`
  - Fetch assignments with `useListPatientAssignmentsQuery(patientId)`
  - Display assignments in descending assignedDate order: packageId/name, assignedDate, status badge, assignedBy, cancelledAt if applicable
  - Show cancel button on ACTIVE assignments for authorized roles (`HOSPITAL_ADMIN`, `ADMIN`, `RECEPTIONIST`)
  - Handle empty state with a descriptive message
  - _Requirements: 4.7, 4.8, 4.11_

---

### 8. Staff Document Onboarding Module — Backend

- [ ] 8.1 Create `StaffDocumentModel` in `server/src/modules/staff-documents/staff-documents.model.ts`
  - Define `IStaffDocument` interface and `StaffDocumentSchema` per the design document
  - Fields: `documentId`, `tenantId`, `userId`, `category`, `documentName`, `s3Key`, `uploadedBy`, `isDeleted`, `deletedBy`, `deletedAt`, `createdAt`, `updatedAt`
  - Add indexes: `{ tenantId: 1, documentId: 1 }` unique, `{ tenantId: 1, userId: 1, category: 1, isDeleted: 1 }`, `{ tenantId: 1, userId: 1, isDeleted: 1 }`
  - Export `StaffDocumentModel`
  - _Requirements: 5.1, 5.4, NFR-A, NFR-D_

- [ ] 8.2 Create `StaffDocumentRepository` in `server/src/modules/staff-documents/staff-documents.repository.ts`
  - Implement `save(data: Partial<IStaffDocument>): Promise<IStaffDocument>`
  - Implement `findById(tenantId: string, documentId: string): Promise<IStaffDocument | null>`
  - Implement `findByUser(tenantId: string, userId: string): Promise<IStaffDocument[]>` — where `isDeleted: false`
  - Implement `countByCategory(tenantId: string, userId: string, category: string): Promise<number>` — where `isDeleted: false`
  - Implement `softDelete(tenantId: string, documentId: string, deletedBy: string): Promise<IStaffDocument | null>` — sets `isDeleted: true`, `deletedBy`, `deletedAt: new Date()`
  - All queries scope to `tenantId`
  - Export singleton `staffDocumentRepository`
  - _Requirements: 5.1, 5.5, 5.6, 5.8, NFR-A_

- [ ] 8.3 Implement `detectMimeFromBuffer` and `buildS3Key` pure utilities in `server/src/modules/staff-documents/staff-documents.utils.ts`
  - Implement `detectMimeFromBuffer(buf: Buffer): string | null` with magic byte checks:
    - `0x25 0x50 0x44 0x46` → `'application/pdf'`
    - `0xFF 0xD8 0xFF` → `'image/jpeg'`
    - `0x89 0x50 0x4E 0x47` → `'image/png'`
    - Otherwise → `null`
  - Implement `buildS3Key(tenantId: string, userId: string, documentId: string, mimeType: string): string`
    - Extension map: `{ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }`
    - Returns `tenants/${tenantId}/staff-documents/${userId}/${documentId}.${ext}`
    - Inputs are UUIDs — no path traversal possible, but do NOT use user-supplied filenames
  - _Requirements: 5.2, 5.4, 5.13_

- [ ] 8.4 Create `StaffDocumentService` in `server/src/modules/staff-documents/staff-documents.service.ts`
  - Implement `uploadDocument(tenantId, userId, file: Express.Multer.File, data, uploadedBy)`:
    1. Verify `userId` belongs to same `tenantId` via `userRepository` → `ForbiddenError` if not
    2. Count non-deleted docs for `(tenantId, userId, category)` → 422 if count >= 20
    3. `detectMimeFromBuffer(file.buffer)` → 422 `ValidationError` if null
    4. Check `file.size > 10_485_760` → throw `HttpError(413, 'File exceeds 10 MB limit.')`
    5. Generate `documentId = uuidv4()`; build S3 key
    6. Upload to S3; wrap in try/catch → `HttpError(502)` on failure
    7. Create `StaffDocument` MongoDB record
    8. `auditService.log(CREATE, STAFF_DOCUMENT)` — if this throws, do NOT persist record (wrap entire step 7+8 in transaction-like pattern: only mark saved after audit succeeds; return 500 if audit fails)
    9. Generate 1-hour pre-signed URL; return record + URL
  - Implement `listDocuments(tenantId, userId, requesterId)`: verify same tenant → `ForbiddenError`; return all non-deleted docs each with fresh 1-hour pre-signed URL
  - Implement `softDeleteDocument(tenantId, documentId, deletedBy)`: fetch → `NotFoundError`; check `isDeleted` already true → `ConflictError` ("Document {documentId} has already been deleted."); soft-delete; `auditService.log(UPDATE, STAFF_DOCUMENT)` — abort on audit failure
  - Implement `getOnboardingChecklist(tenantId, userId)`: for each `DocumentCategory` value, check if any non-deleted doc exists → `'complete'` or `'missing'`
  - Export singleton `staffDocumentService`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12_

- [ ] 8.5 Create `StaffDocumentController` in `server/src/modules/staff-documents/staff-documents.controller.ts`
  - Use multer `memoryStorage` with `limits: { fileSize: 10 * 1024 * 1024 + 1 }` — accept slightly over limit to let service detect oversize
  - Validate multipart fields with Zod: `category: z.enum([...DocumentCategory values])`, `documentName: z.string().min(1).max(200)`
  - Implement handlers for upload, list, checklist, and soft-delete endpoints
  - _Requirements: 5.1, 5.2, 5.3, 5.11_

- [ ] 8.6 Create `StaffDocumentsRouter` in `server/src/modules/staff-documents/staff-documents.routes.ts`
  - Use `protect` middleware chain
  - `POST /users/:userId` — `requireRole(['HOSPITAL_ADMIN','HR'])` → upload (with multer middleware before controller)
  - `GET /users/:userId` — `requireRole(['HOSPITAL_ADMIN','HR'])` → listDocuments
  - `GET /users/:userId/checklist` — `requireRole(['HOSPITAL_ADMIN','HR'])` → getOnboardingChecklist
  - `DELETE /:documentId` — `requireRole(['HOSPITAL_ADMIN','HR'])` → softDeleteDocument
  - Export `staffDocumentsRouter`
  - _Requirements: 5.5, 5.6, 5.7, 5.10, NFR-G_

- [ ]* 8.7 Write unit tests for `StaffDocumentService` utilities
  - Test `detectMimeFromBuffer` with all three valid magic byte sequences
  - Test `detectMimeFromBuffer` with a Buffer starting with arbitrary bytes → returns `null`
  - Test `buildS3Key` for all three MIME types — verify regex `^tenants\/[^\/]+\/staff-documents\/[^\/]+\/[^\/]+\.(pdf|jpg|png)$`
  - Test 20-document category limit boundary: mock `countByCategory` returning 19 → expect success; returning 20 → expect 422
  - _Requirements: 5.2, 5.4, 5.8, 5.13_

- [ ]* 8.8 Write property tests for staff document utilities (Properties 12, 13, 14)
  - **Property 12: Magic byte MIME validation rejects non-PDF/JPEG/PNG files**
  - **Validates: Requirement 5.2**
  - Use `fc.uint8Array({ minLength: 4 })` filtered to exclude valid magic byte prefixes; assert `detectMimeFromBuffer` returns `null`
  - **Property 13: S3 key structure and no path traversal**
  - **Validates: Requirements 5.4, 5.13**
  - Use `fc.uuid()` for tenantId/userId/documentId; for each valid mimeType assert key matches regex and contains no `..` sequences
  - **Property 14: Category document count limit enforced**
  - **Validates: Requirement 5.8**
  - Use `fc.integer({ min: 20, max: 100 })` for count; mock repository `countByCategory` returning that value; assert service throws 422
  - Run minimum 100 iterations each

---

### 9. Staff Document Onboarding Module — Frontend

- [ ] 9.1 Create `client/store/api/staffDocuments.api.ts`
  - Inject endpoints:
    - `uploadDocument: build.mutation<StaffDocumentResponse, { userId: string; formData: FormData }>` — POST `/api/staff-documents/users/${userId}` with `body: formData` (no Content-Type header override — let browser set multipart boundary)
    - `listDocuments: build.query<StaffDocumentResponse[], string>` — GET `/api/staff-documents/users/${userId}`; `providesTags: ['StaffDocument']`
    - `getChecklist: build.query<ChecklistItem[], string>` — GET `/api/staff-documents/users/${userId}/checklist`; `providesTags: ['StaffDocument']`
    - `deleteDocument: build.mutation<StaffDocumentResponse, string>` — DELETE `/api/staff-documents/${documentId}`; `invalidatesTags: ['StaffDocument']`
  - Add `transformResponse` unwrapping `ApiSuccess<T>` on all endpoints
  - Export generated hooks
  - _Requirements: 5.1, 5.5, 5.6, 5.10_

- [ ] 9.2 Create staff documents page at `client/app/(dashboard)/staff/[userId]/documents/page.tsx`
  - Role-gate: `HOSPITAL_ADMIN` and `HR` only; redirect otherwise
  - Onboarding checklist section: fetch with `useGetChecklistQuery(userId)`; display each category with ✓ complete or ✗ missing status badge
  - Document list section: fetch with `useListDocumentsQuery(userId)`; display each doc with category, name, upload date, download link (presignedUrl)
  - Upload form: file input (accept `.pdf,.jpg,.jpeg,.png`), category selector, document name text field; validate file type client-side before submission; call `useUploadDocumentMutation` with `FormData`
  - Delete button on each document (calls `useDeleteDocumentMutation`); confirm before deleting
  - _Requirements: 5.1, 5.5, 5.6, 5.10_

---

### 10. Patient Billing and Charges Module — Backend

- [ ] 10.1 Create `ChargeModel` in `server/src/modules/charges/charges.model.ts`
  - Define `ICharge` interface and `ChargeSchema` per the design document
  - Fields: `chargeId`, `tenantId`, `patientId`, `category`, `description`, `amount`, `encounterReference`, `addedBy`, `status`, `voidedBy`, `voidedAt`, `createdAt`, `updatedAt`
  - Enums: `CHARGE_CATEGORIES` array with 8 values; `ChargeStatus` `['UNPAID','VOIDED']`
  - Add indexes: `{ tenantId: 1, chargeId: 1 }` unique, `{ tenantId: 1, patientId: 1, status: 1, createdAt: -1 }`, `{ tenantId: 1, category: 1, createdAt: -1 }`, `{ tenantId: 1, addedBy: 1, createdAt: -1 }`
  - Export `ChargeModel`
  - _Requirements: 6.1, NFR-A, NFR-D_

- [ ] 10.2 Create `ChargeRepository` in `server/src/modules/charges/charges.repository.ts`
  - Implement `save(data: Partial<ICharge>): Promise<ICharge>`
  - Implement `findById(tenantId: string, chargeId: string): Promise<ICharge | null>`
  - Implement `findByPatient(tenantId: string, patientId: string): Promise<ICharge[]>` — all statuses, sorted `createdAt: -1`
  - Implement `list(tenantId: string, filters: ChargeListFilters): Promise<PaginatedResult<ICharge>>` — filter by `patientId`, `category`, `startDate`, `endDate`, `addedBy`; paginate max 20; sort `createdAt: -1`
  - Implement `update(tenantId: string, chargeId: string, data: Partial<ICharge>): Promise<ICharge | null>`
  - All queries scope to `tenantId`
  - Export singleton `chargeRepository`
  - _Requirements: 6.1, 6.5, 6.7, NFR-A_

- [ ] 10.3 Implement `computeBillTotals` pure helper in `server/src/modules/charges/charges.service.ts` (stub file)
  - Create the service file
  - Implement `computeBillTotals(charges: ICharge[]): BillTotals`:
    - Filter to `status === 'UNPAID'` charges only
    - Group by `category`, sum amounts per category
    - Compute `grandTotal = sum of all category subtotals`
    - Return `{ categorySubtotals, grandTotal }`
    - Use 2dp rounding (`Math.round(sum * 100) / 100`) to avoid floating-point drift
  - _Requirements: 6.5, 6.10, 6.11_

- [ ] 10.4 Implement full `ChargeService` in `server/src/modules/charges/charges.service.ts`
  - Define ROLE_CATEGORY_PERMISSIONS map:
    ```
    DOCTOR: ['CONSULTATION', 'PROCEDURE']
    NURSE: ['NURSING']
    PATHOLOGIST: ['LAB_TEST']
    RADIOLOGIST: ['LAB_TEST']
    RECEPTIONIST: ['CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'MEDICATION', 'PACKAGE', 'OTHER']
    ADMIN: all 8 categories
    HOSPITAL_ADMIN: all 8 categories
    SYSTEM_AUTO: all 8 categories (internal bypass)
    ```
  - Implement `addCharge(tenantId, data, addedBy, role)`: verify patient tenantId match → `ForbiddenError`; check role-category permissions → `ForbiddenError` with message identifying role and disallowed category; generate `chargeId = 'CHG-' + uuidv4().replace(/-/g,'').substring(0,8).toUpperCase()`; save charge; `auditService.log(CREATE, CHARGE)`
  - Implement `voidCharge(tenantId, chargeId, voidedBy, voidedByName, role)`: fetch → `NotFoundError`; check role in `[HOSPITAL_ADMIN, ADMIN, RECEPTIONIST]` → `ForbiddenError`; check status already `VOIDED` → `ConflictError`; update; `auditService.log(UPDATE, CHARGE)`; if `voidedBy !== charge.addedBy` send notification via `notificationService.sendNotification`
  - Implement `getBill(tenantId, patientId)`: verify patient tenantId match → `ForbiddenError`; fetch all charges by patient; call `computeBillTotals`; return `{ patientId, lineItems: all charges sorted createdAt desc, categorySubtotals, grandTotal }`
  - Implement `listCharges(tenantId, filters)`: delegate to repository
  - Implement `createPackageCharge(assignment, pkg)`: if `pkg.price < 0.01` log warning and return null; call `addCharge` with `role: 'SYSTEM_AUTO'`
  - Export singleton `chargeService`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

- [ ] 10.5 Create `ChargeController` in `server/src/modules/charges/charges.controller.ts`
  - Implement handlers for addCharge, getBill (mounted on patient routes), listCharges, voidCharge
  - Zod schema for addCharge: `patientId` string, `category` z.enum([...8 values]), `description` z.string().min(1).max(500), `amount` z.number().min(0.01).max(999999999.99), `encounterReference` optional string
  - Zod schema for listCharges: all filters optional, `page` and `limit` with defaults
  - `addedBy` and `role` extracted exclusively from `req.user` (JWT)
  - _Requirements: 6.1, 6.4, NFR-E_

- [ ] 10.6 Create `ChargesRouter` in `server/src/modules/charges/charges.routes.ts`
  - Use `protect` middleware chain
  - `POST /` — `requireRole(['HOSPITAL_ADMIN','ADMIN','DOCTOR','NURSE','PATHOLOGIST','RADIOLOGIST','RECEPTIONIST'])` → addCharge
  - `GET /` — `requireRole(['HOSPITAL_ADMIN','ADMIN','MANAGER','FINANCE_MANAGER'])` → listCharges
  - `PATCH /:chargeId/void` — `requireRole(['HOSPITAL_ADMIN','ADMIN','RECEPTIONIST'])` → voidCharge
  - Export `chargesRouter`
  - Note: `GET /api/patients/:patientId/bill` is mounted in the patient router (see task 10.7)
  - _Requirements: 6.2, 6.5, 6.6, 6.7, NFR-G_

- [ ] 10.7 Add bill endpoint to the patient router
  - Open `server/src/modules/patient/patient.routes.ts`
  - Import `chargesController` or add a thin handler that calls `chargeService.getBill`
  - Register `GET /:patientId/bill` with `requireRole(['HOSPITAL_ADMIN','ADMIN','MANAGER','FINANCE_MANAGER','DOCTOR','NURSE','PATHOLOGIST','RADIOLOGIST','RECEPTIONIST'])`
  - _Requirements: 6.5, NFR-G_

- [ ] 10.8 Add patient assignments list endpoint to the patient router
  - Open `server/src/modules/patient/patient.routes.ts`
  - Import `packageService` (or add a thin controller handler that calls `packageService.listAssignmentsByPatient`)
  - Register `GET /:patientId/assignments` with `requireRole(['HOSPITAL_ADMIN','ADMIN','MANAGER','FINANCE_MANAGER','RECEPTIONIST','DOCTOR'])`
  - _Requirements: 4.7, NFR-G_

- [ ]* 10.9 Write unit tests for `ChargeService`
  - Test role-category permission matrix: for each of the 7 roles × 8 categories — assert allowed categories pass and disallowed categories throw `ForbiddenError`
  - Test `voidCharge` notification trigger: mock charge with `addedBy: 'user1'`, `voidedBy: 'user2'` → assert `notificationService.sendNotification` called with `addedBy` as recipient
  - Test `voidCharge` when same user voids own charge (`voidedBy === addedBy`) → assert notification NOT sent
  - Test `createPackageCharge` with `price = 0.00` → expect `null` returned and warning logged
  - Test `createPackageCharge` with `price = 0.01` → expect charge record created
  - _Requirements: 6.2, 6.6, 6.8_

- [ ]* 10.10 Write property tests for charge service (Properties 15, 16, 17)
  - **Property 15: Role-to-category permission matrix is exhaustively enforced**
  - **Validates: Requirement 6.2**
  - Use `fc.constantFrom(...roles)` × `fc.constantFrom(...categories)`; for disallowed pairs assert `ForbiddenError`; for allowed pairs assert no error
  - **Property 16: Bill totals arithmetic invariant**
  - **Validates: Requirements 6.5, 6.11**
  - Use `fc.array(fc.record({ category: fc.constantFrom(...8 categories), amount: fc.float({ min: 0.01, max: 999999 }), status: fc.constantFrom('UNPAID','VOIDED') }))` ; assert `grandTotal === sum(categorySubtotals.values())` and each subtotal sums only UNPAID charges
  - **Property 17: Automatic PACKAGE charge creation matches package price and name**
  - **Validates: Requirement 6.8**
  - Use `fc.float({ min: 0.01 })` for valid prices; assert created charge has `amount === pkg.price`, `description === pkg.name`, `category === 'PACKAGE'`, `encounterReference === assignmentId`
  - Run minimum 100 iterations each

---

### 11. Patient Billing and Charges Module — Frontend

- [ ] 11.1 Create `client/store/api/charges.api.ts`
  - Inject endpoints:
    - `addCharge: build.mutation<ChargeResponse, AddChargeRequest>` — POST `/api/charges`; `invalidatesTags: ['Charge', 'Bill']`
    - `voidCharge: build.mutation<ChargeResponse, string>` — PATCH `/api/charges/${chargeId}/void`; `invalidatesTags: ['Charge', 'Bill']`
    - `getPatientBill: build.query<BillResponse, string>` — GET `/api/patients/${patientId}/bill`; `providesTags: ['Bill']`
    - `listCharges: build.query<ChargeListResult, { patientId?: string; category?: ChargeCategory; startDate?: string; endDate?: string; addedBy?: string; page?: number; limit?: number }>` — GET `/api/charges` with params; `providesTags: ['Charge']`
  - Add `transformResponse` unwrapping `ApiSuccess<T>` on all endpoints
  - Export generated hooks
  - _Requirements: 6.1, 6.5, 6.7_

- [ ] 11.2 Create patient bill page at `client/app/(dashboard)/patients/[patientId]/bill/page.tsx`
  - Fetch bill with `useGetPatientBillQuery(patientId)`
  - Display category subtotals section: each category with its subtotal amount
  - Display grand total prominently
  - Display line items table: description, category, amount, status badge (UNPAID green / VOIDED red), addedBy, createdAt, voidedAt if voided
  - Show void button on UNPAID charges for authorized roles (`HOSPITAL_ADMIN`, `ADMIN`, `RECEPTIONIST`)
  - Handle zero-charge state with an appropriate empty message
  - _Requirements: 6.5, 6.6, 6.10, 6.11_

- [ ] 11.3 Create billing list page at `client/app/(dashboard)/billing/page.tsx`
  - Role-gate: accessible to `HOSPITAL_ADMIN`, `ADMIN`, `MANAGER`, `FINANCE_MANAGER` only
  - Fetch charges with `useListChargesQuery` with filter controls: patient ID search, category dropdown, date range pickers, addedBy filter
  - Display in paginated table; show status badge per charge
  - _Requirements: 6.7_

---

### 12. Register All New Routes in `app.ts`

- [ ] 12.1 Register all four new module routers in `server/src/app.ts`
  - Add imports:
    ```typescript
    import staffIdCardRouter    from './modules/staff-id-card/staff-id-card.routes';
    import staffDocumentsRouter from './modules/staff-documents/staff-documents.routes';
    import chargesRouter        from './modules/charges/charges.routes';
    ```
  - (packagesRouter already registered in task 6.1)
  - Add registrations following the existing pattern:
    ```typescript
    app.use('/api/staff-id-cards',  staffIdCardRouter);
    app.use('/api/staff-documents', staffDocumentsRouter);
    app.use('/api/charges',         chargesRouter);
    ```
  - Verify TypeScript compilation passes (`npx tsc --noEmit` in `server/`)
  - _Requirements: All six features — route availability_

---

### 13. Property-Based Tests — Remaining Properties

- [ ]* 13.1 Write property test for tenant branding graceful handling (Property 1)
  - **Property 1: Tenant branding graceful handling**
  - **Validates: Requirement 1.2**
  - Use `fc.option(fc.webUrl(), { nil: null })` for `logoUrl` and `fc.string({ minLength: 1 })` for `displayName`; call `buildStaffIdCardPdf` with these options; assert no exception is thrown when `logoUrl` is null
  - Run minimum 100 iterations

- [ ]* 13.2 Write property test for cross-tenant 403 invariant (Property 2)
  - **Property 2: Cross-tenant 403 invariant**
  - **Validates: Requirements 1.4, 2.9, 3.7, 4.2, 5.7, 6.3**
  - For each service method that accepts `(tenantId, ...entityWithDifferentTenantId)`, use `fc.tuple(fc.uuid(), fc.uuid()).filter(([a, b]) => a !== b)` to generate distinct tenant pairs; assert that calling with mismatched tenantId always throws `ForbiddenError` or `NotFoundError` (never 200)
  - Run minimum 100 iterations per service entry point

- [ ]* 13.3 Write property test for audit CREATE vs UPDATE based on prior S3 existence (Property 3)
  - **Property 3: Audit CREATE vs UPDATE based on prior S3 existence**
  - **Validates: Requirement 1.7**
  - Mock `staffIdCardRepository.findByUserId` returning `null` → assert `auditService.log` called with `action: 'CREATE'`
  - Mock returning a record → assert `auditService.log` called with `action: 'UPDATE'`
  - Run minimum 100 iterations with varied `(tenantId, userId)` strings

---

### 14. Integration and Unit Tests

- [ ]* 14.1 Write integration tests for the packages module
  - Use `mongodb-memory-server` for in-memory MongoDB and mock S3
  - Test full create → read → update flow: create package, fetch by ID, update name, verify audit entries
  - Test compound index constraint: attempt to create two packages with the same name in the same tenant → expect error on second create
  - Test `assignPackage` → verify auto-charge creation: create package with price 500, create assignment, query charges for patient → assert one PACKAGE charge exists with `amount === 500`
  - _Requirements: 3.1, 3.3, 3.10, 4.1, 6.8_

- [ ]* 14.2 Write integration tests for the charges module
  - Test void notification: create charge with `addedBy: 'user1'`; void with `voidedBy: 'user2'`; assert notification record created for `user1`
  - Test bill recalculation: add three charges (500, 1000, 200), void the 1000 one, call `getBill` → assert `grandTotal === 700` and voided charge appears in lineItems with status VOIDED but excluded from subtotals
  - _Requirements: 6.6, 6.10, 6.11_

- [ ]* 14.3 Write integration tests for the staff documents module
  - Test full upload → list → delete flow with mock S3 and in-memory MongoDB
  - Test that soft-deleted documents are excluded from `listDocuments` results
  - Test that attempting to delete an already-deleted document returns 409
  - Test audit abort behavior: mock `auditService.log` to throw; assert that the MongoDB record was NOT persisted
  - _Requirements: 5.6, 5.9, 5.12_

---

### 15. Final Checkpoint — Ensure All Tests Pass

- [ ] 15.1 Final validation
  - Run `npx tsc --noEmit` in both `server/` and `client/` directories and resolve any TypeScript errors
  - Verify all new routes are accessible (no 404) by checking route registrations in `app.ts`
  - Confirm all required npm packages are installed: `pdfkit`, `qrcode`, `multer`, `fast-check` (dev dependency), and their `@types/*` equivalents
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery; core implementation tasks are never optional
- All monetary amounts are stored as decimal numbers with 2dp precision; use `Math.round(x * 100) / 100` in service layer to avoid floating-point drift
- The `protect` middleware chain referenced throughout is `[authenticateJWT, scopeTenant, requireFirstPasswordChange]` — consistent with all existing modules
- Feature 2 (Medical Card Redesign) enhances the existing patient module in-place; the S3 key pattern and endpoint URL are unchanged
- The automatic PACKAGE charge creation in `PackageService.assignPackage` is a synchronous in-process call wrapped in try/catch — assignment is never rolled back on charge failure
- Property-based tests use the `fast-check` library; install as dev dependency: `npm install -D fast-check`
- Each property test comment includes `// Feature: hospital-features-enhancement, Property N: [Title]` for traceability
- The `SYSTEM_AUTO` internal role marker in `addCharge` bypasses the role-category permission check for automatically created charges

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1", "0.2", "1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "2.1", "2.2", "4.1", "5.1", "5.3", "8.1", "8.2", "8.3", "10.1", "10.2"] },
    { "id": 2, "tasks": ["2.3", "3.1", "5.2", "5.4", "10.3"] },
    { "id": 3, "tasks": ["2.4", "4.2", "5.5", "8.4", "10.4"] },
    { "id": 4, "tasks": ["2.5", "2.7", "2.8", "4.3", "4.4", "5.6", "5.8", "5.9", "8.5", "10.5", "10.9", "10.10"] },
    { "id": 5, "tasks": ["2.6", "3.2", "5.7", "7.1", "8.6", "8.7", "8.8", "10.6", "10.7", "10.8", "11.1"] },
    { "id": 6, "tasks": ["3.3", "6.1", "9.1", "13.1", "13.2", "13.3"] },
    { "id": 7, "tasks": ["7.2", "7.3", "7.4", "7.5", "9.2", "11.2", "11.3", "12.1"] },
    { "id": 8, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 9, "tasks": ["15.1"] }
  ]
}
```
