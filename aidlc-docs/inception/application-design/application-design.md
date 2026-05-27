# Application Design — Hospital Management Platform (HMS)

**Version**: 1.0  
**Date**: 2026-05-12  
**Status**: Approved

---

## Overview

The HMS is a multi-tenant SaaS platform built as a **modular monolith** — a single deployable Node.js + Express + TypeScript application with 11 clearly bounded backend modules, 4 shared infrastructure services, and a Next.js frontend.

---

## Technology Stack

| Layer          | Technology                                                           |
| -------------- | -------------------------------------------------------------------- |
| Frontend       | Next.js (React), Redux Toolkit + RTK Query, shadcn/ui + Tailwind CSS |
| Backend        | Node.js + Express + TypeScript, modular monolith                     |
| Database       | MongoDB (Mongoose ODM), shared collections, tenantId scoping         |
| File Storage   | AWS S3 (pre-signed URLs)                                             |
| Real-time      | WebSocket (ws library)                                               |
| PDF Generation | PDFKit (synchronous)                                                 |
| Email          | Nodemailer (configurable SMTP)                                       |
| Payments       | Razorpay SDK (UPI/Card) + manual recording (Cash/Cheque)             |
| Deployment     | AWS EC2                                                              |
| PBT Framework  | fast-check (TypeScript + Jest)                                       |

---

## Backend Module Summary

| Module              | Code  | Primary Responsibility                                |
| ------------------- | ----- | ----------------------------------------------------- |
| Auth Module         | BC-01 | JWT auth, session management, lockout, password reset |
| Tenant Module       | BC-02 | Hospital onboarding, tenant lifecycle, branding       |
| User Module         | BC-03 | User accounts, roles, RBAC enforcement                |
| Patient Module      | BC-04 | Patient registration, Medical Card PDF                |
| OPD Module          | BC-05 | Outpatient visit lifecycle                            |
| IPD Module          | BC-06 | Inpatient admission, bed registry                     |
| Lab Module          | BC-07 | Pathology + radiology requests and reports            |
| Inventory Module    | BC-08 | Stock management, low-stock alerts                    |
| Payment Module      | BC-09 | Manual payments, Razorpay, receipt PDF                |
| Notification Module | BC-10 | WebSocket notifications, history                      |
| Audit Module        | BC-11 | Append-only audit log                                 |

**Shared Services**: Email (SI-01), S3 (SI-02), PDF (SI-03), WebSocket (SI-04)

---

## Frontend Component Summary

| Component            | Code  | Primary Responsibility                               |
| -------------------- | ----- | ---------------------------------------------------- |
| Auth Shell           | FC-01 | Login, password change, forgot/reset password        |
| Layout Shell         | FC-02 | Navigation (RBAC-aware), notification bell, branding |
| Super Admin Console  | FC-03 | Tenant onboarding and management                     |
| Hospital Admin Panel | FC-04 | Branding config, user management                     |
| Patient Management   | FC-05 | Registration, search, Medical Card                   |
| OPD Module UI        | FC-06 | OPD queue, visit recording                           |
| IPD Module UI        | FC-07 | Admissions, bed registry, progress notes             |
| Lab Module UI        | FC-08 | Lab requests, report upload                          |
| Inventory Module UI  | FC-09 | Stock management                                     |
| Payment Module UI    | FC-10 | Payment recording, receipts, summary                 |
| Notification Panel   | FC-11 | Real-time notifications, history                     |
| Audit Log Viewer     | FC-12 | Audit log query and display                          |

---

## API Design

- **Style**: REST + WebSocket
- **Base URL**: `/api/v1/`
- **Auth**: Bearer JWT in `Authorization` header
- **WebSocket**: `WS /ws?token=<JWT>`
- **Error format**: `{ status: "error", message: string, details?: object }`
- **Success format**: `{ status: "success", data: T }`
- **Pagination**: `{ data: T[], total, page, limit }`

---

## Multi-Tenancy Design

- **Strategy**: Shared database, shared collections — every document has a `tenantId` field
- **Enforcement**: `scopeTenant` middleware extracts `tenantId` from JWT and validates tenant is ACTIVE; all repository methods include `tenantId` as a mandatory filter
- **Super Admin**: Stored in separate `super_admins` collection with no `tenantId`

---

## Security Architecture

- **Authentication**: JWT (8h expiry), bcrypt password hashing (cost ≥ 12)
- **Authorization**: Express middleware RBAC (`requireRole`) + object-level tenantId checks in repositories
- **Rate limiting**: Applied to `/api/auth/login` and all public endpoints
- **Input validation**: Zod schemas on all request bodies and query params
- **CORS**: Restricted to explicitly allowed origins (configured per environment)
- **HTTP security headers**: Helmet.js middleware (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy)
- **Token denylist**: In-memory Map with TTL (single-instance phase)
- **Webhook security**: Razorpay HMAC-SHA256 signature validation

---

## Detailed Artifacts

| Artifact                       | File                      |
| ------------------------------ | ------------------------- |
| Component definitions          | `components.md`           |
| Method signatures              | `component-methods.md`    |
| Service orchestration          | `services.md`             |
| Dependency matrix + data flows | `component-dependency.md` |

---

## Folder Structure (Backend — Modular Monolith)

```
/server
  src/
    modules/
      auth/
        auth.controller.ts
        auth.service.ts
        auth.repository.ts
        auth.routes.ts
        auth.types.ts

      tenant/
      user/
      patient/
      opd/
      ipd/
      lab/
      inventory/
      payment/
      notification/
      audit/

    shared/
      services/
        email.service.ts
        s3.service.ts
        pdf.service.ts
        websocket.service.ts

      middleware/
        authenticate-jwt.ts
        scope-tenant.ts
        require-role.ts
        require-first-password-change.ts
        request-logger.ts
        error-handler.ts

      types/
        common.types.ts
        rbac.types.ts

      config/
        env.ts
        database.ts

    app.ts
    server.ts

  package.json
  tsconfig.json
```

---

## Folder Structure (Frontend — Next.js)

```
/client
  app/
    (auth)/
      login/
      change-password/
      forgot-password/
      reset-password/

    (dashboard)/
      layout.tsx          ← FC-02: Layout Shell
      super-admin/        ← FC-03
      admin/              ← FC-04
      patients/           ← FC-05
      opd/                ← FC-06
      ipd/                ← FC-07
      lab/                ← FC-08
      inventory/          ← FC-09
      payments/           ← FC-10
      audit/              ← FC-12

  components/
    ui/                   ← shadcn/ui components
    notifications/        ← FC-11: Notification Panel
    shared/

  store/
    index.ts
    slices/
      auth.slice.ts
      notification.slice.ts

    api/
      tenant.api.ts
      user.api.ts
      patient.api.ts
      opd.api.ts
      ipd.api.ts
      lab.api.ts
      inventory.api.ts
      payment.api.ts
      audit.api.ts
      dashboard.api.ts       ← FR-E01 (new)
      search.api.ts          ← FR-E02 (new)
```

---

---

# Enhancement Design — v1.1 (QA Rework Phase)

**Version**: 1.1  
**Date**: 2026-05-27  
**Scope**: Additive design artifacts only — all v1.0 design decisions remain in effect

---

## New Backend Modules

| Module | Code | File Path | Requirement |
|---|---|---|---|
| Dashboard Module | BC-12 | `src/modules/dashboard/` | FR-E01 |
| Search Module | BC-13 | `src/modules/search/` | FR-E02 |

Both new modules follow the same folder pattern as existing modules:
```
src/modules/dashboard/
  dashboard.controller.ts
  dashboard.service.ts
  dashboard.routes.ts
  dashboard.types.ts

src/modules/search/
  search.controller.ts
  search.service.ts
  search.routes.ts
  search.types.ts
```

---

## New API Endpoints (Enhancement Phase)

All new endpoints follow the existing REST conventions: Bearer JWT auth, `scopeTenant` middleware, `requireRole` middleware, Zod input validation, standard `{ status, data }` response envelope.

### Dashboard Module (BC-12)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| GET | `/api/v1/dashboard/stats` | Admin, Manager, Doctor, Nurse, Receptionist, Staff | Role-scoped analytics payload with optional `?refresh=true` |

**Response shape** (role-filtered):
```typescript
{
  lastUpdated: string;          // ISO timestamp
  totalPatients?: number;
  todayOpdCount?: number;
  activeIpdCount?: number;
  pendingLabCount?: number;
  revenueToday?: number;        // INR
  revenueThisMonth?: number;    // INR
  lowStockCount?: number;
  totalActiveStaff?: number;
  monthlyOpdTrend?: { date: string; count: number }[];
  monthlyRevenueTrend?: { date: string; amount: number }[];
}
```

### Search Module (BC-13)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| GET | `/api/v1/search` | All authenticated roles | Global search across entity types (`?q=<term>&type=<entity>`) |

**Response shape**:
```typescript
{
  results: {
    patients: SearchResult[];
    doctors: SearchResult[];
    staff: SearchResult[];
    appointments: SearchResult[];
    reports: SearchResult[];
  };
  totalCount: number;
}

type SearchResult = {
  entityType: string;
  entityId: string;
  displayName: string;
  subtitle: string;
  url: string;  // frontend navigation path
}
```

### User Module Additions (BC-03 — `/me` endpoints)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| GET | `/api/v1/users/me` | All roles | Get own profile |
| PATCH | `/api/v1/users/me/profile` | All roles | Update own profile fields |
| PATCH | `/api/v1/users/me/password` | All roles | Self-service password change |
| POST | `/api/v1/users/me/profile-image` | All roles | Upload profile image |

### Patient Module Additions (BC-04)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| DELETE | `/api/v1/patients/:patientId` | Admin, Manager | Soft-delete patient record |

Enhanced existing: `GET /api/v1/patients/:patientId/opd-history` — new query params: `page`, `limit`, `startDate`, `endDate`, `status`, `search`.

### Lab Module Additions (BC-07)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| PATCH | `/api/v1/lab/pathology/:requestId` | Pathologist, Manager, Admin | Edit pending pathology request |
| DELETE | `/api/v1/lab/pathology/:requestId` | Pathologist, Manager, Admin | Soft-delete pathology request |
| PATCH | `/api/v1/lab/radiology/:requestId` | Radiologist, Manager, Admin | Edit pending radiology request |
| DELETE | `/api/v1/lab/radiology/:requestId` | Radiologist, Manager, Admin | Soft-delete radiology request |

### Inventory Module Additions (BC-08)

| Method | Path | Auth Roles | Description |
|---|---|---|---|
| PATCH | `/api/v1/inventory/:itemId` | Manager, Admin | Edit inventory item metadata |
| DELETE | `/api/v1/inventory/:itemId` | Manager, Admin | Soft-delete inventory item |
| GET | `/api/v1/inventory/:itemId/stock-history` | Manager, Admin | Paginated stock adjustment history |

Enhanced existing: `GET /api/v1/users` — new query params: `page`, `limit`, `search`, `role`, `status`, `sortBy`, `sortOrder`.

### Tenant Module Additions — Platform Settings (BC-02)

> **Auth note**: `GET` is public (no JWT required). All other endpoints require Super Admin authentication. No `scopeTenant` middleware — these are platform-level settings.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/super-admin/platform-settings` | Public (rate-limited) | Retrieve platform logo URL, favicon URL, title |
| PATCH | `/api/v1/super-admin/platform-settings` | Super Admin | Update `platformTitle` |
| POST | `/api/v1/super-admin/platform-settings/logo` | Super Admin | Upload platform logo (JPEG/PNG/SVG/WebP, ≤ 2 MB) |
| POST | `/api/v1/super-admin/platform-settings/favicon` | Super Admin | Upload platform favicon (ICO/PNG, ≤ 500 KB) |

**Response shape** (`GET`):
```typescript
{
  logoUrl: string | null;
  faviconUrl: string | null;
  platformTitle: string;          // default: "Hospital Management System"
  updatedAt: string | null;       // ISO timestamp
}
```

---

## New Frontend Components (Enhancement Phase)

| Component | Code | Path | Requirement |
|---|---|---|---|
| Dashboard Widget Layer | FC-13 | `components/dashboard/`, `app/(dashboard)/page.tsx` | FR-E01 |
| Profile Page | FC-14 | `app/(dashboard)/profile/` | FR-E03 |
| Header Search Overlay | FC-15 | `components/header/SearchOverlay.tsx` | FR-E02 |
| User Profile Dropdown | FC-16 | `components/header/ProfileDropdown.tsx` | FR-E02 |
| Platform Settings Page | FC-17 | `app/(super-admin)/platform-settings/page.tsx` | FR-E09 |

### FC-13: Dashboard Widget Layer

Key sub-components under `components/dashboard/`:
- `StatCard.tsx` — icon + label + value + secondary context
- `TrendChart.tsx` — Recharts LineChart wrapping monthly trend data
- `AlertBadge.tsx` — low stock / pending lab alert count
- `DashboardSkeleton.tsx` — shimmer loading skeleton for 4-column grid

### FC-14: Profile Page

Pages under `app/(dashboard)/profile/`:
- `page.tsx` — profile info form + profile image upload
- `change-password/page.tsx` — current/new/confirm password form

### FC-15: Header Search Overlay

Triggered by `Ctrl+K` / `Cmd+K`, rendered as a full-screen modal overlay. Uses RTK Query `search.api.ts` with 300ms debounce. Results grouped by entity type.

### FC-16: User Profile Dropdown

Positioned in header action bar (right side). Displays user initials avatar, full name, role badge. Dropdown items: My Profile, Change Password, Logout.

---

## Database Schema Additions (Additive Only)

All schema changes are additive optional fields — no existing fields are modified.

| Collection | New Fields | Default | Requirement |
|---|---|---|---|
| `users` | `profileImageUrl: String \| null` | `null` | FR-E03 |
| `patients` | `isDeleted: Boolean`, `deletedAt: Date \| null` | `false`, `null` | FR-E05 |
| `lab_requests` (pathology + radiology) | `isDeleted: Boolean`, `deletedAt: Date \| null` | `false`, `null` | FR-E06 |
| `inventory_items` | `isDeleted: Boolean`, `deletedAt: Date \| null` | `false`, `null` | FR-E07 |
| `platform_settings` (**new collection**) | `logoUrl`, `faviconUrl`, `platformTitle`, `updatedAt`, `updatedBy` | `null`, `null`, `"Hospital Management System"`, `null`, `null` | FR-E09 |

---

## New Database Indexes (Additive Only)

| Collection | New Index | Purpose |
|---|---|---|
| `patients` | `{ tenantId: 1, isDeleted: 1 }` | Efficient soft-delete filtering |
| `opd_visits` | `{ tenantId: 1, patientId: 1, visitDate: -1 }` | OPD history date-range queries |
| `users` | `{ tenantId: 1, role: 1, status: 1 }` | User list filtering |
| `lab_requests` | `{ tenantId: 1, isDeleted: 1, status: 1 }` | Lab pending queue with soft-delete |
| `inventory_items` | `{ tenantId: 1, isDeleted: 1 }` | Inventory list soft-delete filtering |

---

## Updated Frontend Folder Structure (Enhancement Additions)

```
/client
  app/
    (dashboard)/
      page.tsx                  ← FC-13: Dashboard analytics (enhanced)
      profile/
        page.tsx                ← FC-14: Profile page (new)
        change-password/
          page.tsx              ← FC-14: Change password (new)
    (super-admin)/
      platform-settings/
        page.tsx                ← FC-17: Platform Settings (new)

  components/
    dashboard/                  ← FC-13 sub-components (new)
      StatCard.tsx
      TrendChart.tsx
      AlertBadge.tsx
      DashboardSkeleton.tsx
    header/                     ← FC-15, FC-16 sub-components (new)
      SearchOverlay.tsx
      ProfileDropdown.tsx
    platform-settings/          ← FC-17 sub-components (new)
      LogoUploadSection.tsx
      FaviconUploadSection.tsx
      TitleSection.tsx

  store/
    api/
      dashboard.api.ts          ← FR-E01 (new)
      search.api.ts             ← FR-E02 (new)
      platformSettings.api.ts   ← FR-E09 (new)
      user.api.ts               ← enhanced (additive query params)
      patient.api.ts            ← enhanced (additive endpoints + params)
      lab.api.ts                ← enhanced (additive endpoints)
      inventory.api.ts          ← enhanced (additive endpoints)
```

---

## Updated Backend Module Summary

| Module | Code | Status | Notes |
|---|---|---|---|
| Auth Module | BC-01 | Existing — enhanced | New `/me/password` endpoint added |
| Tenant Module | BC-02 | Existing — unchanged | |
| User Module | BC-03 | Existing — enhanced | New `/me` endpoint group; `GET /users` filter params |
| Patient Module | BC-04 | Existing — enhanced | Soft-delete endpoint; OPD history filters |
| OPD Module | BC-05 | Existing — enhanced | OPD history pagination/filter params |
| IPD Module | BC-06 | Existing — unchanged | |
| Lab Module | BC-07 | Existing — enhanced | Edit + soft-delete for pathology + radiology |
| Inventory Module | BC-08 | Existing — enhanced | Edit + soft-delete + stock-history endpoint |
| Payment Module | BC-09 | Existing — unchanged | |
| Notification Module | BC-10 | Existing — unchanged | |
| Audit Module | BC-11 | Existing — unchanged | New entity types added to enum |
| Dashboard Module | BC-12 | **New** | Analytics aggregation + caching |
| Search Module | BC-13 | **New** | Cross-entity global search |
| Platform Settings | BC-02 (Tenant, extended) | Existing — enhanced | New platform-settings endpoints for logo, favicon, title; `platform_settings` collection |
