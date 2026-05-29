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
