# Execution Plan — Hospital Management Platform (HMS)

**Generated**: 2026-05-12  
**Project Type**: Greenfield  
**Architecture**: Modular Monolith (Node.js + Express + TypeScript + MongoDB + Next.js)

---

## Detailed Analysis Summary

### Change Impact Assessment

| Impact Area | Present | Description |
|---|---|---|
| User-facing changes | Yes | Entire system is user-facing — 12 roles, full UI across all modules |
| Structural changes | Yes | New system from scratch — all modules, RBAC, multi-tenancy |
| Data model changes | Yes | 11 MongoDB collections with tenantId scoping, relationships, indexes |
| API changes | Yes | ~60+ REST endpoints + WebSocket notification channel |
| NFR impact | Yes | Security (15 rules), performance targets, PBT (10 rules), audit logging |

### Risk Assessment

| Factor | Rating | Rationale |
|---|---|---|
| **Risk Level** | High | Multi-tenant SaaS, clinical workflows, payment integration, 12 roles, RBAC |
| **Rollback Complexity** | Moderate | Greenfield — no existing system to break, but complex data model |
| **Testing Complexity** | Complex | Security baseline + PBT both enforced; multi-role, multi-tenant test scenarios |

---

## Workflow Visualization

```
INCEPTION PHASE
+---------------------------+
| Workspace Detection  DONE |
| Reverse Engineering  SKIP |
| Requirements Analysis DONE|
| User Stories         DONE |
| Workflow Planning    NOW  |
| Application Design   EXEC |
| Units Generation     EXEC |
+---------------------------+
            |
CONSTRUCTION PHASE (per unit)
+---------------------------+
| Functional Design    EXEC |
| NFR Requirements     EXEC |
| NFR Design           EXEC |
| Infrastructure Design EXEC|
| Code Generation      EXEC |
+---------------------------+
            |
+---------------------------+
| Build and Test       EXEC |
+---------------------------+
            |
OPERATIONS PHASE
+---------------------------+
| Operations      PLACEHOLDER|
+---------------------------+
```

---

## Phase Determination Rationale

### 🔵 INCEPTION PHASE

#### Application Design — EXECUTE
**Rationale**: This is a complex greenfield system with 11 distinct service modules, a shared Auth/RBAC layer, a Notification module, and an Audit module. Component boundaries, method signatures, service orchestration patterns, and inter-module dependencies all need to be explicitly designed before code generation. Without Application Design, the modular monolith structure will be ambiguous and inconsistent across units.

#### Units Generation — EXECUTE
**Rationale**: The system has 11 modules that need to be decomposed into logical units of work for the Construction phase. Each unit will go through its own Functional Design → NFR Requirements → NFR Design → Infrastructure Design → Code Generation loop. Units Generation defines those boundaries, their dependencies, and the story-to-unit mapping.

### 🟢 CONSTRUCTION PHASE (per unit)

#### Functional Design — EXECUTE (per unit)
**Rationale**: New data models, complex business logic (RBAC enforcement, multi-tenant scoping, clinical workflows, payment processing), and business rules need detailed design per unit before code generation.

#### NFR Requirements — EXECUTE (per unit)
**Rationale**: Security Baseline (15 rules) and PBT (10 rules) are both enforced as blocking constraints. Performance targets, rate limiting, encryption, input validation, and structured logging all need to be assessed and specified per unit.

#### NFR Design — EXECUTE (per unit)
**Rationale**: NFR patterns (bcrypt password hashing, JWT validation middleware, Zod input validation, structured logging with correlation IDs, rate limiting, S3 encryption config, CORS policy) need to be incorporated into each unit's design.

#### Infrastructure Design — EXECUTE (per unit)
**Rationale**: AWS EC2 deployment, S3 file storage, MongoDB connection configuration, Nodemailer SMTP setup, Razorpay SDK integration, and WebSocket server configuration all need to be mapped to infrastructure services per unit.

#### Code Generation — EXECUTE (per unit, ALWAYS)

#### Build and Test — EXECUTE (ALWAYS)

### 🟡 OPERATIONS PHASE

#### Operations — PLACEHOLDER

---

## Phases to Execute

### 🔵 INCEPTION PHASE
- [x] Workspace Detection — COMPLETED
- [x] Reverse Engineering — SKIPPED (Greenfield)
- [x] Requirements Analysis — COMPLETED
- [x] User Stories — COMPLETED
- [x] Workflow Planning — IN PROGRESS
- [ ] Application Design — EXECUTE
- [ ] Units Generation — EXECUTE

### 🟢 CONSTRUCTION PHASE
- [ ] Functional Design — EXECUTE (per unit)
- [ ] NFR Requirements — EXECUTE (per unit)
- [ ] NFR Design — EXECUTE (per unit)
- [ ] Infrastructure Design — EXECUTE (per unit)
- [ ] Code Generation — EXECUTE (per unit, ALWAYS)
- [ ] Build and Test — EXECUTE (ALWAYS)

### 🟡 OPERATIONS PHASE
- [ ] Operations — PLACEHOLDER

---

## Proposed Unit Decomposition (Preview)

The following units are proposed for the Construction phase loop. Final unit boundaries will be confirmed during Units Generation.

| Unit | Modules Covered | Key Complexity |
|---|---|---|
| Unit 1: Foundation | Auth Module, Tenant Module, User Module | JWT, RBAC, multi-tenancy, invite flow, branding |
| Unit 2: Patient & OPD | Patient Module, OPD Module | Registration, Medical Card PDF, OPD lifecycle |
| Unit 3: IPD | IPD Module | Bed registry, admission lifecycle, progress notes |
| Unit 4: Lab | Lab Module (Pathology + Radiology) | File upload to S3, report lifecycle, notifications |
| Unit 5: Inventory | Inventory Module | Stock management, low-stock notifications, audit |
| Unit 6: Payments | Payment Module | Manual recording, Razorpay integration, receipt PDF |
| Unit 7: Notifications & Audit | Notification Module, Audit Module | WebSocket server, append-only audit log |

---

## Success Criteria

- **Primary Goal**: Fully functional multi-tenant HMS with all 15 functional requirements implemented
- **Key Deliverables**: Working Next.js frontend, Node.js modular monolith backend, MongoDB data layer, AWS EC2 deployment, all PDFs, WebSocket notifications, Razorpay integration
- **Quality Gates**:
  - All 15 SECURITY rules compliant (blocking)
  - All 10 PBT rules compliant (blocking)
  - API response time < 500ms at p95
  - All 27 user stories have passing acceptance tests
  - Audit log covers all 8 entity types
  - Multi-tenant isolation verified at query layer
