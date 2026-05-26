# Code Generation Plan — Unit 7-C: Patient + OPD Frontend

**Unit**: U7-C — Patient Management (FC-05) + OPD Module UI (FC-06)  
**Stage**: Code Generation  
**Status**: COMPLETE  
**Branch**: `feature/u7-C`  
**Date**: 2026-05-21  
**Post-construction enhancements**: branch `toastify`, 2026-05-25

---

## Unit Context

**Stories implemented by U7-C**:
- US-RE-01 — Patient Registration (Receptionist/Nurse/Hospital Admin)
- US-RE-02 — OPD Visit Creation (Receptionist/Nurse/Hospital Admin/Doctor)
- US-DO-01 — Doctor updates OPD visit (diagnosis, prescription, notes)
- US-DO-02 — Doctor completes OPD visit
- US-CC-02 — Patient search by name, mobile, patient ID

**Frontend components implemented**:
- FC-05: Patient Management
- FC-06: OPD Module UI

**Backend consumed** (no backend changes made):
- `GET /api/patients` — search patients (q, page, limit)
- `POST /api/patients` — register patient (duplicate detection via HTTP 409)
- `GET /api/patients/:patientId` — get patient detail
- `PATCH /api/patients/:patientId` — update patient demographics
- `GET /api/patients/:patientId/medical-card` — download PDF (raw response, not JSON)
- `GET /api/opd/visits` — queue (date, doctorId filters)
- `POST /api/opd/visits` — create visit
- `GET /api/opd/visits/:visitId` — get visit
- `PATCH /api/opd/visits/:visitId` — update visit
- `PATCH /api/opd/visits/:visitId/complete` — complete visit
- `PATCH /api/opd/visits/:visitId/cancel` — cancel visit
- `GET /api/opd/patients/:patientId/history` — patient visit history

---

## Files Generated

### RTK Query API slices
- `client/store/api/patient.api.ts` — patient endpoints + blob-download queryFn for medical card
- `client/store/api/opd.api.ts` — OPD endpoints (queue, create, update, complete, cancel, history)

### Type additions to `client/store/types.ts`
- `Gender`, `BloodGroup`
- `PatientResponse`, `CreatePatientRequest`, `UpdatePatientRequest`, `PatientSearchResult`
- `OPDVisitStatus`, `OPDVisitResponse`, `CreateOPDVisitRequest`, `UpdateOPDVisitRequest`, `CompleteOPDVisitRequest`, `OPDPatientHistory`

### Pages
- `client/app/(dashboard)/patients/page.tsx` — FC-05
- `client/app/(dashboard)/opd/page.tsx` — FC-06

---

## FC-05: Patient Management — Design Notes

**Layout**: Single page (no sub-routes)

**Features**:
1. **Search** — debounced text input (400 ms), queries `GET /api/patients?q=...`. Searches name, mobile, patient ID server-side.
2. **Patient table** — responsive (columns hide at sm/md/lg breakpoints). Click any row → slide-over detail panel.
3. **Detail panel** — right-side slide-over showing all patient fields. Has Edit and Medical Card Download actions.
4. **Medical Card Download** — uses `queryFn` with raw `fetch()` to handle the PDF binary response. Creates a blob URL and triggers `<a>` download.
5. **Register modal** — full registration form with all required + optional fields. Optional fields in a `<details>` element to keep the form compact.
6. **Duplicate detection** — if `POST /api/patients` returns HTTP 409 with `data.isDuplicateWarning: true`, displays an inline alert with the `existingPatientId` and "Register anyway" (force create) option.
7. **Edit modal** — pre-populated from selected patient, calls `PATCH /api/patients/:id`.
8. **RBAC** — "Register Patient" button only shown to RECEPTIONIST, NURSE, HOSPITAL_ADMIN. "Edit" button only for RECEPTIONIST, HOSPITAL_ADMIN.

---

## FC-06: OPD Module UI — Design Notes

**Layout**: Single page with inline panels (no sub-routes)

**Features**:
1. **Stats strip** — Today's total / Open / Completed cards.
2. **Filters** — Date picker (default: today) + Doctor dropdown (from `GET /api/users?role=DOCTOR`). Refresh button.
3. **Queue table** — responsive. Rows are clickable → opens visit detail panel.
4. **Visit detail panel** — right-side slide-over with 3 modes: `view`, `edit`, `complete`.
   - **View mode** — shows all visit fields + action buttons.
   - **Edit mode** — editable form for complaint, diagnosis, prescription, notes. Calls `PATCH /api/opd/visits/:id`.
   - **Complete mode** — final diagnosis form. Calls `PATCH /api/opd/visits/:id/complete`. Requires diagnosis.
   - **Cancel** — modal confirmation dialog (not native browser confirm) with "Keep Visit" and "Yes, Cancel Visit" buttons; calls `PATCH /api/opd/visits/:id/cancel` on confirm.
5. **New Visit modal** — patient typeahead search (debounced), doctor dropdown, date picker, chief complaint. Calls `POST /api/opd/visits`.
6. **RBAC**:
   - Create visit: RECEPTIONIST, NURSE, HOSPITAL_ADMIN, DOCTOR
   - Edit: DOCTOR, NURSE, HOSPITAL_ADMIN
   - Complete: DOCTOR, HOSPITAL_ADMIN
   - Cancel: RECEPTIONIST, NURSE, DOCTOR, HOSPITAL_ADMIN

---

## RBAC Alignment

Per `components.md` (BC-04, BC-05) and `patient.routes.ts` / `opd.routes.ts`:
- All role guards are enforced server-side. Frontend RBAC controls UI visibility only.
- TERMINAL statuses (COMPLETED, CANCELLED) suppress action buttons in the visit panel.

---

## Additions Not in Original MD Files

The following details were added during implementation and are documented here for future reference:

1. **`cancelVisit` endpoint** (`PATCH /api/opd/visits/:visitId/cancel`) — present in `opd.routes.ts` and `opd.controller.ts` in the backend but not listed in `components.md` (BC-05). Added to `opd.api.ts` and surfaced in the visit panel UI.

2. **`OPDVisitStatus.IN_PROGRESS`** — the backend `opd.types.ts` defines `IN_PROGRESS` and `CANCELLED` status values in addition to `OPEN` and `COMPLETED` from the inception design. These are handled in the frontend with appropriate badge variants.

3. **`queueNumber` field** — the backend assigns an auto-incremented queue number per visit per day. Displayed in the queue table as the `#` column.

4. **Patient search uses `q` query param** — the `GET /api/patients` endpoint uses `?q=` (not `name=`, `mobile=`, or `patientId=`). The server does unified search across all three fields with one param.

---

## Post-Construction Enhancements (branch `toastify`, 2026-05-25)

### Register / Edit Patient form validations
**File**: `client/app/(dashboard)/patients/page.tsx` — `PatientFormModal` component

Added `validatePatientForm()` pure function; replaced single banner error with per-field inline errors.

| Field | Rule |
|---|---|
| Full Name | Required, 2–100 chars, letters/spaces/dots/hyphens/apostrophes only (`/^[a-zA-Z\s.\-']+$/`) |
| Date of Birth | Required, must be in the past, under 150 years ago |
| Mobile Number | Required, `/^\+?[0-9]{7,15}$/` |
| Address | Required, 10–300 chars |
| Aadhaar (optional) | If filled: exactly 12 digits (`/^\d{12}$/`); input restricted to digits only |
| Emergency Contact Name (optional) | If filled: min 2 chars |
| Emergency Contact Mobile (optional) | If filled: same mobile regex |

**UX behaviour**:
- Errors appear on blur per field; all surface on submit attempt
- Submit blocked until all errors resolved; `handleForceCreate` also respects validation
- Removed duplicate inline mobile checks from `handleSubmit` and `handleForceCreate` — consolidated into `validatePatientForm()`
- `noValidate` on `<form>` suppresses browser native popups
- API errors in separate `apiError` state; duplicate-warning banner unchanged
- Removed unused `cn` import and unused `canEdit` variable
