# Application Design — Hospital Management Platform (HMS)

**Version**: 1.0  
**Date**: 2026-05-12  
**Status**: Approved

---

## Overview

The HMS is a multi-tenant SaaS platform built as a **modular monolith** — a single deployable Node.js + Express + TypeScript application with 11 clearly bounded backend modules, 4 shared infrastructure services, and a Next.js frontend.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React), Redux Toolkit + RTK Query, shadcn/ui + Tailwind CSS |
| Backend | Node.js + Express + TypeScript, modular monolith |
| Database | MongoDB (Mongoose ODM), shared collections, tenantId scoping |
| File Storage | AWS S3 (pre-signed URLs) |
| Real-time | WebSocket (ws library) |
| PDF Generation | PDFKit (synchronous) |
| Email | Nodemailer (configurable SMTP) |
| Payments | Razorpay SDK (UPI/Card) + manual recording (Cash/Cheque) |
| Deployment | AWS EC2 |
| PBT Framework | fast-check (TypeScript + Jest) |

---

## Backend Module Summary

| Module | Code | Primary Responsibility |
|---|---|---|
| Auth Module | BC-01 | JWT auth, session management, lockout, password reset |
| Tenant Module | BC-02 | Hospital onboarding, tenant lifecycle, branding |
| User Module | BC-03 | User accounts, roles, RBAC enforcement |
| Patient Module | BC-04 | Patient registration, Medical Card PDF |
| OPD Module | BC-05 | Outpatient visit lifecycle |
| IPD Module | BC-06 | Inpatient admission, bed registry |
| Lab Module | BC-07 | Pathology + radiology requests and reports |
| Inventory Module | BC-08 | Stock management, low-stock alerts |
| Payment Module | BC-09 | Manual payments, Razorpay, receipt PDF |
| Notification Module | BC-10 | WebSocket notifications, history |
| Audit Module | BC-11 | Append-only audit log |

**Shared Services**: Email (SI-01), S3 (SI-02), PDF (SI-03), WebSocket (SI-04)

---

## Frontend Component Summary

| Component | Code | Primary Responsibility |
|---|---|---|
| Auth Shell | FC-01 | Login, password change, forgot/reset password |
| Layout Shell | FC-02 | Navigation (RBAC-aware), notification bell, branding |
| Super Admin Console | FC-03 | Tenant onboarding and management |
| Hospital Admin Panel | FC-04 | Branding config, user management |
| Patient Management | FC-05 | Registration, search, Medical Card |
| OPD Module UI | FC-06 | OPD queue, visit recording |
| IPD Module UI | FC-07 | Admissions, bed registry, progress notes |
| Lab Module UI | FC-08 | Lab requests, report upload |
| Inventory Module UI | FC-09 | Stock management |
| Payment Module UI | FC-10 | Payment recording, receipts, summary |
| Notification Panel | FC-11 | Real-time notifications, history |
| Audit Log Viewer | FC-12 | Audit log query and display |

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

| Artifact | File |
|---|---|
| Component definitions | `components.md` |
| Method signatures | `component-methods.md` |
| Service orchestration | `services.md` |
| Dependency matrix + data flows | `component-dependency.md` |

---

## Folder Structure (Backend — Modular Monolith)

```
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
```

---

## Folder Structure (Frontend — Next.js)

```
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
```
