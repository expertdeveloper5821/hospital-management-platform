# Design Document — Hospital Features Enhancement

## Overview

This document describes the technical design for six hospital platform enhancements built on top of the existing multi-tenant Node.js/Express/TypeScript backend and Next.js 14 frontend. All six features follow the established codebase patterns: the `model → repository → service → controller → routes` stack on the server, `baseApi.injectEndpoints` RTK Query slices on the client, tenant-scoped compound MongoDB indexes, Zod validation at the controller boundary, `auditService.log()` for all mutations, and AWS S3 with pre-signed URLs for file storage.

The six features are:

1. **Staff ID Cards** — PDF generation and S3 storage for staff identity cards
2. **Patient Medical ID Card Redesign** — credit-card-sized PDF with QR code and tenant branding
3. **Patient Packages** — CRUD management of care/service bundles
4. **Package Assignment** — assigning packages to patients with RBAC
5. **Staff Document Onboarding** — multipart upload with magic byte MIME validation
6. **Patient Billing and Charges** — itemised charges, bill summary, void workflow, and automatic package charge creation

---

## Architecture

### Implementation Status

The table below reflects the actual state of the codebase as of the start of this feature's implementation. Nothing from the four new modules exists yet — every file in those directories must be created from scratch.

#### Backend — Server Modules (`server/src/modules/`)

| Module | Status | Notes |
|--------|--------|-------|
| `auth/` | ✅ Exists | No changes needed |
| `audit/` | ✅ Exists | No changes needed |
| `dashboard/` | ✅ Exists | No changes needed |
| `inventory/` | ✅ Exists | No changes needed |
| `ipd/` | ✅ Exists | No changes needed |
| `lab/` | ✅ Exists | No changes needed |
| `notification/` | ✅ Exists | No changes needed |
| `opd/` | ✅ Exists | No changes needed |
| `patient/` | ✅ Exists | **Needs in-place update** — add `MedicalCardPdfBuilder`, update `patient.service.ts` |
| `payment/` | ✅ Exists | No changes needed |
| `search/` | ✅ Exists | No changes needed |
| `super-admin/` | ✅ Exists | No changes needed |
| `tenant/` | ✅ Exists | No changes needed |
| `user/` | ✅ Exists | No changes needed |
| `staff-id-card/` | ❌ **Does not exist** | Create entire module: model, repository, pdf builder, service, controller, routes |
| `packages/` | ❌ **Does not exist** | Create entire module: package model, assignment model, both repositories, service, controller, routes |
| `staff-documents/` | ❌ **Does not exist** | Create entire module: model, repository, utils, service, controller, routes |
| `charges/` | ❌ **Does not exist** | Create entire module: model, repository, service, controller, routes |

#### Frontend — RTK Query API Slices (`client/store/api/`)

| File | Status | Notes |
|------|--------|-------|
| `audit.api.ts` | ✅ Exists | No changes needed |
| `auth.api.ts` | ✅ Exists | No changes needed |
| `base.api.ts` | ✅ Exists | **Needs update** — add 6 new tag types |
| `dashboard.api.ts` | ✅ Exists | No changes needed |
| `inventory.api.ts` | ✅ Exists | No changes needed |
| `ipd.api.ts` | ✅ Exists | No changes needed |
| `lab.api.ts` | ✅ Exists | No changes needed |
| `notification.api.ts` | ✅ Exists | No changes needed |
| `opd.api.ts` | ✅ Exists | No changes needed |
| `patient.api.ts` | ✅ Exists | No changes needed |
| `payment.api.ts` | ✅ Exists | No changes needed |
| `platformSettings.api.ts` | ✅ Exists | No changes needed |
| `search.api.ts` | ✅ Exists | No changes needed |
| `tenant.api.ts` | ✅ Exists | No changes needed |
| `user.api.ts` | ✅ Exists | No changes needed |
| `packages.api.ts` | ❌ **Does not exist** | Create from scratch |
| `charges.api.ts` | ❌ **Does not exist** | Create from scratch |
| `staffDocuments.api.ts` | ❌ **Does not exist** | Create from scratch |
| `staffIdCards.api.ts` | ❌ **Does not exist** | Create from scratch |

#### Frontend — Dashboard Pages (`client/app/(dashboard)/`)

| Page path | Status | Notes |
|-----------|--------|-------|
| `admin/` | ✅ Exists | No changes needed |
| `audit/` | ✅ Exists | No changes needed |
| `dashboard/` | ✅ Exists | No changes needed |
| `inventory/` | ✅ Exists | No changes needed |
| `ipd/` | ✅ Exists | No changes needed |
| `lab/` | ✅ Exists | No changes needed |
| `opd/` | ✅ Exists | No changes needed |
| `patients/` | ✅ Exists | No changes needed to existing page |
| `payments/` | ✅ Exists | No changes needed |
| `profile/` | ✅ Exists | No changes needed |
| `super-admin/` | ✅ Exists | No changes needed |
| `packages/page.tsx` | ❌ **Does not exist** | Create — package list |
| `packages/new/page.tsx` | ❌ **Does not exist** | Create — create package form |
| `packages/[packageId]/page.tsx` | ❌ **Does not exist** | Create — package detail + edit + assign |
| `billing/page.tsx` | ❌ **Does not exist** | Create — charges list / filter |
| `patients/[patientId]/bill/page.tsx` | ❌ **Does not exist** | Create — patient bill view |
| `patients/[patientId]/assignments/page.tsx` | ❌ **Does not exist** | Create — patient package assignments |
| `staff/[userId]/documents/page.tsx` | ❌ **Does not exist** | Create — staff document list + upload |
| `staff/[userId]/id-card/page.tsx` | ❌ **Does not exist** | Create — staff ID card generation / download |

#### Frontend — Sidebar (`client/components/shared/Sidebar.tsx`)

| Item | Status | Notes |
|------|--------|-------|
| Existing icons & `ICON_MAP` | ✅ Exists | `LayoutDashboard`, `Building2`, `Users`, `HeartPulse`, `Stethoscope`, `Bed`, `FlaskConical`, `Package`, `CreditCard`, `FileText`, `Settings` |
| `FileBadge` import + `ICON_MAP` entry | ❌ **Does not exist** | Add for staff ID card nav |
| `Receipt` import + `ICON_MAP` entry | ❌ **Does not exist** | Add for billing nav |
| `FolderOpen` import + `ICON_MAP` entry | ❌ **Does not exist** | Add for staff documents nav |
| `Gift` import + `ICON_MAP` entry | ❌ **Does not exist** | Add for packages nav |

---

### How the Six Modules Fit In

The new modules slot into the existing Express application as six additional feature modules, each registered in `server/src/app.ts` and following the same directory layout as `opd`, `inventory`, and `lab`.

```
server/src/modules/
  staff-id-card/        (Feature 1) — CREATE from scratch
  packages/             (Features 3 & 4 — package definitions + assignments) — CREATE from scratch
  staff-documents/      (Feature 5) — CREATE from scratch
  charges/              (Feature 6) — CREATE from scratch
```

Feature 2 (Medical Card Redesign) is implemented as an in-place enhancement to the existing `patient` module's medical-card endpoint rather than a new module, since the S3 key pattern and endpoint path must remain unchanged.

The overall request flow is identical to existing modules:

```
Client (Next.js RTK Query)
  → HTTPS → Express Router
  → [authenticateJWT] → [scopeTenant] → [requireFirstPasswordChange] → [requireRole]
  → Controller (Zod validation)
  → Service (business logic, auditService.log)
  → Repository (Mongoose, tenantId-scoped queries)
  → MongoDB Atlas
  → S3 (for file operations)
```

### Route Registrations in `app.ts`

#### Current State (as of implementation start)

The following routes are currently registered in `server/src/app.ts`:

```typescript
app.use('/api/auth',          authRouter);
app.use('/api/super-admin',   superAdminRouter);
app.use('/api/tenants',       tenantRouter);
app.use('/api/users',         userRouter);
app.use('/api/patients',      patientRouter);
app.use('/api/opd',           opdRouter);
app.use('/api/ipd',           ipdRouter);
app.use('/api/lab',           labRouter);
app.use('/api/inventory',     inventoryRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/payments',      paymentRouter);
app.use('/api/audit',         auditRouter);
app.use('/api/dashboard',     dashboardRouter);
app.use('/api/search',        searchRouter);
```

#### Additions Required

The following four imports and route registrations must be added to `server/src/app.ts`. None exist yet:

```typescript
// Add these imports alongside the existing router imports
import staffIdCardRouter    from './modules/staff-id-card/staff-id-card.routes';
import packagesRouter       from './modules/packages/packages.routes';
import staffDocumentsRouter from './modules/staff-documents/staff-documents.routes';
import chargesRouter        from './modules/charges/charges.routes';

// Add these registrations after the existing app.use('/api/search', searchRouter) line
app.use('/api/staff-id-cards',    staffIdCardRouter);
app.use('/api/packages',          packagesRouter);
app.use('/api/staff-documents',   staffDocumentsRouter);
app.use('/api/charges',           chargesRouter);
```

Medical Card redesign is a modification to the existing patient router — no new route prefix.

---

## Data Models

### 1. `packages` Collection

```typescript
// server/src/modules/packages/packages.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export type PackageStatus = 'ACTIVE' | 'INACTIVE';

export interface IPackage extends Document {
  packageId:        string;
  tenantId:         string;
  name:             string;
  description:      string | null;
  price:            number;           // stored as number, validated to 2dp
  includedServices: string[];         // min 1, max 50 entries
  status:           PackageStatus;
  isDeleted:        boolean;
  createdAt:        Date;
  updatedAt:        Date;
}

const PackageSchema = new Schema<IPackage>(
  {
    packageId:        { type: String, required: true, unique: true },
    tenantId:         { type: String, required: true },
    name:             { type: String, required: true, trim: true, maxlength: 200 },
    description:      { type: String, default: null, trim: true, maxlength: 500 },
    price:            { type: Number, required: true, min: 0 },
    includedServices: [{ type: String, trim: true, maxlength: 300 }],
    status:           { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted:        { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'packages' },
);

// NFR-01: tenantId first on all compound indexes
PackageSchema.index({ tenantId: 1, packageId: 1 }, { unique: true });
PackageSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
PackageSchema.index({ tenantId: 1, name: 1 });   // duplicate name detection

export const PackageModel = mongoose.model<IPackage>('Package', PackageSchema);
```

### 2. `package_assignments` Collection

```typescript
// server/src/modules/packages/package-assignment.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export type AssignmentStatus = 'ACTIVE' | 'CANCELLED';

export interface IPackageAssignment extends Document {
  assignmentId:  string;
  tenantId:      string;
  patientId:     string;
  packageId:     string;
  assignedDate:  Date;
  assignedBy:    string;   // userId
  status:        AssignmentStatus;
  cancelledBy:   string | null;
  cancelledAt:   Date | null;
  createdAt:     Date;
  updatedAt:     Date;
}

const PackageAssignmentSchema = new Schema<IPackageAssignment>(
  {
    assignmentId: { type: String, required: true, unique: true },
    tenantId:     { type: String, required: true },
    patientId:    { type: String, required: true },
    packageId:    { type: String, required: true },
    assignedDate: { type: Date,   required: true },
    assignedBy:   { type: String, required: true },
    status:       { type: String, required: true, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    cancelledBy:  { type: String, default: null },
    cancelledAt:  { type: Date,   default: null },
  },
  { timestamps: true, collection: 'package_assignments' },
);

// NFR-01: tenantId first
PackageAssignmentSchema.index({ tenantId: 1, assignmentId: 1 }, { unique: true });
PackageAssignmentSchema.index({ tenantId: 1, patientId: 1, assignedDate: -1 });
// Uniqueness enforcement: at most one ACTIVE per (tenantId, patientId, packageId)
PackageAssignmentSchema.index(
  { tenantId: 1, patientId: 1, packageId: 1, status: 1 },
  { unique: false },
);

export const PackageAssignmentModel = mongoose.model<IPackageAssignment>(
  'PackageAssignment',
  PackageAssignmentSchema,
);
```

### 3. `charges` Collection

```typescript
// server/src/modules/charges/charges.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export type ChargeCategory =
  | 'CONSULTATION' | 'IPD_BED' | 'NURSING' | 'LAB_TEST'
  | 'PROCEDURE'    | 'MEDICATION' | 'PACKAGE' | 'OTHER';

export type ChargeStatus = 'UNPAID' | 'VOIDED';

export interface ICharge extends Document {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;        // 1–500 chars
  amount:             number;        // 0.01–999999999.99
  encounterReference: string | null; // visitId or admissionId or assignmentId
  addedBy:            string;        // userId
  status:             ChargeStatus;
  voidedBy:           string | null;
  voidedAt:           Date | null;
  createdAt:          Date;
  updatedAt:          Date;
}

const CHARGE_CATEGORIES = [
  'CONSULTATION', 'IPD_BED', 'NURSING', 'LAB_TEST',
  'PROCEDURE', 'MEDICATION', 'PACKAGE', 'OTHER',
];

const ChargeSchema = new Schema<ICharge>(
  {
    chargeId:           { type: String, required: true, unique: true },
    tenantId:           { type: String, required: true },
    patientId:          { type: String, required: true },
    category:           { type: String, required: true, enum: CHARGE_CATEGORIES },
    description:        { type: String, required: true, trim: true, maxlength: 500 },
    amount:             { type: Number, required: true, min: 0.01 },
    encounterReference: { type: String, default: null },
    addedBy:            { type: String, required: true },
    status:             { type: String, required: true, enum: ['UNPAID', 'VOIDED'], default: 'UNPAID' },
    voidedBy:           { type: String, default: null },
    voidedAt:           { type: Date,   default: null },
  },
  { timestamps: true, collection: 'charges' },
);

// NFR-01: tenantId first
ChargeSchema.index({ tenantId: 1, chargeId: 1 }, { unique: true });
ChargeSchema.index({ tenantId: 1, patientId: 1, status: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, category: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, addedBy: 1, createdAt: -1 });

export const ChargeModel = mongoose.model<ICharge>('Charge', ChargeSchema);
```

### 4. `staff_documents` Collection

```typescript
// server/src/modules/staff-documents/staff-documents.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export type DocumentCategory =
  | 'AADHAAR' | 'PAN' | 'MEDICAL_REGISTRATION' | 'DEGREE_CERTIFICATE' | 'OTHER';

export interface IStaffDocument extends Document {
  documentId:   string;
  tenantId:     string;
  userId:       string;    // target staff member
  category:     DocumentCategory;
  documentName: string;    // 1–200 chars
  s3Key:        string;
  uploadedBy:   string;    // requesting user's userId
  isDeleted:    boolean;
  deletedBy:    string | null;
  deletedAt:    Date | null;
  createdAt:    Date;
  updatedAt:    Date;
}

const DOCUMENT_CATEGORIES = [
  'AADHAAR', 'PAN', 'MEDICAL_REGISTRATION', 'DEGREE_CERTIFICATE', 'OTHER',
];

const StaffDocumentSchema = new Schema<IStaffDocument>(
  {
    documentId:   { type: String, required: true, unique: true },
    tenantId:     { type: String, required: true },
    userId:       { type: String, required: true },
    category:     { type: String, required: true, enum: DOCUMENT_CATEGORIES },
    documentName: { type: String, required: true, trim: true, maxlength: 200 },
    s3Key:        { type: String, required: true },
    uploadedBy:   { type: String, required: true },
    isDeleted:    { type: Boolean, default: false },
    deletedBy:    { type: String, default: null },
    deletedAt:    { type: Date,   default: null },
  },
  { timestamps: true, collection: 'staff_documents' },
);

// NFR-01: tenantId first
StaffDocumentSchema.index({ tenantId: 1, documentId: 1 }, { unique: true });
StaffDocumentSchema.index({ tenantId: 1, userId: 1, category: 1, isDeleted: 1 });
StaffDocumentSchema.index({ tenantId: 1, userId: 1, isDeleted: 1 });

export const StaffDocumentModel = mongoose.model<IStaffDocument>(
  'StaffDocument',
  StaffDocumentSchema,
);
```

### 5. `staff_id_cards` Collection (metadata only — PDF lives in S3)

```typescript
// server/src/modules/staff-id-card/staff-id-card.model.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IStaffIdCard extends Document {
  tenantId:  string;
  userId:    string;
  s3Key:     string;    // tenants/{tenantId}/staff-id-cards/{userId}.pdf
  issuedAt:  Date;
  expiresAt: Date;      // issuedAt + 365 days
  createdAt: Date;
  updatedAt: Date;
}

const StaffIdCardSchema = new Schema<IStaffIdCard>(
  {
    tenantId:  { type: String, required: true },
    userId:    { type: String, required: true },
    s3Key:     { type: String, required: true },
    issuedAt:  { type: Date,   required: true },
    expiresAt: { type: Date,   required: true },
  },
  { timestamps: true, collection: 'staff_id_cards' },
);

// NFR-01: tenantId first; one record per staff member per tenant
StaffIdCardSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export const StaffIdCardModel = mongoose.model<IStaffIdCard>(
  'StaffIdCard',
  StaffIdCardSchema,
);
```

---

## API Endpoints

All endpoints use the `protect` middleware chain: `[authenticateJWT, scopeTenant, requireFirstPasswordChange]`.

### Module 1: Staff ID Cards — `/api/staff-id-cards`

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/staff-id-cards/:userId/generate` | HOSPITAL_ADMIN, HR | Generate or regenerate Staff ID Card PDF |

**POST `/api/staff-id-cards/:userId/generate`**

Request: no body required.

Response `201` (first generation):
```json
{
  "status": "success",
  "data": {
    "userId": "usr_abc123",
    "presignedUrl": "https://s3.amazonaws.com/...",
    "expiresAt": "2025-07-15T12:00:00Z",
    "issuedAt": "2025-07-14T10:00:00Z",
    "cardExpiresAt": "2026-07-14T10:00:00Z"
  }
}
```

Response `200` (regeneration): same shape.
Errors: `403` (wrong tenant or wrong role), `404` (userId not found), `502` (S3 failure).

---

### Module 2: Medical Card Redesign — existing patient module

The existing endpoint path is preserved. Only the PDF generation logic inside the service is replaced.

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/patients/:patientId/medical-card` | RECEPTIONIST, HOSPITAL_ADMIN, ADMIN, MANAGER | Generate/regenerate Medical Card PDF |

Response shape unchanged from existing implementation — `presignedUrl` + `expiresAt`.

---

### Module 3 & 4: Packages — `/api/packages`

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/packages` | HOSPITAL_ADMIN, ADMIN | Create package |
| GET | `/api/packages` | HOSPITAL_ADMIN, ADMIN, MANAGER, FINANCE_MANAGER, RECEPTIONIST, DOCTOR | List packages (paginated) |
| GET | `/api/packages/:packageId` | same as list | Get package by ID |
| PATCH | `/api/packages/:packageId` | HOSPITAL_ADMIN, ADMIN | Update package |

**POST `/api/packages`** — Request body:
```json
{
  "name": "Maternity Package",
  "description": "Comprehensive maternity care",
  "price": 25000.00,
  "includedServices": [
    "Normal delivery",
    "Post-natal care (5 days)",
    "Newborn screening"
  ]
}
```

Response `201`:
```json
{
  "status": "success",
  "data": {
    "packageId": "PKG-A1B2C3D4",
    "tenantId": "ten_xyz",
    "name": "Maternity Package",
    "description": "...",
    "price": 25000.00,
    "includedServices": ["..."],
    "status": "ACTIVE",
    "createdAt": "2025-07-14T10:00:00Z",
    "updatedAt": "2025-07-14T10:00:00Z"
  }
}
```

**GET `/api/packages`** — Query params: `status` (ACTIVE|INACTIVE), `page`, `limit` (max 20).

**PATCH `/api/packages/:packageId`** — Partial body: any subset of `name`, `description`, `price`, `includedServices`, `status`.

---

### Module 4: Package Assignments — `/api/packages/:packageId/assignments` and `/api/patients/:patientId/assignments`

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/packages/:packageId/assignments` | HOSPITAL_ADMIN, ADMIN, RECEPTIONIST, DOCTOR | Assign package to patient |
| GET | `/api/patients/:patientId/assignments` | HOSPITAL_ADMIN, ADMIN, MANAGER, FINANCE_MANAGER, RECEPTIONIST, DOCTOR | List assignments for patient |
| PATCH | `/api/packages/:packageId/assignments/:assignmentId/cancel` | HOSPITAL_ADMIN, ADMIN, RECEPTIONIST | Cancel assignment |

**POST `/api/packages/:packageId/assignments`** — Request body:
```json
{
  "patientId": "PAT-12345678",
  "assignedDate": "2025-07-14"  // optional, defaults to today UTC
}
```

Response `201`:
```json
{
  "status": "success",
  "data": {
    "assignmentId": "ASN-A1B2C3D4",
    "tenantId": "ten_xyz",
    "patientId": "PAT-12345678",
    "packageId": "PKG-A1B2C3D4",
    "assignedDate": "2025-07-14",
    "assignedBy": "usr_abc123",
    "status": "ACTIVE",
    "createdAt": "2025-07-14T10:00:00Z"
  }
}
```

**PATCH `/api/packages/:packageId/assignments/:assignmentId/cancel`** — No body. Returns updated assignment with `status: "CANCELLED"`.

---

### Module 5: Staff Documents — `/api/staff-documents`

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/staff-documents/users/:userId` | HOSPITAL_ADMIN, HR | Upload document for staff member |
| GET | `/api/staff-documents/users/:userId` | HOSPITAL_ADMIN, HR | List documents for staff member |
| GET | `/api/staff-documents/users/:userId/checklist` | HOSPITAL_ADMIN, HR | Onboarding checklist summary |
| DELETE | `/api/staff-documents/:documentId` | HOSPITAL_ADMIN, HR | Soft-delete a document |

**POST `/api/staff-documents/users/:userId`** — `multipart/form-data`:
- `file` (binary) — required
- `category` (string, one of DocumentCategory enum) — required
- `documentName` (string, 1–200 chars) — required

Response `201`:
```json
{
  "status": "success",
  "data": {
    "documentId": "DOC-A1B2C3D4",
    "tenantId": "ten_xyz",
    "userId": "usr_abc123",
    "category": "AADHAAR",
    "documentName": "Aadhaar Card",
    "s3Key": "tenants/ten_xyz/staff-documents/usr_abc123/DOC-A1B2C3D4.pdf",
    "presignedUrl": "https://s3.amazonaws.com/...",
    "uploadedBy": "usr_hr001",
    "createdAt": "2025-07-14T10:00:00Z"
  }
}
```

**GET `/api/staff-documents/users/:userId`** — Returns array of documents each with a fresh `presignedUrl` (1 hour).

**GET `/api/staff-documents/users/:userId/checklist`** — Returns:
```json
{
  "status": "success",
  "data": [
    { "category": "AADHAAR",               "status": "complete" },
    { "category": "PAN",                   "status": "missing"  },
    { "category": "MEDICAL_REGISTRATION",  "status": "missing"  },
    { "category": "DEGREE_CERTIFICATE",    "status": "complete" },
    { "category": "OTHER",                 "status": "missing"  }
  ]
}
```

**DELETE `/api/staff-documents/:documentId`** — Soft-delete. Response `200` with updated document record.

---

### Module 6: Charges — `/api/charges`

| Method | Path | Role(s) | Description |
|--------|------|---------|-------------|
| POST | `/api/charges` | HOSPITAL_ADMIN, ADMIN, DOCTOR, NURSE, PATHOLOGIST, RADIOLOGIST, RECEPTIONIST | Add charge |
| GET | `/api/patients/:patientId/bill` | All clinical + finance roles | Get bill for patient |
| GET | `/api/charges` | HOSPITAL_ADMIN, ADMIN, MANAGER, FINANCE_MANAGER | List all charges (filterable) |
| PATCH | `/api/charges/:chargeId/void` | HOSPITAL_ADMIN, ADMIN, RECEPTIONIST | Void a charge |

**POST `/api/charges`** — Request body:
```json
{
  "patientId":          "PAT-12345678",
  "category":           "CONSULTATION",
  "description":        "Dr. Smith consultation fee",
  "amount":             500.00,
  "encounterReference": "OPD-ABCD1234"  // optional
}
```

**GET `/api/patients/:patientId/bill`** — Response:
```json
{
  "status": "success",
  "data": {
    "patientId": "PAT-12345678",
    "lineItems": [
      {
        "chargeId": "CHG-001",
        "category": "CONSULTATION",
        "description": "Dr. Smith consultation",
        "amount": 500.00,
        "status": "UNPAID",
        "addedBy": "usr_doc001",
        "createdAt": "2025-07-14T10:00:00Z"
      }
    ],
    "categorySubtotals": {
      "CONSULTATION": 500.00,
      "LAB_TEST": 1200.00
    },
    "grandTotal": 1700.00
  }
}
```

**GET `/api/charges`** — Query params: `patientId`, `category`, `startDate` (YYYY-MM-DD), `endDate`, `addedBy`, `page`, `limit` (max 20).

**PATCH `/api/charges/:chargeId/void`** — No body. Triggers notification to original charge creator if voider differs.

---

## Service Layer Design

All services follow the `OPDService` pattern: class with methods, singleton export, injecting `auditService.log()` and the module's repository.

### `StaffIdCardService`

```typescript
export class StaffIdCardService {
  // Determines CREATE vs UPDATE audit based on S3 object pre-existence
  async generate(tenantId: string, userId: string, requesterId: string): Promise<StaffIdCardResult>

  // Helpers (pure, no I/O)
  computeIssuedAt(): Date                          // new Date() normalized to UTC start-of-day
  computeExpiryDate(issuedAt: Date): Date          // issuedAt + exactly 365 days
  buildS3Key(tenantId: string, userId: string): string  // tenants/{tenantId}/staff-id-cards/{userId}.pdf
}
```

`generate` flow:
1. Look up user by `(tenantId, userId)` — throw `NotFoundError` if absent.
2. Fetch tenant branding from `TenantModel` — logo URL (may be null), displayName.
3. Check if `staff_id_cards` record exists for `(tenantId, userId)` to determine audit action.
4. Build PDF via `StaffIdCardPdfBuilder` (see PDF Generation section).
5. Upload PDF buffer to S3 at key `buildS3Key(tenantId, userId)`.
6. Upsert `staff_id_cards` record.
7. `auditService.log({ action: exists ? 'UPDATE' : 'CREATE', entityType: AuditEntityType.STAFF_ID_CARD, entityId: userId, ... })`.
8. Generate and return 24-hour pre-signed URL.

### `PackageService`

```typescript
export class PackageService {
  async createPackage(tenantId: string, data: CreatePackageRequest, createdBy: string): Promise<IPackage>
  async updatePackage(tenantId: string, packageId: string, data: UpdatePackageRequest, updatedBy: string): Promise<IPackage>
  async getPackageById(tenantId: string, packageId: string): Promise<IPackage>
  async listPackages(tenantId: string, filters: PackageListFilters): Promise<PaginatedResult<IPackage>>

  async assignPackage(tenantId: string, packageId: string, data: AssignPackageRequest, assignedBy: string): Promise<IPackageAssignment>
  async cancelAssignment(tenantId: string, assignmentId: string, cancelledBy: string): Promise<IPackageAssignment>
  async listAssignmentsByPatient(tenantId: string, patientId: string): Promise<IPackageAssignment[]>
}
```

`assignPackage` flow:
1. Fetch package by `(tenantId, packageId)` — `NotFoundError` or `422` if INACTIVE.
2. Fetch patient by `(tenantId, patientId)` — `NotFoundError` if absent.
3. Check for existing ACTIVE assignment for `(tenantId, patientId, packageId)` — `ConflictError` if found.
4. Create `PackageAssignment` record.
5. `auditService.log(CREATE, PACKAGE_ASSIGNMENT)`.
6. **Trigger automatic charge** — call `chargeService.createPackageCharge(assignment, pkg)`.

### `ChargeService`

```typescript
export class ChargeService {
  async addCharge(tenantId: string, data: AddChargeRequest, addedBy: string, role: UserRole): Promise<ICharge>
  async voidCharge(tenantId: string, chargeId: string, voidedBy: string, voidedByName: string, role: UserRole): Promise<ICharge>
  async getBill(tenantId: string, patientId: string): Promise<BillResponse>
  async listCharges(tenantId: string, filters: ChargeListFilters): Promise<PaginatedResult<ICharge>>

  // Called internally by PackageService after assignment creation
  async createPackageCharge(assignment: IPackageAssignment, pkg: IPackage): Promise<ICharge | null>

  // Pure helper — recomputes bill totals from an array of charges
  computeBillTotals(charges: ICharge[]): BillTotals
}
```

`voidCharge` flow:
1. Fetch charge by `(tenantId, chargeId)` — `NotFoundError` if absent, `ConflictError` if already VOIDED.
2. Check `role` is in `[HOSPITAL_ADMIN, ADMIN, RECEPTIONIST]` — `ForbiddenError` otherwise.
3. Update charge to `VOIDED`, set `voidedBy`, `voidedAt`.
4. `auditService.log(UPDATE, CHARGE)`.
5. If `voidedBy !== charge.addedBy`, send in-app notification to `charge.addedBy` via `notificationService.sendNotification(...)`.

`createPackageCharge` logic:
- If `pkg.price < 0.01` — log warning, return `null` (no charge created).
- Otherwise create charge: `{ category: 'PACKAGE', amount: pkg.price, description: pkg.name, encounterReference: assignment.assignmentId, addedBy: assignment.assignedBy }`.

### `StaffDocumentService`

```typescript
export class StaffDocumentService {
  async uploadDocument(tenantId: string, userId: string, file: Express.Multer.File, data: UploadDocumentRequest, uploadedBy: string): Promise<IStaffDocument>
  async listDocuments(tenantId: string, userId: string, requesterId: string): Promise<StaffDocumentWithUrl[]>
  async softDeleteDocument(tenantId: string, documentId: string, deletedBy: string): Promise<IStaffDocument>
  async getOnboardingChecklist(tenantId: string, userId: string): Promise<ChecklistItem[]>

  // Pure helpers
  detectMimeFromBuffer(buffer: Buffer): string | null
  buildS3Key(tenantId: string, userId: string, documentId: string, mimeType: string): string
}
```

`uploadDocument` flow:
1. Verify `userId` belongs to same `tenantId` — `ForbiddenError` otherwise.
2. Count non-deleted docs for `(tenantId, userId, category)` — `422` if >= 20.
3. `detectMimeFromBuffer(file.buffer)` — compare magic bytes; `422` if not in accepted set.
4. Validate file size <= 10,485,760 — `413` if exceeded.
5. Generate `documentId = uuidv4()`. Build S3 key.
6. Upload to S3.
7. Create `StaffDocument` record.
8. `auditService.log(CREATE, STAFF_DOCUMENT)` — if this fails, abort (do not persist record).

Magic byte detection:
```typescript
function detectMimeFromBuffer(buf: Buffer): string | null {
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  return null;
}
```

---

## PDF Generation

### PDFKit Pattern

Both PDF generators use PDFKit with an in-memory buffer, which is then uploaded to S3. They do not write to the filesystem.

```typescript
import PDFDocument from 'pdfkit';

function buildPdfBuffer(drawFn: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ autoFirstPage: false });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawFn(doc);
    doc.end();
  });
}
```

### Staff ID Card Layout (`StaffIdCardPdfBuilder`)

Page size: A6 landscape (148 × 105 mm). Card-style layout with a top color band.

```
┌─────────────────────────────────────────────────┐
│ [LOGO 40×40]  HOSPITAL DISPLAY NAME             │  ← primary color band (#1A73E8 default)
├─────────────────┬───────────────────────────────┤
│                 │ Name:   John Smith             │
│  [PHOTO 60×70   │ Role:   Doctor                 │
│   or silhouette]│ Dept:   Clinical               │
│                 │ EMP ID: usr_abc123             │
├─────────────────┴───────────────────────────────┤
│  Issued: 14 Jul 2025    Expires: 14 Jul 2026     │  ← footer band
└─────────────────────────────────────────────────┘
```

Key implementation notes:
- Logo is fetched from S3 using the branding `logoUrl` (itself a pre-signed URL or S3 key) then embedded as a PNG/JPEG buffer via `doc.image(buffer, x, y, { width, height })`. If fetch fails or `logoUrl` is null, the space is left empty — generation continues.
- Profile photo is similarly fetched. If unavailable (`profileImageUrl === null` or HTTP error), a 60×70 grey rectangle with a person-silhouette SVG path is drawn instead.
- `expiresAt = new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000)` — purely arithmetic, timezone-invariant.
- Dates are rendered as UTC strings: `issuedAt.toISOString().slice(0, 10)`.

### Patient Medical Card Layout (`MedicalCardPdfBuilder`)

Page size: 85.6 × 54 mm at 300 DPI (243 × 153 points in PDFKit), landscape.

```
┌─────────────────────────────────────────────────┐
│ [LOGO 24×24]  HOSPITAL NAME        [primaryColor band]
├────────────────────────────┬────────────────────┤
│ Name:    Jane Doe          │                    │
│ ID:      PAT-12345678      │   [QR CODE 40×40]  │
│ DOB:     01 Jan 1985       │                    │
│ Gender:  FEMALE            │                    │
│ Mobile:  9876543210        │                    │
│ Blood:   B+   (if present) │                    │
│ Aadhaar: XXXX-XXXX-4321    │                    │  ← only if present
├────────────────────────────┴────────────────────┤
│ Generated: 14 Jul 2025              [primaryColor band]
└─────────────────────────────────────────────────┘
```

Key implementation notes:
- QR code is generated using the `qrcode` npm package: `await QRCode.toBuffer(JSON.stringify({ patientId, tenantId }), { type: 'png' })`. If this throws, generation is aborted and `500` is returned.
- Aadhaar masking: `'XXXX-XXXX-' + aadhaar.replace(/\D/g, '').slice(-4)`. Only rendered when `patient.aadhaarNumber !== null`.
- `primaryColor` sourced from `tenant.branding.primaryColor` — falls back to `'#2563EB'` when absent.

---

## File Upload Flow (Staff Documents)

```
1. Client sends multipart/form-data to POST /api/staff-documents/users/:userId
   Fields: file (binary), category, documentName

2. Multer middleware (memoryStorage, 10.5 MB limit)
   → multer rejects at 10,485,760 bytes → controller returns 413

3. Controller validates body fields with Zod schema:
   - category: z.enum([...DocumentCategory values])
   - documentName: z.string().min(1).max(200)

4. Service.uploadDocument()
   a. Verify userId tenantId match
   b. Check category count <= 19 (< 20)
   c. detectMimeFromBuffer(file.buffer) — magic bytes
      → if null: throw ValidationError (422)
   d. Generate documentId = uuidv4()
   e. Build S3 key:
      const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[mime]
      const s3Key = `tenants/${tenantId}/staff-documents/${userId}/${documentId}.${ext}`
      // Sanitization: tenantId, userId, documentId are UUID v4 strings — no path traversal possible
   f. s3Client.putObject({ Bucket, Key: s3Key, Body: file.buffer, ContentType: mime })
   g. Create StaffDocument record in MongoDB
   h. auditService.log(CREATE, STAFF_DOCUMENT, documentId) — abort if fails
   i. Generate 1-hour pre-signed URL for the s3Key

5. Return 201 with document record + presignedUrl
```

Multer configuration for staff documents:
```typescript
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 + 1 }, // accept up to limit+1 to detect oversize
});
```

The size check in the service compares `file.size > 10_485_760` (10 MB exact) and throws an `HttpError(413)`.

---

## Frontend Structure

### New RTK Query API Slices

All four files below are new — none exist in `client/store/api/` yet. Each injects endpoints into `baseApi` following the same pattern as the existing slices (e.g., `inventory.api.ts`).

**`client/store/api/packages.api.ts`**
```typescript
export const packagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listPackages:        build.query<PackageListResult, PackageListQuery>({ ... }),
    getPackage:          build.query<PackageResponse, string>({ ... }),
    createPackage:       build.mutation<PackageResponse, CreatePackageRequest>({ ... }),
    updatePackage:       build.mutation<PackageResponse, { packageId: string } & UpdatePackageRequest>({ ... }),
    assignPackage:       build.mutation<AssignmentResponse, AssignPackageRequest>({ ... }),
    cancelAssignment:    build.mutation<AssignmentResponse, { packageId: string; assignmentId: string }>({ ... }),
    listPatientAssignments: build.query<AssignmentResponse[], string>({ ... }),
  }),
});
```

**`client/store/api/charges.api.ts`**
```typescript
export const chargesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    addCharge:    build.mutation<ChargeResponse, AddChargeRequest>({ ... }),
    voidCharge:   build.mutation<ChargeResponse, string>({ ... }),
    getPatientBill: build.query<BillResponse, string>({ ... }),
    listCharges:  build.query<ChargeListResult, ChargeListQuery>({ ... }),
  }),
});
```

**`client/store/api/staffDocuments.api.ts`**
```typescript
export const staffDocumentsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    uploadDocument:       build.mutation<StaffDocumentResponse, { userId: string; formData: FormData }>({ ... }),
    listDocuments:        build.query<StaffDocumentResponse[], string>({ ... }),
    getChecklist:         build.query<ChecklistItem[], string>({ ... }),
    deleteDocument:       build.mutation<StaffDocumentResponse, string>({ ... }),
  }),
});
```

**`client/store/api/staffIdCards.api.ts`**
```typescript
export const staffIdCardsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    generateStaffIdCard: build.mutation<StaffIdCardResponse, string>({ ... }),
  }),
});
```

### Tag Types in `base.api.ts`

#### Current State

The `tagTypes` array in `client/store/api/base.api.ts` currently contains:

```typescript
tagTypes: [
  'Auth', 'Tenant', 'User', 'Patient', 'OPD', 'IPD', 'Lab', 'Inventory',
  'Payment', 'Notification', 'Audit', 'Dashboard', 'PlatformSettings',
],
```

#### Required Addition

The following six tag types are missing and must be added:

```typescript
'Package', 'PackageAssignment', 'Charge', 'Bill', 'StaffDocument', 'StaffIdCard'
```

The final `tagTypes` array after the update:

```typescript
tagTypes: [
  'Auth', 'Tenant', 'User', 'Patient', 'OPD', 'IPD', 'Lab', 'Inventory',
  'Payment', 'Notification', 'Audit', 'Dashboard', 'PlatformSettings',
  'Package', 'PackageAssignment', 'Charge', 'Bill', 'StaffDocument', 'StaffIdCard',
],
```

### New Pages and Routes (Next.js App Router)

All page files below are new — none exist yet. They are created under the `(dashboard)` route group following the same layout shell as existing pages (e.g., `patients/page.tsx`, `inventory/page.tsx`).

```
client/app/(dashboard)/
  packages/
    page.tsx                          — Package list (HOSPITAL_ADMIN, ADMIN, MANAGER, FINANCE_MANAGER, RECEPTIONIST, DOCTOR)
    new/
      page.tsx                        — Create package form (HOSPITAL_ADMIN, ADMIN)
    [packageId]/
      page.tsx                        — Package detail + edit + assign
  billing/
    page.tsx                          — Charges list / filter (HOSPITAL_ADMIN, ADMIN, MANAGER, FINANCE_MANAGER)
  patients/
    [patientId]/
      bill/
        page.tsx                      — Patient bill view
      assignments/
        page.tsx                      — Patient package assignments
  staff/
    [userId]/
      documents/
        page.tsx                      — Staff document list + upload
      id-card/
        page.tsx                      — Staff ID card generation / download
```

### Sidebar Nav Updates (`client/components/shared/Sidebar.tsx` and `client/lib/rbac-nav.ts`)

#### Current State of `Sidebar.tsx` `ICON_MAP`

The sidebar currently imports and maps these icons from `lucide-react`:

```typescript
import {
  LayoutDashboard, Building2, Users, HeartPulse, Stethoscope,
  Bed, FlaskConical, Package, CreditCard, FileText, Settings, LogOut, X,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  'layout-dashboard': LayoutDashboard,
  'building-2':       Building2,
  'users':            Users,
  'heart-pulse':      HeartPulse,
  'stethoscope':      Stethoscope,
  'bed':              Bed,
  'flask-conical':    FlaskConical,
  'package':          Package,
  'credit-card':      CreditCard,
  'file-text':        FileText,
  'settings':         Settings,
};
```

#### Required Additions to `Sidebar.tsx`

Four new icons must be imported from `lucide-react` and added to `ICON_MAP`:

```typescript
// Add to the lucide-react import
import { ..., FileBadge, Receipt, FolderOpen, Gift } from 'lucide-react';

// Add to ICON_MAP
'file-badge':  FileBadge,    // staff ID card nav entry
'receipt':     Receipt,      // billing nav entry
'folder-open': FolderOpen,   // staff documents nav entry
'gift':        Gift,         // packages nav entry
```

#### Required Additions to `client/lib/rbac-nav.ts`

New nav entries (additions only — existing entries for each role remain unchanged):

```typescript
HOSPITAL_ADMIN: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
  { label: 'Billing',    href: '/billing',  icon: 'receipt'     },
],
ADMIN: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
  { label: 'Billing',    href: '/billing',  icon: 'receipt'     },
],
MANAGER: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
  { label: 'Billing',    href: '/billing',  icon: 'receipt'     },
],
FINANCE_MANAGER: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
  { label: 'Billing',    href: '/billing',  icon: 'receipt'     },
],
DOCTOR: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
],
RECEPTIONIST: [
  // ...existing...
  { label: 'Packages',   href: '/packages', icon: 'gift'        },
],
HR: [
  // ...existing...
  { label: 'Staff Docs', href: '/staff',    icon: 'folder-open' },
],
```

---

## Shared Type Updates

### Server: `server/src/shared/types/common.types.ts`

Add new values to the `AuditEntityType` const object:
```typescript
export const AuditEntityType = {
  // ...existing values...
  STAFF_ID_CARD:      'STAFF_ID_CARD',
  PACKAGE:            'PACKAGE',
  PACKAGE_ASSIGNMENT: 'PACKAGE_ASSIGNMENT',
  STAFF_DOCUMENT:     'STAFF_DOCUMENT',
  CHARGE:             'CHARGE',
} as const;
```

### Client: `client/store/types.ts`

Add to `AuditEntityTypes` array:
```typescript
export const AuditEntityTypes = [
  // ...existing values...
  'STAFF_ID_CARD',
  'PACKAGE',
  'PACKAGE_ASSIGNMENT',
  'STAFF_DOCUMENT',
  'CHARGE',
] as const;
```

Add new response/request types:

```typescript
// ─── Packages ─────────────────────────────────────────────────────────────────

export type PackageStatus     = 'ACTIVE' | 'INACTIVE';
export type AssignmentStatus  = 'ACTIVE' | 'CANCELLED';

export interface PackageResponse {
  packageId:        string;
  tenantId:         string;
  name:             string;
  description:      string | null;
  price:            number;
  includedServices: string[];
  status:           PackageStatus;
  createdAt:        string;
  updatedAt:        string;
}

export interface CreatePackageRequest {
  name:             string;
  description?:     string;
  price:            number;
  includedServices: string[];
}

export interface UpdatePackageRequest {
  name?:             string;
  description?:      string;
  price?:            number;
  includedServices?: string[];
  status?:           PackageStatus;
}

export interface AssignmentResponse {
  assignmentId:  string;
  tenantId:      string;
  patientId:     string;
  packageId:     string;
  packageName?:  string;
  assignedDate:  string;
  assignedBy:    string;
  status:        AssignmentStatus;
  cancelledBy:   string | null;
  cancelledAt:   string | null;
  createdAt:     string;
}

export interface AssignPackageRequest {
  packageId:    string;
  patientId:    string;
  assignedDate?: string;
}

export interface PackageListResult {
  data:       PackageResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// ─── Charges ──────────────────────────────────────────────────────────────────

export type ChargeCategory =
  | 'CONSULTATION' | 'IPD_BED' | 'NURSING' | 'LAB_TEST'
  | 'PROCEDURE'    | 'MEDICATION' | 'PACKAGE' | 'OTHER';

export type ChargeStatus = 'UNPAID' | 'VOIDED';

export interface ChargeResponse {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference: string | null;
  addedBy:            string;
  status:             ChargeStatus;
  voidedBy:           string | null;
  voidedAt:           string | null;
  createdAt:          string;
}

export interface AddChargeRequest {
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference?: string;
}

export interface BillResponse {
  patientId:          string;
  lineItems:          ChargeResponse[];
  categorySubtotals:  Partial<Record<ChargeCategory, number>>;
  grandTotal:         number;
}

export interface ChargeListResult {
  data:       ChargeResponse[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// ─── Staff Documents ──────────────────────────────────────────────────────────

export type DocumentCategory =
  | 'AADHAAR' | 'PAN' | 'MEDICAL_REGISTRATION' | 'DEGREE_CERTIFICATE' | 'OTHER';

export interface StaffDocumentResponse {
  documentId:   string;
  tenantId:     string;
  userId:       string;
  category:     DocumentCategory;
  documentName: string;
  s3Key:        string;
  presignedUrl?: string;
  uploadedBy:   string;
  isDeleted:    boolean;
  createdAt:    string;
}

export interface ChecklistItem {
  category: DocumentCategory;
  status:   'complete' | 'missing';
}

// ─── Staff ID Card ────────────────────────────────────────────────────────────

export interface StaffIdCardResponse {
  userId:       string;
  presignedUrl: string;
  issuedAt:     string;
  cardExpiresAt: string;
  expiresAt:    string;  // pre-signed URL expiry (24h from now)
}
```

---

## Automatic Charge Creation

When a `PackageAssignment` is created, `PackageService.assignPackage()` calls `chargeService.createPackageCharge(assignment, pkg)` after persisting the assignment and logging its audit entry. This is a synchronous in-process call — no message queue is involved.

```typescript
// Inside PackageService.assignPackage():
const assignment = await packageAssignmentRepository.save({ ... });
await auditService.log({ action: 'CREATE', entityType: AuditEntityType.PACKAGE_ASSIGNMENT, ... });

// Automatic charge (fire-and-handle — failure is logged, not rethrown)
try {
  await chargeService.createPackageCharge(assignment, pkg);
} catch (err) {
  logger.warn('Auto PACKAGE charge creation failed', { assignmentId: assignment.assignmentId, err });
  // Assignment is not rolled back — charge can be added manually
}
```

`chargeService.createPackageCharge` logic:
```typescript
async createPackageCharge(assignment: IPackageAssignment, pkg: IPackage): Promise<ICharge | null> {
  if (pkg.price < 0.01) {
    logger.warn('Package price below threshold, no charge created', {
      packageId: pkg.packageId,
      assignmentId: assignment.assignmentId,
      price: pkg.price,
    });
    return null;
  }

  return this.addCharge(
    assignment.tenantId,
    {
      patientId:          assignment.patientId,
      category:           'PACKAGE',
      description:        pkg.name,
      amount:             pkg.price,
      encounterReference: assignment.assignmentId,
    },
    assignment.assignedBy,  // charge is attributed to the assigning user
    'SYSTEM_AUTO',           // internal role marker bypasses role-category check
  );
}
```

The `addCharge` method accepts an optional `bypassRoleCheck: boolean` parameter for internal calls where the charge originates from system automation rather than a direct user action.

---

## Notification Flow (Charge Void by Different User)

When a charge is voided and `voidedBy !== charge.addedBy`, `ChargeService.voidCharge()` triggers a notification to the original charge creator:

```typescript
// Inside ChargeService.voidCharge():
await chargeRepository.update(tenantId, chargeId, {
  status: 'VOIDED', voidedBy, voidedAt: new Date(),
});

await auditService.log({ action: 'UPDATE', entityType: AuditEntityType.CHARGE, entityId: chargeId, ... });

if (voidedBy !== charge.addedBy) {
  const title   = 'Your charge was voided';
  const message = `Charge "${charge.description}" (₹${charge.amount.toFixed(2)}) ` +
                  `was voided by ${voidedByName} on ${new Date().toISOString().slice(0, 10)}.`;

  await notificationService.sendNotification(
    charge.addedBy,   // recipient — original charge creator
    tenantId,
    title,
    message,
    'CHARGE',         // entityType
    chargeId,         // entityId
  );
}
```

`notificationService.sendNotification` already handles real-time WebSocket push via `pushToUser()` and persists the notification record to MongoDB — no additional implementation needed.

The `voidedByName` is looked up from `userRepository.findByUserId(tenantId, voidedBy)` before the update, so the name is included in the notification even after the void completes.

---

## Correctness Properties

Property-based testing is applicable to this feature for the following subsystems: PDF generation helpers (pure functions for date arithmetic, masking, QR encoding), validation logic (role-category permissions, package validation rules), business invariants (bill totals, sort order), and file handling utilities (magic byte detection, S3 key generation). These are pure or near-pure functions whose correctness holds across an infinite input space.

PBT is **not** applied to: S3 upload/download operations (infrastructure), MongoDB persistence (integration), or full HTTP request/response flows (better covered by integration tests).

---

### Property 1: Tenant branding graceful handling

*For any* tenant branding configuration where `logoUrl` may be null or a valid URL string and `displayName` is any non-empty string, the Staff ID Card generator SHALL embed the `displayName` in the generated PDF metadata and SHALL NOT throw an error when `logoUrl` is null.

**Validates: Requirement 1.2**

---

### Property 2: Cross-tenant 403 invariant

*For any* pair of distinct tenantIds `(T1, T2)` where `T1 !== T2`, a request made by a user with `tenantId = T1` targeting a resource belonging to `tenantId = T2` SHALL always return HTTP 403 Forbidden, regardless of the user's role, the resource type, or the specific operation requested.

**Validates: Requirements 1.4, 2.9, 3.7, 4.2, 5.7, 6.3**

---

### Property 3: Audit CREATE vs UPDATE based on prior S3 existence

*For any* `(tenantId, userId)` pair, when no prior Staff ID Card record exists in the `staff_id_cards` collection, the audit action logged SHALL be `CREATE`. When a prior record already exists for the same pair, the audit action logged SHALL be `UPDATE`. This property holds for all valid tenantId and userId values.

**Validates: Requirement 1.7**

---

### Property 4: Expiry date is exactly 365 days after issue date

*For any* UTC `Date` value used as the issue date, the computed expiry date SHALL equal `issuedAt + 365 * 24 * 60 * 60 * 1000` milliseconds, making the arithmetic independent of the requesting user's timezone, daylight saving transitions, or locale settings.

**Validates: Requirement 1.11**

---

### Property 5: Aadhaar masking preserves only last 4 digits

*For any* string of 12 or more digit characters representing an Aadhaar number, the `maskAadhaar` function SHALL return a string matching the pattern `XXXX-XXXX-{last4}` where `{last4}` is exactly the last 4 digit characters of the input and no other digits from the input appear in the output.

**Validates: Requirement 2.2**

---

### Property 6: QR code round-trip correctness

*For any* `(patientId, tenantId)` string pair, encoding the pair as a JSON object into a QR code and then decoding and parsing the QR code SHALL yield an object where `decoded.patientId === patientId` and `decoded.tenantId === tenantId`, with no additional keys added or values mutated.

**Validates: Requirements 2.3, 2.10**

---

### Property 7: Package validation rejects invalid inputs and accepts valid ones

*For any* package creation request, if any of the following conditions hold — name is empty or exceeds 200 characters, price is negative, `includedServices` is empty or has more than 50 entries, any service description exceeds 300 characters — the service SHALL return HTTP 422 and SHALL NOT create a record. *For any* request where all conditions are satisfied, the service SHALL create a record with status ACTIVE.

**Validates: Requirements 3.2, 3.12**

---

### Property 8: INACTIVE package cannot be assigned

*For any* package with `status = INACTIVE` and any valid `(patientId, assignedBy)` pair within the same tenant, an assignment request SHALL always return HTTP 422 with a message containing the packageId, regardless of the patient's record state or the requesting user's role.

**Validates: Requirements 3.5, 4.5**

---

### Property 9: Duplicate package name detection is case- and whitespace-insensitive

*For any* existing package name `N` in a given tenant, submitting a create or update request with a name that normalizes to the same value as `N` (after `.trim().toLowerCase()`) SHALL return HTTP 409 Conflict, regardless of the original casing or surrounding whitespace of the submitted name.

**Validates: Requirement 3.10**

---

### Property 10: At most one ACTIVE assignment per (patientId, packageId) pair

*For any* sequence of assignment and cancellation operations on a given `(tenantId, patientId, packageId)` tuple, at no point in time SHALL more than one `PackageAssignment` record with `status = ACTIVE` exist for that tuple. Duplicate assignment attempts SHALL be rejected with HTTP 409.

**Validates: Requirements 4.6, 4.11**

---

### Property 11: Assignment list is always ordered by assignedDate descending

*For any* list of `PackageAssignment` records returned for a given `patientId`, for every pair of adjacent records `(r_i, r_{i+1})` in the response array, `r_i.assignedDate >= r_{i+1}.assignedDate` SHALL hold, regardless of the number of assignments, their statuses, or the order in which they were created.

**Validates: Requirement 4.11**

---

### Property 12: Magic byte MIME validation rejects non-PDF/JPEG/PNG files

*For any* byte sequence whose first 4 bytes do not match the magic byte signatures for PDF (`%PDF`), JPEG (`\xFF\xD8\xFF`), or PNG (`\x89PNG`), the `detectMimeFromBuffer` function SHALL return `null`, and the upload handler SHALL reject the file with HTTP 422, regardless of the declared `Content-Type` header value.

**Validates: Requirement 5.2**

---

### Property 13: S3 key structure and no path traversal

*For any* tuple `(tenantId, userId, documentId, mimeType)` where each ID is a UUID v4 string and mimeType is one of `application/pdf`, `image/jpeg`, `image/png`, the generated S3 key SHALL match the regex `^tenants\/[^\/]+\/staff-documents\/[^\/]+\/[^\/]+\.(pdf|jpg|png)$` exactly and SHALL contain no `..` sequences or URL-encoded path traversal characters.

**Validates: Requirements 5.4, 5.13**

---

### Property 14: Category document count limit enforced

*For any* `(tenantId, userId, category)` tuple, once 20 non-deleted `StaffDocument` records exist for that tuple, any further upload request for the same `(userId, category)` SHALL return HTTP 422, regardless of the file's content, name, or MIME type.

**Validates: Requirement 5.8**

---

### Property 15: Role-to-category permission matrix is exhaustively enforced

*For any* `(role, category)` pair, if the role is not listed in the permission matrix for that category (as defined in Requirement 6.2), an `addCharge` request from a user with that role for that category SHALL always return HTTP 403, regardless of the patient, amount, description, or other request fields.

**Validates: Requirement 6.2**

---

### Property 16: Bill totals arithmetic invariant

*For any* collection of `Charge` records for a patient with arbitrary amounts, categories, and void statuses, the `computeBillTotals` function SHALL satisfy: `grandTotal === sum(categorySubtotals.values())` AND for each category `C`, `categorySubtotals[C] === sum(amount for all charges where category === C and status === 'UNPAID')`. This invariant holds regardless of the number of charges, the mix of categories, or the order in which charges were created or voided.

**Validates: Requirements 6.5, 6.11**

---

### Property 17: Automatic PACKAGE charge creation matches package price and name

*For any* package with `price >= 0.01` INR, when a `PackageAssignment` is created for that package, the automatically created `Charge` record SHALL have `amount === package.price`, `description === package.name`, `category === 'PACKAGE'`, and `encounterReference === assignmentId`. *For any* package with `price < 0.01`, no `Charge` record SHALL be created and a warning SHALL be logged.

**Validates: Requirement 6.8**

---

## Error Handling

All service-layer errors follow the existing `NotFoundError` / `ConflictError` / `ValidationError` pattern from `server/src/shared/middleware/error-handler`. New HTTP status codes needed:

| Status | Scenario | How raised |
|--------|----------|-----------|
| 403 Forbidden | Wrong tenant, wrong role | `ForbiddenError` (new, extends `AppError` with `statusCode: 403`) |
| 404 Not Found | Resource not found in tenant | `NotFoundError` (existing) |
| 409 Conflict | Duplicate name, duplicate assignment, already voided, already deleted | `ConflictError` (existing) |
| 413 Payload Too Large | File exceeds 10 MB | `HttpError(413)` thrown from service |
| 422 Unprocessable Entity | Zod validation fail, INACTIVE package, category limit | `ValidationError` (existing) |
| 502 Bad Gateway | S3 put/get failure | `HttpError(502)` thrown from service |

`ForbiddenError` is the one addition needed:
```typescript
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}
```

S3 errors are caught in the service layer:
```typescript
try {
  await s3Client.send(new PutObjectCommand({ ... }));
} catch (err) {
  throw new HttpError(502, 'File storage operation failed. Please try again.');
}
```

No stack traces are included in production error responses — the global error handler in `error-handler.ts` strips them.

---

## Testing Strategy

### Unit Tests

Each module gets a `*.service.test.ts` file that mocks the repository and external dependencies:

- `StaffIdCardService` — mock S3, mock `TenantModel`, test `computeExpiryDate` edge cases (leap years, end of year), test audit action selection (CREATE vs UPDATE), test missing logo/photo branches.
- `PackageService` — test duplicate name normalization, INACTIVE guard, assignment conflict detection.
- `ChargeService` — test role-category permission matrix for all 7 roles × 8 categories, test void notification trigger, test `createPackageCharge` threshold boundary (price = 0.00, 0.009, 0.01, 1.00).
- `StaffDocumentService` — test `detectMimeFromBuffer` with all valid magic byte sequences and a range of invalid sequences, test `buildS3Key` for all three MIME types, test 20-document category limit boundary.
- `MedicalCardPdfBuilder` — test `maskAadhaar` with various 12-digit strings including leading zeros, test QR encoding/decoding round-trip.

### Property-Based Tests

Using **fast-check** (install via `npm install -D fast-check`).

Each property test runs a minimum of **100 iterations**. Test files live alongside their respective service files, named `*.property.test.ts`.

```typescript
// Example: charges.property.test.ts
// Feature: hospital-features-enhancement, Property 16: Bill totals arithmetic invariant
import * as fc from 'fast-check';
import { computeBillTotals } from './charges.service';

test('Bill grand total equals sum of category subtotals', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          category: fc.constantFrom('CONSULTATION', 'LAB_TEST', 'NURSING', 'PACKAGE', 'OTHER'),
          amount:   fc.float({ min: 0.01, max: 999999999.99, noNaN: true }),
          status:   fc.constantFrom('UNPAID', 'VOIDED'),
        }),
        { minLength: 0, maxLength: 50 },
      ),
      (charges) => {
        const bill = computeBillTotals(charges as ICharge[]);
        const subtotalSum = Object.values(bill.categorySubtotals).reduce((a, b) => a + b, 0);
        expect(Math.abs(bill.grandTotal - subtotalSum)).toBeLessThan(0.001);
      },
    ),
    { numRuns: 100 },
  );
});
```

### Integration Tests

Each module gets a `*.integration.test.ts` that uses a real in-memory MongoDB (via `mongodb-memory-server`) and mocked S3:

- Verify full create → read → update flows with actual Mongoose schemas.
- Verify compound index constraints (duplicate assignment, duplicate package name).
- Verify the automatic charge creation triggered by package assignment.
- Verify notification creation on cross-user void.

### Frontend Tests

React Testing Library tests for:
- Package list page renders correct empty state.
- Bill page renders `grandTotal` and all `categorySubtotals` correctly from mock data.
- Document upload form validates file type before submission.
- Staff ID Card generation button triggers correct mutation.
