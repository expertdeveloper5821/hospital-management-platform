# Unit of Work Plan — Hospital Management Platform (HMS)

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
Let me know when you are done.

---

## Context

The execution plan proposed 7 units based on the application design. This plan confirms the boundaries, sequencing, and story mapping for those units.

**Proposed units (from execution plan)**:
1. Foundation — Auth, Tenant, User modules
2. Patient & OPD — Patient, OPD modules
3. IPD — IPD module + bed registry
4. Lab — Pathology + Radiology (Lab module)
5. Inventory — Inventory module
6. Payments — Payment module + Razorpay
7. Notifications & Audit — Notification module + Audit module

---

## Planning Questions

### Question 1 — Unit Boundaries Confirmation
Do the 7 proposed units above reflect the right groupings, or would you like to adjust them?

A) Confirm as-is — the 7 units are correct
B) Merge Units 4 and 5 (Lab + Inventory) into a single unit — both are relatively simple modules
C) Merge Units 5, 6, and 7 (Inventory + Payments + Notifications & Audit) into a single unit
D) Split Unit 1 (Foundation) — Auth as its own unit, Tenant + User as a second unit
X) Other (please describe after [Answer]: tag below)

[Answer]: B, Merge Units 4 and 5 (Lab + Inventory) into a single unit

---

### Question 2 — Unit Execution Order
Should units be executed strictly sequentially (one fully complete before the next starts), or is there flexibility?

A) Strictly sequential — complete all stages (Functional Design → Code Generation) for Unit 1 before starting Unit 2
B) Sequential with overlap allowed — start Unit 2's Functional Design while Unit 1's Code Generation is in progress
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Strictly sequential

---

### Question 3 — Shared Types and Models
Where should shared TypeScript types (e.g., `UserRole`, `TenantStatus`, `PaginatedResult`, JWT payload) be defined?

A) In Unit 1 (Foundation) — shared types are generated as part of the Foundation unit and imported by all subsequent units
B) In a dedicated `shared/` module generated before any unit — not tied to any specific unit
C) Inline per unit — each unit defines its own types; shared types are refactored in a later pass
X) Other (please describe after [Answer]: tag below)

[Answer]: A, In Unit 1 (Foundation)

---

### Question 4 — Frontend per Unit
Should the frontend components for each unit be generated alongside the backend in the same unit, or should all frontend work be done in a separate final unit?

A) Co-located — frontend components for each module are generated in the same unit as the backend (e.g., Unit 2 generates both the Patient/OPD backend AND the Patient/OPD frontend pages)
B) Separate — all backend units first (Units 1–7), then a dedicated frontend unit at the end
X) Other (please describe after [Answer]: tag below)

[Answer]: B, Separate

---

### Question 5 — Test Strategy per Unit
Should unit tests and integration tests be generated inline during each unit's Code Generation, or collected and generated all at once during Build and Test?

A) Inline — unit tests and integration tests are generated as part of each unit's Code Generation step
B) Deferred — only unit tests inline; integration tests (cross-module) generated during Build and Test
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Inline

---

## Execution Plan

Once questions are answered, the following steps will be executed in order:

- [x] **Step 1**: Analyze answers and resolve any ambiguities
- [x] **Step 2**: Create `aidlc-docs/inception/application-design/unit-of-work.md`
  - [x] Define each unit with name, modules covered, scope, and code organization
  - [x] Document unit boundaries and rationale
  - [x] Define execution sequence
- [x] **Step 3**: Create `aidlc-docs/inception/application-design/unit-of-work-dependency.md`
  - [x] Dependency matrix between units
  - [x] Identify which units must complete before others can start
  - [x] Document shared artifacts (types, middleware, config)
- [x] **Step 4**: Create `aidlc-docs/inception/application-design/unit-of-work-story-map.md`
  - [x] Map all 27 user stories to their respective units
  - [x] Verify all stories are covered
- [x] **Step 5**: Update `aidlc-docs/aidlc-state.md` and `aidlc-docs/audit.md`
