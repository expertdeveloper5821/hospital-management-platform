# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Commands

### Backend (`server/`)
```bash
cd server
npm run dev                        # Start dev server (ts-node)
npm run build                      # Compile TypeScript → dist/
npm test                           # Run all tests
npm run test:unit                  # Unit tests only
npm run test:integration           # Integration tests only
npm run test:coverage              # Coverage report (thresholds: 80% lines/stmts/fns, 70% branches)

# Run a single test file
npx jest tests/unit/lab/lab.service.test.ts --no-coverage

# Seed scripts
npm run seed:super-admin
npm run seed:all
```

### Frontend (`client/`)
```bash
cd client
npm run dev                        # Next.js dev server (localhost:3000)
npm run build                      # Production build
npm run lint                       # ESLint via next lint
npm test                           # Jest (passWithNoTests)
npm run test:watch                 # Watch mode
```

---

## Architecture

### Stack
- **Frontend**: Next.js 14 (App Router), React 18, Redux Toolkit + RTK Query, React Hook Form + Zod, Tailwind CSS, Recharts
- **Backend**: Node.js + Express + TypeScript, MongoDB 8.3 + Mongoose, JWT auth, AWS S3, Razorpay, WebSocket (ws), PDFKit
- **Testing**: Jest + Supertest + mongodb-memory-server (backend); Jest + React Testing Library + jsdom (frontend)

### Multi-Tenancy
All tenant data is stored in shared MongoDB collections scoped by `tenantId`. The `scopeTenant` middleware extracts `tenantId` from the authenticated JWT and attaches it to `req`. Every repository query must include `tenantId` as a filter condition. The Super Admin has no `tenantId` and operates outside tenant scope.

### Backend Module Pattern
Each feature lives in `server/src/modules/<name>/` with this consistent layout:
```
<name>.types.ts       — TypeScript interfaces/enums for the module
<name>.model.ts       — Mongoose schema + model
<name>.repository.ts  — All MongoDB queries (no business logic)
<name>.service.ts     — Business logic, calls repository
<name>.controller.ts  — Express handlers, calls service, writes audit logs
<name>.routes.ts      — Route registration with middleware chain
```
Tests mirror this in `server/tests/unit/<name>/` and `server/tests/integration/<name>/`.

### Auth Middleware Chain
All protected routes use this middleware order:
```
authenticateJWT → scopeTenant → requireRole([...roles])
```
`/me` routes omit `requireRole` (all authenticated roles permitted). Super Admin routes use a separate `authenticateSuperAdmin` middleware.

### Frontend Data Fetching
All API calls go through RTK Query slices in `client/store/api/`. Component pages import hooks from these slices (e.g., `useGetPatientsQuery`, `useUpdatePatientMutation`). The Redux store is provided by `client/components/shared/ReduxProvider.tsx` and hydrated via `AuthHydrator.tsx`.

### Route Groups
```
client/app/(auth)/         — Unauthenticated pages (login, setup)
client/app/(dashboard)/    — Authenticated pages (all tenant roles)
client/app/(super-admin)/  — Super Admin console pages
```

### Real-time Notifications
WebSocket server runs alongside Express in `server/src/shared/services/websocket.ts`. The client connects via `client/lib/websocket-client.ts`. Events are pushed for notifications; polling is used for dashboard stats (60s TTL cache per `tenantId+role`).

### Audit Logging
Every state-mutating operation (create/update/delete) must write an audit log via `AuditService`. The `AuditEntityType` enum in `server/src/shared/types/common.types.ts` is the authoritative list of auditable entity types.

### Soft Deletes
Multiple modules use soft-delete (`isDeleted: Boolean`, `deletedAt: Date`) rather than hard deletes. All repository list queries must filter `{ isDeleted: { $ne: true } }`. Completed records may have restricted delete permissions (Admin/Manager only).

### Field-Level Encryption (AES-256-GCM)
Sensitive fields are encrypted at rest by `server/src/shared/utils/field-encryption.ts` (AES-256-GCM, envelope format `enc:v1:<base64(iv|authTag|ciphertext)>`). Keys are **backend-only**, loaded from env via `config.security` — never in source, never in the database, never sent to the frontend.

- **Keys**: `AADHAAR_ENCRYPTION_KEY` (purpose `AADHAAR`) protects `Patient` PII — `aadhaarNumber`, `dateOfBirth`, `bloodGroup`, `emergencyContactName`, `emergencyContactMobile`, and the address block (`address`, `addressLine1`, `addressLine2`, `city`, `state`, `country`, `pincode`). `MEDICAL_DATA_ENCRYPTION_KEY` (purpose `MEDICAL`) protects `OPDVisit.diagnosis`, `.prescription`, `.notes`, `.vitals` (`bloodPressure`, `weight`, `height`, `sugar`, `bodyTemperature`), `PathologyRequest.notes` / `RadiologyRequest.notes`, `IPDAdmission.progressNotes[].note` (per array element; `noteId` / `doctorId` / `timestamp` stay plaintext) and `IPDAdmission.vitals` (same five sub-fields as `OPDVisit.vitals`). `PAYMENT_DATA_ENCRYPTION_KEY` (purpose `PAYMENT`) protects `Payment.description`, `.transactionId` and `Charge.description`. `MEDICAL_DATA_ENCRYPTION_KEY` and `PAYMENT_DATA_ENCRYPTION_KEY` each fall back to the Aadhaar key when unset so existing deployments keep starting; set a distinct key per domain.
- **Wiring**: `encryptedFieldsPlugin` (`server/src/shared/utils/encrypted-fields.plugin.ts`) encrypts on save/insertMany/updateOne/updateMany/findOneAndUpdate/replaceOne/findOneAndReplace — covering `$set`, `$setOnInsert`, and bare replacement objects — and decrypts on find/findOne/findOneAndUpdate/findOneAndReplace/save. `Model.bulkWrite` runs no query middleware, so `opd.model.ts` / `patient.model.ts` / `payment.model.ts` / `lab.model.ts` (both request models) / `charges.model.ts` / `ipd.model.ts` also call `wrapModelBulkWrite(Model, …)` to encrypt each bulk op's payload. Services, controllers, PDF generators and the frontend all keep handling **plaintext only**.
- **Array-subdocument fields**: pass `arrayFields: [{ path: 'progressNotes', fields: ['note'] }]` in the plugin options to encrypt named string sub-paths per element of an embedded array. This additionally covers `$push` / `$addToSet` (single element or `$each: [...]`) and indexed / positional `$set` targets (`progressNotes.0.note`, `progressNotes.$.note`, `progressNotes.$[].note`). Only `IPDAdmission.progressNotes[].note` uses this today; `IPDRepository.appendProgressNote`'s `$push` is the primary write path.
- **Single-nested-object fields**: pass `objectFields: [{ path: 'vitals', stringFields: ['bloodPressure'], numberFields: ['weight', 'height', 'sugar', 'bodyTemperature'] }]` in the plugin options to encrypt named sub-fields of one embedded (non-array) subdocument in place — covers a bare replacement, and `$set`/`$setOnInsert` of the whole object or a dotted leaf (`vitals.weight`). `numberFields` entries are serialised with `String(value)` before encryption and parsed back to a `number` on decrypt, so callers keep seeing `number | null`. A numeric sub-field's schema type must be `Schema.Types.Mixed`, not `Number` (ciphertext triggers a CastError) and not `String` (a hydrated document's compiled setter would silently re-cast the decrypted `number` back into a `"string"`, while a `.lean()` read — a plain object, no compiled setters — would not, making the same code behave inconsistently depending on `.lean()`); range validation for these fields happens at the Zod layer before a value ever reaches Mongoose. `OPDVisit.vitals` and `IPDAdmission.vitals` are the only fields using this today.
- **Date fields**: pass `dateFields: ['dateOfBirth']` in the plugin options and give the schema path `type: String` (ciphertext can't live in a `Date` path). A `Date` value is serialised to ISO-8601 before encryption; a legacy value still stored as a BSON `Date` is normalised to ISO on read, so the API shape never changes. `Patient` has a `set:` on `dateOfBirth` that normalises any incoming `Date`/date-string to ISO so callers passing `new Date(...)` keep working.
- **Never query an encrypted field's content.** A random IV per write means equal plaintexts never produce equal ciphertexts. Filter after decryption — see `OPDRepository.findByPatient`, whose diagnosis search scans in memory (capped by `SEARCH_SCAN_LIMIT`) instead of using `$regex`. No `patient.repository` query touches an encrypted field; on `Payment` only `description`/`transactionId` are encrypted and neither is filtered, sorted, indexed, or `$lookup`-joined (every query key — `amount`, `status`, `paymentMethod`, `createdAt`, `referenceType`, `referenceId`, `patientId`, `razorpayOrderId` — stays plaintext). `PathologyRequest.notes` / `RadiologyRequest.notes`, `Charge.description`, `IPDAdmission.progressNotes[].note` and both models' `vitals.*` are likewise never filtered, sorted, searched (`search.service.ts` only regex-matches ids/testType/imagingType), indexed, `distinct()`-ed, or `$lookup`-joined — `markPaid` builds the auto-created `Payment.description` from the decrypted model read. `ipd.repository.ts` only ever queries admissions by `admissionId`/`tenantId`/`patientId`/`bedId`/`wardId`/`status`/`departmentId`/`assignedDoctorIds`, and the discharge-summary PDF reads notes through the decrypting model. The only remaining bypasses are raw aggregation (`$merge`/`$out`) and the native driver collection (`mongoose.connection.collection(...)`) — used by the migration scripts and tests, never in app code. `Payment` aggregate pipelines (`findLatestCompletedByPatientDoctorsAndReferenceType`) never `$project` an encrypted field.
- **Never log sensitive values.** `OPDService` writes `[redacted]` into audit `previousValue`/`newValue` for `diagnosis`/`prescription`/`notes`/`vitals` (the whole vitals object, not per sub-field); `IPDService.updateAdmission` does the same for `vitals` via a `redactVitals` helper; `PatientService.updatePatient` does the same for `dateOfBirth`, `bloodGroup`, the emergency-contact pair and the address block, and keeps Aadhaar's last-4 masking; `LabService.editPathologyRequest`/`editRadiologyRequest` redact `notes`; `PaymentService.createManualPayment` redacts `transactionId` in the audit `newValue`. `Charge` audit entries never carry `description`. `IPDService.addProgressNote` never writes an audit entry at all, so `progressNotes[].note` never reaches one.
- **Legacy rows**: values without the `enc:v1:` prefix are passed through unchanged on read (date fields normalised to ISO; legacy numeric `vitals.*` values — any BSON number, or a numeric string — normalised back to a real `number`), so enabling encryption needs no migration; `npm run migrate:encrypt-medical-fields`, `npm run migrate:encrypt-patient-pii`, `npm run migrate:encrypt-payment-fields`, `npm run migrate:encrypt-lab-notes`, `npm run migrate:encrypt-charge-fields`, `npm run migrate:encrypt-ipd-progress-notes`, `npm run migrate:encrypt-opd-vitals` and `npm run migrate:encrypt-ipd-vitals` (`-- --dry-run` to preview) convert them at rest and are safe to re-run. The IPD progress-notes script encrypts each legacy `progressNotes[].note` in place, skipping elements already in the envelope, and re-asserts the admission's exact prior `progressNotes` array as a concurrency guard; the two vitals scripts do the same for the whole `vitals` object (re-asserting the visit's/admission's exact prior `vitals` value at write time).

### Department Module
`server/src/modules/department/` — CRUD for clinical departments (Cardiology, Radiology, etc.).
- Each `IUser` document has a **`departmentIds: string[]`** field (default `[]`); only **DOCTOR** can be assigned to departments during user creation (the create-user form shows a checkbox multi-select only for the DOCTOR role; NURSE, PATHOLOGIST, and RADIOLOGIST are not department-assigned at creation).
- `IPatient` documents retain a legacy `departmentId: string | null` field but **department is no longer assigned during patient registration or editing** and is not shown in the patient detail view.
- `IPatient` has two registration-payment fields: `registrationFee: number | null` and `registrationPaymentMethod: string | null` (both default `null`). When a patient is registered with a paid fee, `createPatient` in `patient.controller.ts` calls `paymentService.createManualPayment` (description: `"Patient Registration Fee"`) after saving — payment failure does not roll back patient creation. The fee and payment mode are stored on the patient document so they appear on the medical card PDF footer (rendered by `pdfService.generateMedicalCard` when `registrationFee` is set). The patient registration form (`client/app/(dashboard)/patients/page.tsx`) has a **Registration Type** toggle (Free / Paid); selecting Paid reveals **Fee (₹)** input and **Payment Mode** (Cash / UPI / Card) buttons — both mandatory when Paid. The patient detail panel shows Fee and Payment Mode in the Details tab. Existing patients without a fee show "Free".
- `IIPDAdmission` carries `assignedDoctorIds: string[]` (array, default `[]`) and `departmentId` (copied from first doctor's `departmentIds[0]` at admission time; `null` when no doctors assigned).
- `IPathologyRequest` and `IRadiologyRequest` carry `departmentId` (copied from `requester.departmentIds[0]` at request time).
- `IOPDVisit` carries `doctorIds: string[]` (array, default `[]`) and `departmentId`, resolved via `departmentService.resolveDepartmentFromDoctorIds` (first assigned doctor with a `departmentIds[0]` wins — same algorithm as IPD admissions above; **not** copied from the patient, since patients are no longer department-scoped) at visit creation in `OPDService.createVisit`, and re-resolved in `OPDService.updateVisit` whenever `doctorIds` changes so a doctor reassignment never leaves a stale/null department.
- **Department-wise revenue resolution** (`server/src/modules/payment/payment.repository.ts`, `sumByResolvedDepartment`): a payment's department is resolved from `referenceType`/`referenceId` against `REFERENCE_DEPARTMENT_SOURCES` — a config list mapping `OPD_VISIT` → `opd_visits.departmentId`, `IPD_ADMISSION` → `ipd_admissions.departmentId`, `PATHOLOGY_REQUEST`/`RADIOLOGY_REQUEST` → `pathology_requests`/`radiology_requests.departmentId` (joined on the matching id field). Anything else (`REGISTRATION`, or a standalone manual/Razorpay payment with no reference) falls back to `Patient.departmentId`, which lands in "Other Revenue" for any patient registered after department-scoping moved off `Patient`. Adding a future reference-type-backed department source is a one-line addition to that config list — the `$lookup`/`$switch` aggregation pipeline is built from it, not duplicated per type.
- **Doctor-scoped filtering**: When a DOCTOR calls any list endpoint, the controller reads `doctor.departmentIds[]` and applies `$in` filtering — they see records across **all** their departments:
  - IPD admissions → `admission.departmentId $in doctor.departmentIds`
  - Lab lists (pathology/radiology) → `request.departmentId $in doctor.departmentIds`
  - OPD queue → `patientRepository.findPatientIdsByDepartments(tenantId, doctor.departmentIds)` returns matching `patientId[]`, then visits filtered by `patientId $in [...]` — covers legacy visits with no stored `departmentId`
  - Patient list → **no department filter** (all roles including DOCTOR see all patients)
- Route: `GET|POST /api/departments`, `GET|PATCH|DELETE /api/departments/:departmentId`.
- Roles that can manage departments: HOSPITAL_ADMIN, ADMIN, MANAGER.
- Frontend: `client/app/(dashboard)/departments/page.tsx`, API slice `client/store/api/department.api.ts`.
  - Departments table shows a **Doctors chip list** (all doctors whose `departmentIds` includes that department) instead of a single head doctor.
  - OPD new visit form (`client/app/(dashboard)/opd/page.tsx`) shows a **Department** dropdown first; selecting a department filters the **Assign Doctors** add/remove section. Multiple doctors can be added via a dropdown + "Add" button; each added doctor appears as a chip with an × to remove. Changing department resets the add-dropdown selection (existing chips remain). `CreateOPDVisitRequest.doctorIds` is `string[]` (optional). The form also has a mandatory **Payment** section: **Amount (₹)** (required, > 0) and **Payment Mode** toggle (Cash / UPI / Card, required). On submit, the visit is created first, then a manual payment record is created via `POST /api/payments/manual` with description `"OPD Consultation – Visit #<queueNumber>"`. Backend: `CreateManualPaymentSchema` accepts CASH, CHEQUE, UPI, CARD. **OPD VisitPanel** (view mode) fetches and displays payment amount and mode for the visit date using `GET /api/payments?patientId=&dateFrom=&dateTo=`.
  - OPD edit visit panel (`VisitPanel` in the same file) exposes **Department** (filter) and **Assigned Doctors** (multi-add/remove chips) in edit mode. `UpdateOPDVisitRequest.doctorIds` replaces the full array on save.
  - **OPD Vitals** — a **Vitals** section (Weight, Height, Blood Pressure, Sugar, Body Temperature) lives only in the OPD Edit form (not at visit creation, not on Complete). `IOPDVisit.vitals` (`opd.model.ts`'s `IOPDVitals`, no `_id`) holds `weight`/`height`/`bloodPressure`/`sugar`/`bodyTemperature`, each independently nullable and defaulting to `null` — a visit with nothing recorded still returns the fully-shaped object, never `undefined`. Units are fixed: weight in kg, height in cm, blood pressure as a `"<systolic>/<diastolic>"` string in mmHg (e.g. `120/80`), sugar in mg/dL, body temperature in °F. Encrypted at rest via `ENCRYPTED_CLINICAL_FIELDS.objectFields` (see **Field-Level Encryption**) — the four numeric sub-fields are schema-typed `Schema.Types.Mixed` (not `Number`, not `String`) so ciphertext can be stored without a CastError and a decrypted `number` isn't silently re-cast to a string on a hydrated read; every read path (hydrated or `.lean()`) still hands callers back real numbers. `UpdateOPDVisitRequest.vitals` is `Partial<OPDVitals>` — `OPDService.updateVisit` **merges** only the sub-fields sent onto the visit's existing vitals (reading each field explicitly off the Mongoose subdocument rather than object-spreading it, which would otherwise pick up Mongoose's internal `$__parent`/`_doc` bookkeeping instead of the real values), so recording one reading never wipes the others; sending a field as `null` explicitly clears it. `OPDController`'s `vitalsSchema` validates ranges (weight 0.5–500, height 20–300, sugar 10–1000, body temperature 80–115) and the blood-pressure format (`/^\d{2,3}\/\d{2,3}$/`). **Role gate**: only DOCTOR, NURSE, and HOSPITAL_ADMIN can add/update vitals — enforced by `PATCH /api/opd/visits/:visitId`'s existing route-level `requireRole` (no other role reaches this endpoint at all) plus `NURSE_EDITABLE_FIELDS` in `opd.controller.ts`, which now includes `'vitals'` alongside `'notes'` (a Nurse may still not touch diagnosis/prescription/doctorIds/visitDate). Frontend: `VisitPanel`'s Edit form (both the Nurse's notes-only variant and the full Doctor/Hospital-Admin variant — Vitals is the one section common to both) renders five inputs with unit-labelled placeholders (`Weight (kg)`, `Height (cm)`, `Blood Pressure (mmHg)`, `Sugar (mg/dL)`, `Body Temperature (°F)`); both edit `<form>`s set `noValidate` so the number inputs' `min`/`max` stay UX hints only — without it, a browser blocks form submission natively on an out-of-range value before the app's own validation (and its styled error banner) ever runs. `openEdit()` re-seeds the vitals inputs from the current visit every time Edit mode is entered — the same fix that keeps Diagnosis/Prescription/Notes from going stale across Edit → Complete — so previously-saved vitals always pre-fill correctly. View mode and the standalone `client/app/(dashboard)/opd/[visitId]/page.tsx` detail page both render whatever vitals are recorded (each field independently, omitted when `null`). The printable OPD parcha (`client/app/(dashboard)/opd/[visitId]/print/page.tsx`) replaces its old blank handwriting box with a left-side **Vitals** box (same five fields, unit labels always printed, value on a ruled line left blank when unrecorded so the sheet stays fillable by hand) alongside a right-side **Diagnosis / Prescription / Notes** box — both fed by the same `useGetOPDVisitByIdQuery`, so the printed sheet always reflects whatever was most recently saved (the query's `'OPD'` tag is invalidated by every Edit/Complete save, per `opd.api.ts`).
  - IPD new admission modal (`client/app/(dashboard)/ipd/page.tsx`) shows an **optional Department** dropdown followed by an **Assigned Doctors** multi-add/remove section (same chip pattern). Both department and doctors are optional — an admission can be created without any doctor assigned (`assignedDoctorIds` defaults to `[]`). The modal also has a mandatory **Payment** section: **Amount (₹)** (required, > 0) and **Payment Mode** toggle (Cash / UPI / Card, required). On submit, the admission is created first, then a manual payment record is created via `POST /api/payments/manual` with description `"IPD Admission"`. `IIPDAdmission.assignedDoctorIds` is `string[]` (schema: `[String]`, default `[]`). **IPD AdmissionPanel** (view mode) fetches and displays payment amount and mode for the admission date using `GET /api/payments?patientId=&dateFrom=&dateTo=`. Payment endpoint supports `patientId` query filter.
  - IPD admissions table has a **View** button on every row; opens `AdmissionPanel` slide-over showing ward, bed, doctors, dates, and notes count. Edit mode allows changing department filter → doctors (multi-add/remove), ward, and bed (grid picker showing availability). Backend: `PATCH /api/ipd/admissions/:admissionId` accepts optional `assignedDoctorIds: string[]`, `wardId`, `bedId`; validates all doctors in the array; re-stamps `departmentId` from first doctor's `departmentIds[0]`; releases old bed and occupies new bed atomically.

---

## AIDLC Methodology

This project follows an AI-Driven Development Life Cycle tracked in `aidlc-docs/`. Key files:
- `aidlc-docs/aidlc-state.md` — current phase/stage tracking
- `aidlc-docs/enhancement-tasks.md` — v1.1 QA enhancement tasks (E01–E09), each broken into backend + frontend sub-tasks with effort labels (XS/S/M)
- `aidlc-docs/inception/requirements/requirements.md` — approved functional requirements
- **Application code lives only in the workspace root — never in `aidlc-docs/`**

### Enhancement Task Format
Task IDs follow `E<module>-<B|F><seq>` (e.g., `E06-B03` = Pathology/Radiology backend task 3). Backend tasks must be completed before their dependent frontend tasks. Tests are always the last backend tasks in each enhancement.

---

## Environment

Backend `.env` (see `server/.env.example`):
- `MONGODB_URI`, `JWT_SECRET`, `JWT_INVITE_SECRET`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `DASHBOARD_CACHE_TTL_SECONDS` (default: 60), `RATE_LIMIT_MAX` (default: 100)
- `AADHAAR_ENCRYPTION_KEY` (required), `MEDICAL_DATA_ENCRYPTION_KEY` (optional, falls back to the Aadhaar key) — base64-encoded 32-byte AES-256-GCM keys; see **Field-Level Encryption**

Frontend `.env` (see `client/.env.example`):
- `NEXT_PUBLIC_API_URL=http://localhost:5000`
- `NEXT_PUBLIC_WS_URL=ws://localhost:5000`
