# Code Generation Plan — Unit 7-B: Admin Panels

**Unit**: U7-B — Super Admin Console (FC-03) + Hospital Admin Panel (FC-04)  
**Stage**: Code Generation  
**Status**: COMPLETE  
**Branch**: `feature/u7-B`  
**Date**: 2026-05-19  
**Post-construction enhancements**: branch `toastify`, 2026-05-25

---

## Unit Context

**Stories implemented by U7-B**:
- US-SA-01 — Super Admin onboards a new hospital (creates tenant record)
- US-SA-02 — Super Admin approves / deactivates a hospital tenant
- US-HA-01 — Hospital Admin configures branding (logo, display name, primary colour)
- US-HA-02 — Hospital Admin manages users (create, role change, deactivate)

**Frontend components implemented**:
- FC-03: Super Admin Console
- FC-04: Hospital Admin Panel

**Backend consumed** (no backend changes at construction time):
- `POST /api/tenants` — create tenant
- `GET /api/tenants` — list tenants (paginated)
- `PATCH /api/tenants/:id/approve` — approve tenant
- `PATCH /api/tenants/:id/deactivate` — deactivate tenant
- `POST /api/tenants/:id/resend-invite` — resend invite email
- `GET /api/tenants/:id/branding` — get branding config
- `PATCH /api/tenants/:id/branding` — update branding (displayName, primaryColor)
- `POST /api/tenants/:id/branding/logo` — upload logo (multipart/form-data, max 2 MB)
- `GET /api/users` — list users (role filter, pagination)
- `PATCH /api/users/:id/role` — update user role
- `PATCH /api/users/:id/deactivate` — deactivate user
- `POST /api/users` — create user

---

## Files Generated

### RTK Query API slices
- `client/store/api/tenant.api.ts` — tenant CRUD + branding + logo upload + invite endpoints
- `client/store/api/user.api.ts` — user list, create, role update, deactivate

### Pages
- `client/app/(dashboard)/super-admin/page.tsx` — FC-03: tenant list with Approve / Deactivate / Resend Invite actions
- `client/app/(dashboard)/super-admin/new/page.tsx` — FC-03: Onboard New Hospital form
- `client/app/(dashboard)/admin/page.tsx` — FC-04: two-tab page (Branding / User Management)

### Bug fix
- `client/components/shared/Sidebar.tsx` — logout was called with no args; fixed to pass `{ isSuperAdmin: profile?.role === 'SUPER_ADMIN' }`.

---

## FC-03: Super Admin Console — Design Notes

**Layout**: Two pages — list (`/super-admin`) and onboard form (`/super-admin/new`)

**Features**:
1. **Tenant list** — paginated table with status badges (PENDING_VERIFICATION / ACTIVE / INACTIVE). Approve, Deactivate, Resend Invite action buttons per row.
2. **Onboard form** — fields: Hospital Name, Admin Email, Registration Certificate No., GST Number, PAN Card No., Address Proof Ref.
3. **Status transitions** — Approve moves PENDING_VERIFICATION → ACTIVE (sends invite email); Deactivate moves ACTIVE → INACTIVE.

---

## FC-04: Hospital Admin Panel — Design Notes

**Layout**: Single page with two tabs — Branding and User Management

**Features**:
1. **Branding tab** — logo upload (drag or click, 2 MB limit, preview), display name input, primary colour picker. Calls `POST .../logo` then `PATCH .../branding`.
2. **Users tab** — paginated user list with role filter dropdown. Per-row: role edit (select), deactivate button. "Create User" modal with name, email, role fields.
3. All calls scoped by `profile.tenantId` from Redux auth slice.

---

## Post-Construction Enhancements (branch `toastify`, 2026-05-25)

### Backend bug fix — `approveTenant` status ordering
**File**: `server/src/modules/tenant/tenant.service.ts`

**Problem**: `updateStatus(ACTIVE)` was called before `sendInviteEmail()`. If SMTP failed the tenant became ACTIVE with no invite sent, with no error returned to the caller.

**Fix**: Reordered operations — invite token saved first, email sent, and only on email success is `updateStatus(ACTIVE)` called. The email service already throws `AppError` on SMTP failure, so the error propagates and the status remains unchanged.

### Frontend — Onboard Hospital form validations
**File**: `client/app/(dashboard)/super-admin/new/page.tsx`

Replaced HTML `required` attributes with full client-side validation:

| Field | Rule |
|---|---|
| Hospital Name | Required, 3–100 chars |
| Admin Email | Required, valid email regex |
| Registration Certificate | Required, 3–50 chars |
| GST Number | Required, 15-char Indian GST regex (`/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/`) |
| PAN Card | Required, 10-char Indian PAN regex (`/^[A-Z]{5}[0-9]{4}[A-Z]$/`) |
| Address Proof | Required, 3–100 chars |

**UX behaviour**:
- Errors appear on blur per field; all surface on submit attempt
- Submit blocked until all errors resolved (no API call made)
- GST and PAN auto-uppercased before submission; `maxLength` enforced on both inputs
- `noValidate` on `<form>` suppresses browser native popups
- API errors kept in separate `apiError` state, shown below the form fields
- Validation pattern: derived `errors` from form state + `touched` + `submitted` states + `fieldError()` helper
