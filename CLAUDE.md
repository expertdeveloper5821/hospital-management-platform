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

### Department Module
`server/src/modules/department/` — CRUD for clinical departments (Cardiology, Radiology, etc.).
- Each `IUser` document has a **`departmentIds: string[]`** field (default `[]`); only **DOCTOR** can be assigned to departments during user creation (the create-user form shows a checkbox multi-select only for the DOCTOR role; NURSE, PATHOLOGIST, and RADIOLOGIST are not department-assigned at creation).
- `IPatient` documents retain a legacy `departmentId: string | null` field but **department is no longer assigned during patient registration or editing** and is not shown in the patient detail view.
- `IPatient` has two registration-payment fields: `registrationFee: number | null` and `registrationPaymentMethod: string | null` (both default `null`). When a patient is registered with a paid fee, `createPatient` in `patient.controller.ts` calls `paymentService.createManualPayment` (description: `"Patient Registration Fee"`) after saving — payment failure does not roll back patient creation. The fee and payment mode are stored on the patient document so they appear on the medical card PDF footer (rendered by `pdfService.generateMedicalCard` when `registrationFee` is set). The patient registration form (`client/app/(dashboard)/patients/page.tsx`) has a **Registration Type** toggle (Free / Paid); selecting Paid reveals **Fee (₹)** input and **Payment Mode** (Cash / UPI / Card) buttons — both mandatory when Paid. The patient detail panel shows Fee and Payment Mode in the Details tab. Existing patients without a fee show "Free".
- `IIPDAdmission` carries `assignedDoctorIds: string[]` (array, default `[]`) and `departmentId` (copied from first doctor's `departmentIds[0]` at admission time; `null` when no doctors assigned).
- `IPathologyRequest` and `IRadiologyRequest` carry `departmentId` (copied from `requester.departmentIds[0]` at request time).
- `IOPDVisit` carries `doctorIds: string[]` (array, default `[]`) and `departmentId` (copied from the patient's department at visit creation) for historical record.
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

Frontend `.env` (see `client/.env.example`):
- `NEXT_PUBLIC_API_URL=http://localhost:5000`
- `NEXT_PUBLIC_WS_URL=ws://localhost:5000`
