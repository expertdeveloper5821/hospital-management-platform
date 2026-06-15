---
name: project-hms-department-module
description: Department module added to HMS — scope, data model, doctor-scoped filtering, and frontend
metadata:
  type: project
---

Department module shipped 2026-06-11.

**Backend module**: `server/src/modules/department/` — IDepartment (departmentId, name, description, headDoctorId, soft delete), CRUD routes at `/api/departments`.

**Schema additions**:
- `IUser.departmentId` (optional string)
- `IPatient.departmentId` (optional string)
- `IIPDAdmission.departmentId` (copied from assigned doctor on create)
- `IPathologyRequest.departmentId` / `IRadiologyRequest.departmentId` (copied from requester on create)

**Doctor-scoped filtering** (auto-applied in controllers when `req.user.role === DOCTOR`):
- `searchPatients` → filters by doctor's departmentId
- `listAdmissions` → filters by doctor's departmentId
- `listPathologyRequests` / `listRadiologyRequests` → filters by doctor's departmentId

**Frontend**:
- `client/store/api/department.api.ts` — RTK Query slice
- `client/app/(dashboard)/departments/page.tsx` — CRUD management page
- User-create modal shows department selector for DOCTOR, NURSE, PATHOLOGIST, RADIOLOGIST roles
- Patient-register modal shows department selector (optional)
- Departments nav item added for HOSPITAL_ADMIN, ADMIN, MANAGER in `rbac-nav.ts`

**Why**: Doctors were seeing all patients/IPD/lab records across the hospital. Departments provide organizational scope so each doctor only sees their department's records.

**How to apply**: When adding new list endpoints that return clinical records, check whether DOCTOR-role users should see a filtered view; if so, resolve `userRepository.findById(tenantId, userId).departmentId` in the controller and pass it as a filter.
