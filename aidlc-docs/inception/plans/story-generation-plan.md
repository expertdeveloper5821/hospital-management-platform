# Story Generation Plan — Hospital Management Platform (HMS)

Please answer each question by filling in the letter choice after the `[Answer]:` tag.
Let me know when you are done.

---

## Planning Questions

### Question 1 — Story Breakdown Approach
How should user stories be organized?

A) **Persona-Based** — stories grouped by user role (all Super Admin stories together, all Doctor stories together, etc.)
B) **Feature/Module-Based** — stories grouped by system module (all OPD stories together, all Payment stories together, etc.)
C) **Epic-Based** — high-level epics (e.g., "Hospital Onboarding", "Clinical Operations") with child stories beneath each
D) **User Journey-Based** — stories follow end-to-end workflows (e.g., "Patient visits hospital: registration → OPD → Lab → Payment")
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Persona-Based


---

### Question 2 — Story Granularity
What level of granularity should each user story be written at?

A) **Fine-grained** — one story per distinct user action (e.g., "As a Receptionist, I want to search for a patient by mobile number" is its own story)
B) **Medium-grained** — one story per feature capability (e.g., "As a Receptionist, I want to search for patients" covers all search types)
C) **Coarse-grained (Epic level)** — one story per module per role (e.g., "As a Receptionist, I want to manage patient registrations")
X) Other (please describe after [Answer]: tag below)

[Answer]: C, Epic level

---

### Question 3 — Acceptance Criteria Format
What format should acceptance criteria use?

A) **Given/When/Then (Gherkin)** — structured BDD format (e.g., "Given I am logged in as a Receptionist, When I submit a valid patient form, Then a patient record is created")
B) **Bullet checklist** — simple numbered or bulleted list of conditions that must be true
C) **Hybrid** — Given/When/Then for happy paths, bullet checklist for edge cases and error scenarios
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Gherkin


---

### Question 4 — Persona Depth
How detailed should the persona profiles be?

A) **Lightweight** — name, role title, primary goals, and key frustrations only
B) **Standard** — name, role title, background, goals, frustrations, and a typical day-in-the-life scenario
C) **Rich** — full persona with demographics, motivations, technical proficiency, pain points, and a detailed scenario
X) Other (please describe after [Answer]: tag below)

[Answer]: B, Standard

---

### Question 5 — Story Scope: Super Admin
The Super Admin is a platform-level role (not a hospital employee). Should Super Admin workflows be included as user stories alongside hospital staff stories?

A) Yes — include Super Admin stories in the same stories.md file, in their own section
B) Yes — but in a separate file (super-admin-stories.md) to keep platform vs tenant stories distinct
C) No — Super Admin workflows are sufficiently covered by the requirements; skip Super Admin stories
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes

---

### Question 6 — Story Prioritization
Should stories include a priority or MoSCoW classification (Must Have / Should Have / Could Have / Won't Have)?

A) Yes — tag each story with MoSCoW priority
B) Yes — use a simple High / Medium / Low priority label
C) No — all stories in scope are Must Have for this phase; skip prioritization
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes


---

### Question 7 — Story Coverage for HR and Staff Roles
The role-permission matrix shows HR has access to User Management (full) and Staff has no module access defined. Should stories be generated for these roles?

A) Yes — generate stories for HR (user management workflows) and note that Staff has no system-specific stories in this phase
B) Yes — generate stories for HR only; omit Staff entirely
C) No — HR and Staff roles are sufficiently covered by the User Management requirement; skip dedicated stories for them
X) Other (please describe after [Answer]: tag below)

[Answer]: A, Yes

---

## Execution Plan

Once questions are answered, the following steps will be executed in order:

- [x] **Step 1**: Analyze answers and resolve any ambiguities
- [x] **Step 2**: Create `aidlc-docs/inception/user-stories/personas.md`
  - [x] Define persona for each role based on approved depth level
  - [x] Include role title, background, goals, frustrations, and scenario
  - [x] Map each persona to their primary modules
- [x] **Step 3**: Create `aidlc-docs/inception/user-stories/stories.md`
  - [x] Organize stories using the approved breakdown approach
  - [x] Write stories in "As a [role], I want to [action], so that [benefit]" format
  - [x] Apply approved granularity level
  - [x] Write acceptance criteria in approved format
  - [x] Apply INVEST criteria to each story (Independent, Negotiable, Valuable, Estimable, Small, Testable)
  - [x] Apply MoSCoW / priority tags if approved
  - [x] Cover all 12 roles per approved scope decisions
- [x] **Step 4**: Cross-reference stories against requirements.md to ensure full traceability
- [x] **Step 5**: Update `aidlc-docs/aidlc-state.md` and `aidlc-docs/audit.md`
