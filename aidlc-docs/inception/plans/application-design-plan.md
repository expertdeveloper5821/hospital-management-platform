# Application Design Plan — Hospital Management Platform (HMS)

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
Let me know when you are done.

---

## Planning Questions

### Question 1 — API Design Style
What API style should the backend expose to the Next.js frontend?

A) REST only — standard HTTP verbs and resource-based URLs for all operations
B) REST + WebSocket — REST for all CRUD operations, WebSocket only for real-time notifications
C) GraphQL — single endpoint with typed queries and mutations
X) Other (please describe after [Answer]: tag below)

[Answer]: B, REST + WebSocket


---

### Question 2 — Middleware Architecture
How should cross-cutting concerns (authentication, tenant scoping, RBAC, logging, validation) be applied across routes?

A) Express middleware chain — each concern is a separate middleware function applied globally or per-router
B) Decorator pattern — TypeScript decorators on controller methods (requires a framework like NestJS or tsyringe)
C) Service layer guards — cross-cutting logic lives in a base service class that all services extend
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Express middleware chain

---

### Question 3 — Repository Pattern
Should data access be abstracted behind a repository layer, or should service modules call MongoDB directly via Mongoose?

A) Repository pattern — each module has a dedicated repository class that wraps all Mongoose operations; services call repositories, not Mongoose directly
B) Direct Mongoose in services — services use Mongoose models directly; no separate repository layer
C) Data Access Object (DAO) pattern — similar to repository but with explicit DAO classes per collection
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Repository pattern

---

### Question 4 — Frontend State Management
What state management approach should the Next.js frontend use?

A) React Context + useReducer — built-in React primitives for global state (auth, tenant branding, notifications)
B) Zustand — lightweight external state manager
C) Redux Toolkit — full Redux with RTK Query for API calls
D) React Query (TanStack Query) + React Context — server state via React Query, UI state via Context
X) Other (please describe after [Answer]: tag below)

[Answer]: C, Redux Toolkit

---

### Question 5 — Component Library
Should the frontend use a UI component library, or be built with custom Tailwind CSS components?

A) shadcn/ui + Tailwind CSS — unstyled accessible components with full customization (supports tenant branding via CSS variables)
B) Ant Design — comprehensive component library with built-in form handling and table components
C) Material UI (MUI) — Google Material Design components
D) Custom Tailwind CSS only — no component library, all components built from scratch
X) Other (please describe after [Answer]: tag below)

[Answer]: A, shadcn/ui + Tailwind CSS

---

### Question 6 — PDF Generation Approach
PDFKit was selected for Medical Cards and receipts. Should PDF generation happen synchronously (inline with the API request) or asynchronously (queued job)?

A) Synchronous — PDF is generated inline and returned as a download in the same API response
B) Asynchronous — PDF generation is queued; client polls or receives a notification when ready
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Synchronous

---

### Question 7 — Razorpay Webhook Handling
For Razorpay payment confirmation (UPI/Card), how should the webhook be handled?

A) Dedicated webhook endpoint — a separate Express route `/webhooks/razorpay` validates the Razorpay signature and creates the payment record
B) Inline polling — frontend polls Razorpay order status after initiating payment; backend creates record on confirmed status
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Dedicated webhook endpoint

---

### Question 8 — Error Response Format
What standard error response format should all API endpoints return?

A) `{ success: false, error: { code: string, message: string } }` — structured with a machine-readable code and human-readable message
B) `{ status: "error", message: string, details?: object }` — simpler flat structure
C) RFC 7807 Problem Details — `{ type, title, status, detail, instance }` standard format
X) Other (please describe after [Answer]: tag below)

[Answer]: B, `{ status: "error", message: string, details?: object }`

---

## Execution Plan

Once questions are answered, the following steps will be executed in order:

- [x] **Step 1**: Analyze answers and resolve any ambiguities
- [x] **Step 2**: Create `aidlc-docs/inception/application-design/components.md`
  - [x] Define all backend modules (Auth, Tenant, User, Patient, OPD, IPD, Lab, Inventory, Payment, Notification, Audit)
  - [x] Define frontend component groups
  - [x] Document responsibilities and interfaces for each component
- [x] **Step 3**: Create `aidlc-docs/inception/application-design/component-methods.md`
  - [x] Define method signatures for each backend module
  - [x] Define key frontend component props/interfaces
  - [x] Note input/output types (detailed business rules deferred to Functional Design)
- [x] **Step 4**: Create `aidlc-docs/inception/application-design/services.md`
  - [x] Define service layer orchestration patterns
  - [x] Document inter-module communication
  - [x] Define shared services (email, S3, PDF, WebSocket)
- [x] **Step 5**: Create `aidlc-docs/inception/application-design/component-dependency.md`
  - [x] Dependency matrix between all modules
  - [x] Data flow diagrams for key workflows
  - [x] Communication patterns (sync REST, async WebSocket, S3 pre-signed URLs)
- [x] **Step 6**: Create `aidlc-docs/inception/application-design/application-design.md`
  - [x] Consolidated design document referencing all artifacts
- [x] **Step 7**: Update `aidlc-docs/aidlc-state.md` and `aidlc-docs/audit.md`
