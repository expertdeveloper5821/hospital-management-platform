# Enhancement Tasks — HMS v1.1 (QA Rework Phase)

**Version**: 1.1  
**Date**: 2026-05-27  
**Status**: E01 COMPLETE — Remaining tasks awaiting implementation instruction  
**Prerequisites**: All Units 1–7 complete. No tasks in this file modify existing passing tests or existing API contracts.

> Tasks are grouped by enhancement requirement. Each task is self-contained and ordered for minimal inter-task dependency. Implementation SHALL NOT begin until explicitly instructed.

---

## Task Numbering Convention

`E<module>-<sequence>` where module codes:
- `E01` = Dashboard Analytics
- `E02` = Header Action Items
- `E03` = Staff Profile Update
- `E04` = Users List Improvements
- `E05` = Patients Module
- `E06` = Pathology/Radiology Actions
- `E07` = Inventory Module

---

## E01 — Dashboard Analytics ✅ COMPLETE

> Implemented 2026-06-09 to 2026-06-10. All backend tasks done inline (no separate component files — widgets are co-located in `dashboard/page.tsx`). Permission-corrected 2026-06-10 to align Quick Actions with page-level `canXxx` arrays and make all section visibility data-driven.

### Backend Tasks

| Task ID | Title | Status |
|---|---|---|
| E01-B01 | `dashboard.types.ts` — `DashboardStats` + `RecentActivity` + `ROLE_FIELD_ACCESS` for 12 roles | ✅ Done |
| E01-B02 | `dashboard.service.ts` — 18 parallel aggregations, 60s TTL cache per `tenantId+role` | ✅ Done |
| E01-B03 | `dashboard.controller.ts` — `GET /stats` + `?refresh=true` bypass | ✅ Done |
| E01-B04 | `dashboard.routes.ts` — registered with `authenticateJWT → scopeTenant → requireRole` | ✅ Done |
| E01-B05 | Dashboard routes registered in `app.ts` | ✅ Done |
| E01-B06 | `DASHBOARD_CACHE_TTL_SECONDS` env var with default 60 | ✅ Done |
| E01-B07 | Unit tests — role filtering, cache hit/miss, aggregation correctness | ✅ Done |
| E01-B08 | Integration tests | ⬜ Pending |

### Frontend Tasks

| Task ID | Title | Status |
|---|---|---|
| E01-F01 | `store/api/dashboard.api.ts` — RTK Query + 60s poll + `?refresh=true` | ✅ Done |
| E01-F02 | `MetricCard`, `AlertCard`, `QuickAction` components (co-located in page) | ✅ Done |
| E01-F03 | `AreaChart` OPD + Revenue trend charts with gradient fills | ✅ Done |
| E01-F04 | Critical Alerts section with warning colors | ✅ Done |
| E01-F05 | Loading skeleton (pulse animation) | ✅ Done |
| E01-F06 | `dashboard/page.tsx` — full rebuild; purely data-driven; Quick Actions match page-level permissions | ✅ Done |
| E01-F07 | Component unit tests | ⬜ Pending |

---

## E02 — Header Action Items

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E02-B01 | Create `search.types.ts` — define `SearchResult`, `SearchResponse` types; define valid `entityType` enum | `server/src/modules/search/search.types.ts` | None | XS |
| E02-B02 | Create `search.service.ts` — parallel search across patients, doctors, staff, appointments, reports; case-insensitive regex; 5 results per entity; returns `SearchResult[]` per type | `server/src/modules/search/search.service.ts` | E02-B01 | M |
| E02-B03 | Create `search.controller.ts` — validate `q` (min 2, max 100 chars); optional `type` filter; call service; return grouped results | `server/src/modules/search/search.controller.ts` | E02-B02 | S |
| E02-B04 | Create `search.routes.ts` — register `GET /api/v1/search` with auth middleware + rate limit (30 req/min/user) | `server/src/modules/search/search.routes.ts` | E02-B03 | XS |
| E02-B05 | Register search routes in `app.ts` | `server/src/app.ts` | E02-B04 | XS |
| E02-B06 | Write unit tests for `SearchService` — test each entity type search; test query escaping; test 5-result cap | `server/tests/unit/search/search.service.test.ts` | E02-B02 | S |
| E02-B07 | Write integration tests for `GET /api/v1/search` — test 400 on short query, 403 on unauthenticated, grouped results shape | `server/tests/integration/search/search.routes.test.ts` | E02-B05 | S |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E02-F01 | Create `store/api/search.api.ts` — RTK Query lazy query for global search (not auto-triggered) | `client/store/api/search.api.ts` | E02-B05 | XS |
| E02-F02 | Create `SearchOverlay.tsx` — modal overlay; `Ctrl+K`/`Cmd+K` shortcut; debounced input 300ms; grouped results; keyboard navigation; Escape to close | `client/components/header/SearchOverlay.tsx` | E02-F01 | M |
| E02-F03 | Create `ProfileDropdown.tsx` — initials avatar; full name + role badge; My Profile / Change Password / Logout menu items | `client/components/header/ProfileDropdown.tsx` | None | S |
| E02-F04 | Update Layout Shell header slot — integrate `SearchOverlay`, `ProfileDropdown`, and existing notification bell into header action bar | `client/components/layout/Header.tsx` (or equivalent) | E02-F02, E02-F03 | S |
| E02-F05 | Add mobile hamburger menu — shadcn Sheet drawer containing sidebar nav items; hidden on ≥ 768px | `client/components/layout/MobileNav.tsx` | None | S |
| E02-F06 | Write unit tests for `SearchOverlay` and `ProfileDropdown` components | `client/__tests__/header/` | E02-F02, E02-F03 | S |

---

## E03 — Staff Profile Update

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E03-B01 | Add `profileImageUrl: { type: String, default: null }` to existing User Mongoose schema | `server/src/modules/user/user.model.ts` | None | XS |
| E03-B02 | Add `GET /api/v1/users/me` handler — return authenticated user's profile (exclude passwordHash); query by userId from JWT | `server/src/modules/user/user.controller.ts` | E03-B01 | XS |
| E03-B03 | Add `PATCH /api/v1/users/me/profile` handler — Zod validation for editable fields; update user document; write audit log | `server/src/modules/user/user.controller.ts` | E03-B02 | S |
| E03-B04 | Add `PATCH /api/v1/users/me/password` handler — verify `currentPassword` with bcrypt; hash new password; add current token to denylist; return 200 with re-auth message | `server/src/modules/auth/auth.controller.ts` or `user.controller.ts` | None | S |
| E03-B05 | Add `POST /api/v1/users/me/profile-image` handler — validate MIME type (JPEG/PNG/WebP, ≤ 2MB); upload to S3 `profile-images/<tenantId>/<userId>.<ext>`; delete old image if present; update `profileImageUrl`; write audit log | `server/src/modules/user/user.controller.ts` | E03-B01 | M |
| E03-B06 | Create `users/me.routes.ts` (or extend `user.routes.ts`) — register all 4 `/me` routes with `authenticateJWT` + `scopeTenant`; NO `requireRole` restriction (all roles permitted) | `server/src/modules/user/user.routes.ts` | E03-B02, E03-B03, E03-B04, E03-B05 | XS |
| E03-B07 | Write unit tests for `/me` handlers — test profile update, password change (correct/incorrect current password), image upload (valid/invalid MIME, size) | `server/tests/unit/user/user.me.test.ts` | E03-B02–E03-B05 | M |
| E03-B08 | Write integration tests for `/me` endpoints — test auth enforcement, audit log creation, S3 upload stub | `server/tests/integration/user/user.me.routes.test.ts` | E03-B06 | M |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E03-F01 | Add `getMyProfile`, `updateMyProfile`, `changeMyPassword`, `uploadProfileImage` to `store/api/user.api.ts` — additive only | `client/store/api/user.api.ts` | E03-B06 | S |
| E03-F02 | Create `app/(dashboard)/profile/page.tsx` — profile image preview + upload; firstName/lastName/phone form; Save Changes with toast | `client/app/(dashboard)/profile/page.tsx` | E03-F01 | M |
| E03-F03 | Create `app/(dashboard)/profile/change-password/page.tsx` — currentPassword / newPassword / confirmPassword form; password strength indicator; on success redirect to `/login` with toast | `client/app/(dashboard)/profile/change-password/page.tsx` | E03-F01 | S |
| E03-F04 | Wire `/profile` navigation link from `ProfileDropdown` (E02-F03) | `client/components/header/ProfileDropdown.tsx` | E03-F02, E02-F03 | XS |
| E03-F05 | Write unit tests for profile page and change-password page | `client/__tests__/profile/` | E03-F02, E03-F03 | S |

---

## E04 — Users List Improvements

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E04-B01 | Extend `UserRepository.findAll()` to accept filter params: `search`, `role`, `status`, `sortBy`, `sortOrder`, `page`, `limit` — additive; default behavior unchanged | `server/src/modules/user/user.repository.ts` | None | S |
| E04-B02 | Add compound index `{ tenantId: 1, role: 1, status: 1 }` to User schema if not present | `server/src/modules/user/user.model.ts` | None | XS |
| E04-B03 | Update `UserController.listUsers()` to extract and pass new query params to repository; validate params with Zod; clamp `limit` to 100 | `server/src/modules/user/user.controller.ts` | E04-B01 | S |
| E04-B04 | Write new test cases for `GET /api/v1/users` with filter/pagination params — added to existing test file, no existing tests removed | `server/tests/integration/user/user.routes.test.ts` | E04-B03 | S |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E04-F01 | Extend `store/api/user.api.ts` `getUsers` query to accept `search`, `role`, `status`, `sortBy`, `sortOrder`, `page`, `limit` params — additive | `client/store/api/user.api.ts` | E04-B03 | XS |
| E04-F02 | Enhance users table in Admin Panel — add search bar (300ms debounce), role filter dropdown, status filter dropdown, sortable column headers, pagination controls, total count label | `client/app/(dashboard)/admin/` (users table component) | E04-F01 | M |
| E04-F03 | Add Deactivate action button to user table rows — visible to Admin and HR roles; confirmation modal with last-admin-guard error display | `client/app/(dashboard)/admin/` (users table) | E04-F02 | S |
| E04-F04 | Add loading skeleton rows and empty state to users table | `client/app/(dashboard)/admin/` | E04-F02 | XS |
| E04-F05 | Write unit tests for enhanced users table component | `client/__tests__/admin/` | E04-F02 | S |

---

## E05 — Patients Module Missing Features

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E05-B01 | Add `isDeleted: { type: Boolean, default: false }` and `deletedAt: { type: Date, default: null }` to Patient Mongoose schema | `server/src/modules/patient/patient.model.ts` | None | XS |
| E05-B02 | Add compound index `{ tenantId: 1, isDeleted: 1 }` to patients collection | `server/src/modules/patient/patient.model.ts` | E05-B01 | XS |
| E05-B03 | Update `PatientRepository` — add `{ isDeleted: { $ne: true } }` to all existing query methods; add `softDelete(patientId, tenantId)` method | `server/src/modules/patient/patient.repository.ts` | E05-B01 | S |
| E05-B04 | Add `DELETE /api/v1/patients/:patientId` handler — check active IPD admissions (HTTP 409 if found); call `softDelete`; write audit log | `server/src/modules/patient/patient.controller.ts` | E05-B03 | S |
| E05-B05 | Register `DELETE /api/v1/patients/:patientId` route with `requireRole(['Admin', 'Manager'])` | `server/src/modules/patient/patient.routes.ts` | E05-B04 | XS |
| E05-B06 | Extend OPD history endpoint — add `page`, `limit`, `startDate`, `endDate`, `status`, `search` params to `OpdRepository.getPatientHistory()`; validate `startDate <= endDate` | `server/src/modules/opd/opd.repository.ts`, `opd.controller.ts` | None | M |
| E05-B07 | Add compound index `{ tenantId: 1, patientId: 1, visitDate: -1 }` to opd_visits collection | `server/src/modules/opd/opd.model.ts` | None | XS |
| E05-B08 | Write unit tests for soft-delete (active IPD guard, audit log); write new OPD history filter tests | `server/tests/unit/patient/`, `server/tests/unit/opd/` | E05-B04, E05-B06 | M |
| E05-B09 | Write integration tests for `DELETE /patients/:id`; write new integration tests for OPD history filter params | `server/tests/integration/patient/`, `server/tests/integration/opd/` | E05-B05, E05-B06 | M |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E05-F01 | Add `deletePatient` mutation to `store/api/patient.api.ts` — additive | `client/store/api/patient.api.ts` | E05-B05 | XS |
| E05-F02 | Add Delete Patient button + confirmation modal to patient detail page — visible to Admin/Manager only; handle 409 error display | `client/app/(dashboard)/patients/` | E05-F01 | S |
| E05-F03 | Add OPD History filters (date range, status, search) and pagination to patient OPD History tab | `client/app/(dashboard)/patients/` | E05-B06 | M |
| E05-F04 | Add loading skeleton and empty state to OPD History tab | `client/app/(dashboard)/patients/` | E05-F03 | XS |
| E05-F05 | Write unit tests for Delete Patient modal and OPD History filter components | `client/__tests__/patients/` | E05-F02, E05-F03 | S |

---

## E06 — Pathology/Radiology Actions

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E06-B01 | Add `isDeleted`, `deletedAt`, `notes`, `priority` optional fields to lab request Mongoose schemas (both pathology and radiology) | `server/src/modules/lab/lab.model.ts` | None | XS |
| E06-B02 | Update `LabRepository` — add `{ isDeleted: { $ne: true } }` to all existing list/pending-queue queries; add `softDelete()` method | `server/src/modules/lab/lab.repository.ts` | E06-B01 | S |
| E06-B03 | Add `PATCH /api/v1/lab/pathology/:requestId` handler — reject if `COMPLETED`; validate body with Zod; update document; write audit log | `server/src/modules/lab/lab.controller.ts` | E06-B02 | S |
| E06-B04 | Add `DELETE /api/v1/lab/pathology/:requestId` handler — role-based delete permission (COMPLETED only Admin/Manager); softDelete; write audit log | `server/src/modules/lab/lab.controller.ts` | E06-B02 | S |
| E06-B05 | Add `PATCH /api/v1/lab/radiology/:requestId` and `DELETE /api/v1/lab/radiology/:requestId` handlers (mirror of E06-B03/B04 for radiology) | `server/src/modules/lab/lab.controller.ts` | E06-B02 | S |
| E06-B06 | Register new lab routes with appropriate `requireRole` middleware | `server/src/modules/lab/lab.routes.ts` | E06-B03, E06-B04, E06-B05 | XS |
| E06-B07 | Add `LAB_REQUEST` to `AuditEntityType` enum if not already present | `server/src/shared/types/common.types.ts` | None | XS |
| E06-B08 | Write unit tests for edit (COMPLETED guard, Zod validation) and delete (role guard, soft-delete) for both pathology and radiology | `server/tests/unit/lab/` | E06-B03–E06-B05 | M |
| E06-B09 | Write integration tests for new lab PATCH and DELETE endpoints | `server/tests/integration/lab/` | E06-B06 | M |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E06-F01 | Add `updatePathologyRequest`, `deletePathologyRequest`, `updateRadiologyRequest`, `deleteRadiologyRequest` mutations to `store/api/lab.api.ts` — additive | `client/store/api/lab.api.ts` | E06-B06 | S |
| E06-F02 | Add Edit (pencil) and Delete (trash) action buttons to pending lab request list rows — visible to permitted roles | `client/app/(dashboard)/lab/` | E06-F01 | S |
| E06-F03 | Create Edit modal for lab requests — pre-populated form; disable for COMPLETED; show toast on save | `client/app/(dashboard)/lab/` | E06-F01 | S |
| E06-F04 | Create Delete confirmation modal — handle 404 (already deleted) gracefully | `client/app/(dashboard)/lab/` | E06-F01 | S |
| E06-F05 | Write unit tests for Edit and Delete modals | `client/__tests__/lab/` | E06-F03, E06-F04 | S |

---

## E07 — Inventory Module Edit and Delete

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E07-B01 | Add `isDeleted`, `deletedAt` optional fields to Inventory Mongoose schema | `server/src/modules/inventory/inventory.model.ts` | None | XS |
| E07-B02 | Update `InventoryRepository` — add `{ isDeleted: { $ne: true } }` to all existing list/filter queries; add `softDelete()` method | `server/src/modules/inventory/inventory.repository.ts` | E07-B01 | S |
| E07-B03 | Add `PATCH /api/v1/inventory/:itemId` handler — validate editable fields (itemName, category, unitOfMeasure, minimumThreshold); reject `currentStock` in body; trigger low-stock check if threshold raised; write audit log | `server/src/modules/inventory/inventory.controller.ts` | E07-B02 | S |
| E07-B04 | Add `DELETE /api/v1/inventory/:itemId` handler — dependency check (if applicable); softDelete; write audit log | `server/src/modules/inventory/inventory.controller.ts` | E07-B02 | S |
| E07-B05 | Add `GET /api/v1/inventory/:itemId/stock-history` handler — query AuditRepository for `INVENTORY_ITEM` UPDATE entries; paginated at 20/page | `server/src/modules/inventory/inventory.controller.ts` | None | S |
| E07-B06 | Register new inventory routes — `PATCH /:itemId`, `DELETE /:itemId`, `GET /:itemId/stock-history` with `requireRole(['Manager', 'Admin'])` | `server/src/modules/inventory/inventory.routes.ts` | E07-B03, E07-B04, E07-B05 | XS |
| E07-B07 | Add `INVENTORY_ITEM` to `AuditEntityType` enum if not already present | `server/src/shared/types/common.types.ts` | None | XS |
| E07-B08 | Write unit tests for inventory edit (low-stock trigger, Zod validation), delete (dependency guard), and stock-history pagination | `server/tests/unit/inventory/` | E07-B03–E07-B05 | M |
| E07-B09 | Write integration tests for new inventory PATCH, DELETE, and stock-history endpoints | `server/tests/integration/inventory/` | E07-B06 | M |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E07-F01 | Add `updateInventoryItem`, `deleteInventoryItem`, `getStockHistory` to `store/api/inventory.api.ts` — additive | `client/store/api/inventory.api.ts` | E07-B06 | S |
| E07-F02 | Add Edit (pencil) and Delete (trash) action buttons to inventory list rows — visible to Manager/Admin only | `client/app/(dashboard)/inventory/` | E07-F01 | S |
| E07-F03 | Create Edit Inventory Item modal — pre-populated metadata form; no `currentStock` field; toast on save | `client/app/(dashboard)/inventory/` | E07-F01 | S |
| E07-F04 | Create Delete Inventory Item confirmation modal with audit-preserve note | `client/app/(dashboard)/inventory/` | E07-F01 | S |
| E07-F05 | Create Stock History drawer — paginated list of stock adjustment audit entries per item | `client/app/(dashboard)/inventory/` | E07-F01 | M |
| E07-F06 | Write unit tests for Edit, Delete, and Stock History components | `client/__tests__/inventory/` | E07-F03, E07-F04, E07-F05 | S |

---

## E08 — Login UI Simplification

> **Backend impact**: None — the existing `POST /api/v1/auth/login` endpoint and all auth logic are unchanged.

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E08-F01 | Refactor login form in-place — remove any extra fields; keep exactly two inputs: `email` (type email, auto-focused) and `password` (type password, with show/hide toggle); update Zod client schema to `{ email: z.string().email(), password: z.string().min(1) }`; full-width "Sign In" button; "Forgot Password?" link preserved; platform logo above form; no sign-up or social login options | `client/app/(auth)/login/page.tsx` | None | S |
| E08-F02 | Add inline field-level validation on blur (email format, required password); loading spinner on button during API call; non-field error banner for 401 ("Invalid email or password.") and 403 ("Account locked") responses; center card (max-width 400px desktop, full-width mobile); `aria-label` / `aria-live` for accessibility; keyboard submit via Enter | `client/app/(auth)/login/page.tsx` | E08-F01 | S |
| E08-F03 | Update existing login component unit tests to reflect simplified field set (remove assertions on any removed fields; add assertions for email validation, password show/hide, error banner rendering) | `client/__tests__/auth/login.test.tsx` | E08-F01 | S |

---

## E09 — Super Admin Platform Settings

> **Scope**: Platform-level branding managed by Super Admin only. Completely separate from per-tenant hospital branding (FR-03). No existing collections or routes are modified.

### Backend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E09-B01 | Create `platform-settings` Mongoose model — fields: `logoUrl`, `faviconUrl`, `platformTitle`, `updatedAt`, `updatedBy`; singleton document pattern (upsert by fixed ID); no `tenantId` | `server/src/modules/tenant/platform-settings.model.ts` | None | XS |
| E09-B02 | Create `PlatformSettingsRepository` — `get()` (returns defaults if no doc), `upsert(fields)` methods | `server/src/modules/tenant/platform-settings.repository.ts` | E09-B01 | S |
| E09-B03 | Add `GET /api/v1/super-admin/platform-settings` handler — public (no auth); returns `{ logoUrl, faviconUrl, platformTitle, updatedAt }`; apply 30 req/min IP rate limit | `server/src/modules/tenant/tenant.controller.ts` | E09-B02 | XS |
| E09-B04 | Add `PATCH /api/v1/super-admin/platform-settings` handler — Super Admin auth; Zod validate `platformTitle` (min 1, max 100, HTML-escaped); upsert; write audit log | `server/src/modules/tenant/tenant.controller.ts` | E09-B02 | S |
| E09-B05 | Add `POST /api/v1/super-admin/platform-settings/logo` handler — Super Admin auth; validate MIME (magic bytes: JPEG/PNG/SVG/WebP, ≤ 2 MB); upload to S3 `platform/logo.<ext>`; delete old S3 file if present; upsert `logoUrl`; write audit log | `server/src/modules/tenant/tenant.controller.ts` | E09-B02 | M |
| E09-B06 | Add `POST /api/v1/super-admin/platform-settings/favicon` handler — Super Admin auth; validate MIME (ICO/PNG, ≤ 500 KB); upload to S3 `platform/favicon.<ext>`; delete old S3 file if present; upsert `faviconUrl`; write audit log | `server/src/modules/tenant/tenant.controller.ts` | E09-B02 | M |
| E09-B07 | Register all 4 platform-settings routes in existing `tenant.routes.ts` — GET public (no auth middleware); PATCH + 2×POST with Super Admin auth middleware | `server/src/modules/tenant/tenant.routes.ts` | E09-B03–E09-B06 | XS |
| E09-B08 | Add `PLATFORM_SETTINGS` to `AuditEntityType` enum | `server/src/shared/types/common.types.ts` | None | XS |
| E09-B09 | Write unit tests for `PlatformSettingsRepository` (get defaults, upsert); write unit tests for each handler (valid upload, file too large, wrong MIME, title too long) | `server/tests/unit/tenant/platform-settings.test.ts` | E09-B02–E09-B06 | M |
| E09-B10 | Write integration tests for all 4 platform-settings endpoints — test public GET (no token needed), PATCH title update, logo upload (valid + oversized + wrong type), favicon upload (valid + oversized + wrong type) | `server/tests/integration/tenant/platform-settings.routes.test.ts` | E09-B07 | M |

### Frontend Tasks

| Task ID | Title | Files | Dependencies | Effort |
|---|---|---|---|---|
| E09-F01 | Create `store/api/platformSettings.api.ts` — RTK Query slice with `getPlatformSettings` (public query, no auth header), `updatePlatformTitle` mutation, `uploadPlatformLogo` mutation, `uploadPlatformFavicon` mutation | `client/store/api/platformSettings.api.ts` | E09-B07 | S |
| E09-F02 | Create `app/(super-admin)/platform-settings/page.tsx` — three independent sections: Logo (preview + upload + save), Favicon (preview + upload + save), Title (text input + save); each section has its own loading/error state; toast on save; inline error on invalid file | `client/app/(super-admin)/platform-settings/page.tsx` | E09-F01 | M |
| E09-F03 | Add "Platform Settings" nav item to Super Admin Console sidebar (FC-03) linking to `/super-admin/platform-settings` | `client/components/layout/` (Super Admin sidebar) | E09-F02 | XS |
| E09-F04 | Update login page (`app/(auth)/login/page.tsx`) — fetch `getPlatformSettings` on mount (public); render `logoUrl` above form if present; set `document.title` from `platformTitle`; inject favicon `<link>` tag; graceful fallback if fetch fails | `client/app/(auth)/login/page.tsx` | E09-F01 | S |
| E09-F05 | Update dashboard layout (`app/(dashboard)/layout.tsx`) — apply `platformTitle` and `faviconUrl` globally for authenticated users via Next.js metadata or `useEffect`; reuse cached `getPlatformSettings` result | `client/app/(dashboard)/layout.tsx` | E09-F01 | S |
| E09-F06 | Write unit tests for platform settings page (logo section, favicon section, title section — success and error states) | `client/__tests__/super-admin/platform-settings.test.tsx` | E09-F02 | S |

---

## Implementation Order Recommendation

The tasks above are independent enough to be implemented in parallel per module. The recommended sequencing for a single developer:

```
Phase 1 — Pure additions (no existing file changes, lowest risk):
  E01-B01–B06, E02-B01–B05, E07-B01, E06-B01, E05-B01–B02, E09-B01, E09-B08

Phase 2 — Existing schema/repo extensions (additive only):
  E03-B01, E04-B01–B02, E05-B03, E05-B07, E06-B02, E07-B02, E09-B02

Phase 3 — New controller handlers + route registrations:
  E03-B02–B06, E04-B03, E05-B04–B06, E06-B03–B06, E07-B03–B06, E09-B03–B07

Phase 4 — Tests:
  All *-B07/B08/B09/B10 tasks

Phase 5 — Frontend (parallel with Phase 4):
  All *-F01 tasks (RTK Query slices) → then *-F02 onward per module
  E08-F01 (login UI — standalone, no dependencies)
  E09-F01, E09-F04, E09-F05 (platform settings API + login/layout integration)

Phase 6 — Frontend tests:
  All *-F05/F06/F07 tasks
  E08-F02, E09-F06
```

---

## Definition of Done (Per Task)

- [ ] Backend: new endpoint responds correctly (verified via integration test)
- [ ] Backend: Zod validation rejects invalid input with HTTP 400
- [ ] Backend: RBAC enforced (HTTP 403 for unauthorized roles)
- [ ] Backend: `tenantId` scoping enforced (no cross-tenant data leakage)
- [ ] Backend: Audit log entry written for all write operations
- [ ] Backend: Unit tests pass; integration tests pass; no existing tests broken
- [ ] Frontend: Component renders correctly in all target role contexts
- [ ] Frontend: Loading and empty states implemented
- [ ] Frontend: Toast notifications shown on success and error
- [ ] Frontend: Mobile responsive (≥ 320px width)
- [ ] Frontend: Unit tests pass; no existing tests broken
- [ ] No new TypeScript `any` types introduced
- [ ] No existing API routes modified (only additive)
- [ ] No existing Mongoose schema fields removed or renamed
