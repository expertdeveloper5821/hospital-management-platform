# Infrastructure Design Plan — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: Infrastructure Design  
**Status**: Answers Collected — Artifacts Generated

---

## Execution Checklist

- [x] Step 1: Analyze functional design + NFR design artifacts
- [x] Step 2: Generate infrastructure design questions
- [x] Step 3: Collect answers
- [x] Step 4: Resolve ambiguities (ALB+SG tension noted; Atlas+VPC alignment noted; 90-day log retention added per SECURITY-14)
- [x] Step 5: Generate infrastructure design artifacts
- [x] Step 6: Present completion message

---

## Context Summary

From prior stages, the following infrastructure components need mapping:

**Compute**: Single Node.js + Express process (modular monolith) on AWS EC2  
**Database**: MongoDB — connection string in env var  
**File storage**: AWS S3 — logo uploads, reports, PDFs  
**Email**: Nodemailer SMTP — configurable provider  
**WebSocket**: ws library — attached to HTTP server  
**Deployment**: Docker containers on EC2 (per requirements)  
**Target**: AWS, single-instance phase, 99.5% uptime

---

## Infrastructure Design Questions

Answer each question by filling in the `[Answer]:` tag below it.

---

### Section A: Deployment Environment

**A1.** The requirements specify AWS EC2 with Docker containers. What EC2 instance type is preferred for the initial deployment?

- A) `t3.small` (2 vCPU, 2 GB RAM) — minimal cost, suitable for dev/staging
- B) `t3.medium` (2 vCPU, 4 GB RAM) — balanced for initial production with 50 hospitals
- C) `t3.large` (2 vCPU, 8 GB RAM) — more headroom for memory-intensive operations (PDF generation, file uploads)

[Answer]: B

---

**A2.** How many environments need infrastructure definitions?

- A) Production only
- B) Production + Staging
- C) Production + Staging + Development (local Docker Compose)

[Answer]: B

---

**A3.** Should the EC2 instance sit behind an Application Load Balancer (ALB), even for single-instance deployment?

- A) No ALB — EC2 directly exposed (simpler, lower cost for initial phase)
- B) Yes ALB — even for single instance (enables SSL termination, health checks, easy scale-out later)
- C) Yes ALB + ACM certificate for HTTPS (ALB handles TLS termination — EC2 serves HTTP internally)

[Answer]: B

---

### Section B: Compute Infrastructure

**B1.** The Docker container needs a base image. Which do you prefer?

- A) `node:20-alpine` — minimal size (~180 MB), fast pulls
- B) `node:20-slim` — slightly larger but more compatible with native modules
- C) `node:20` — full Debian image, maximum compatibility

[Answer]: A

---

**B2.** Should the Dockerfile use a multi-stage build?

- A) Yes — `builder` stage (TypeScript compile) + `runner` stage (production image with only `dist/` and `node_modules`)
- B) No — single stage (simpler, acceptable for this phase)

[Answer]: A

---

**B3.** How should environment variables be injected into the container at runtime?

- A) AWS Systems Manager Parameter Store (SSM) — fetched at container startup via a bootstrap script
- B) AWS Secrets Manager — for secrets (JWT_SECRET, DB credentials, AWS keys); SSM for non-sensitive config
- C) EC2 instance environment variables set via the EC2 launch template / user data script (simplest)

[Answer]: C

---

### Section C: Storage Infrastructure

**C1.** MongoDB hosting — where should it run?

- A) MongoDB Atlas (managed) — automatic backups, monitoring, no ops overhead
- B) Self-hosted MongoDB on the same EC2 instance (simplest, lowest cost)
- C) Self-hosted MongoDB on a separate EC2 instance (better isolation, slightly more ops)

[Answer]: A

---

**C2.** For AWS S3, should all file types (logos, reports, PDFs) share one bucket or use separate buckets?

- A) Single bucket with prefix-based organization: `logos/`, `reports/pathology/`, `reports/radiology/`, `pdfs/`
- B) Separate buckets per file type: `hms-logos`, `hms-reports`, `hms-pdfs`
- C) Single bucket per environment: `hms-production`, `hms-staging`

[Answer]: C

---

**C3.** S3 bucket versioning — should it be enabled?

- A) No versioning (simpler, lower storage cost)
- B) Yes versioning on all buckets (protects against accidental overwrites)
- C) Versioning only on the reports bucket (reports are immutable once uploaded — versioning adds protection)

[Answer]: A

---

### Section D: Networking Infrastructure

**D1.** VPC configuration — what network topology should be used?

- A) Default VPC (simplest — no custom VPC setup needed for initial phase)
- B) Custom VPC with public subnet (EC2) + private subnet (MongoDB if self-hosted)
- C) Custom VPC with public subnet (ALB) + private subnet (EC2 + MongoDB)

[Answer]: B

---

**D2.** Security group rules for the EC2 instance — what inbound rules are needed?

- A) Port 443 (HTTPS) from `0.0.0.0/0` + Port 22 (SSH) from a specific admin IP only
- B) Port 80 + 443 from `0.0.0.0/0` + Port 22 from admin IP (HTTP redirects to HTTPS)
- C) Port 3000 (app) from ALB security group only + Port 22 from admin IP (ALB handles 80/443)

[Answer]: B

---

### Section E: Monitoring Infrastructure

**E1.** What monitoring/observability setup should be defined for the Foundation layer?

- A) None for now — add monitoring in a later phase
- B) AWS CloudWatch — EC2 instance metrics (CPU, memory, disk) + application log group
- C) AWS CloudWatch + CloudWatch Alarms for: CPU > 80%, memory > 80%, 5xx error rate > 1%

[Answer]: B

---

**E2.** Application logs from the Docker container — where should they go?

- A) Container stdout/stderr only (visible via `docker logs` — no persistence)
- B) CloudWatch Logs via the `awslogs` Docker log driver — logs streamed to a CloudWatch log group
- C) CloudWatch Logs + log retention policy of 90 days (SECURITY-14 minimum)

[Answer]: B

---

### Section F: Shared Infrastructure

**F1.** This is Unit 1 — the Foundation. Its infrastructure (EC2, VPC, S3, MongoDB) will be shared by all 7 units. Should the infrastructure design document be:

- A) Unit 1 specific only — each unit documents its own additions
- B) A shared infrastructure document (`aidlc-docs/construction/shared-infrastructure.md`) covering the full platform baseline, with unit-specific additions noted per unit
- C) Option B + a separate `docker-compose.yml` for local development covering all services (MongoDB, app)

[Answer]: B

---
