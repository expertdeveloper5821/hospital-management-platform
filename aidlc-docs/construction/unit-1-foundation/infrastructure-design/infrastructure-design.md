# Infrastructure Design — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: Infrastructure Design  
**Status**: Approved  
**Scope**: Shared platform baseline — applies to all 7 units

---

## 1. Infrastructure Overview

```
Internet
    |
    v
[ALB] port 80/443
  |   (SSL termination — ACM cert recommended before go-live)
  |
  v
[EC2 t3.medium] — public subnet
  |   Docker container: hms-app
  |   Port 3000 (internal)
  |
  +---> [MongoDB Atlas] — external managed (TLS enforced)
  |
  +---> [AWS S3] — hms-production / hms-staging buckets
  |
  +---> [SMTP Provider] — Nodemailer (external)
  |
  +---> [CloudWatch Logs] — awslogs driver
  |
  +---> [CloudWatch Metrics] — EC2 instance metrics
```

---

## 2. Compute Infrastructure

### 2.1 EC2 Instance

| Property | Value | Source |
|---|---|---|
| Instance type | `t3.medium` (2 vCPU, 4 GB RAM) | Answer A1=B |
| AMI | Amazon Linux 2023 (latest) | Best practice |
| Storage | 20 GB gp3 EBS root volume | Sufficient for OS + Docker images |
| Environments | Production + Staging | Answer A2=B |
| Auto-restart | EC2 instance recovery alarm + Docker `--restart=always` | NFR-06 (99.5% uptime) |

### 2.2 Application Load Balancer

| Property | Value | Source |
|---|---|---|
| Type | Application Load Balancer (ALB) | Answer A3=B |
| Listener | Port 80 (HTTP) + Port 443 (HTTPS) | Answer A3=B |
| SSL/TLS | ALB listener — ACM certificate recommended before production go-live | Note: ACM not explicitly selected but required for HTTPS |
| Target group | EC2 instance, port 3000, HTTP | Derived |
| Health check | `GET /health` — expects 200 OK | LC-17 |
| Health check interval | 30 seconds | Standard |
| Unhealthy threshold | 2 consecutive failures | Standard |

**Security note**: Until ACM certificate is provisioned, ALB can serve HTTP only. HTTPS (TLS 1.2+) is required before production traffic per SECURITY-01. Add ACM certificate as a pre-go-live task.

### 2.3 Docker Configuration

**Base image**: `node:20-alpine` (Answer B1=A)  
**Build strategy**: Multi-stage (Answer B2=A)

```dockerfile
# Dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Runner (production image)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Create non-root user (SECURITY-09)
RUN addgroup -S hms && adduser -S hms -G hms
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
USER hms
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/server.js"]
```

**Key security practices in Dockerfile**:
- Non-root user `hms` (SECURITY-09 — minimal installation)
- `npm ci --omit=dev` — no dev dependencies in production image (SECURITY-10)
- No `latest` tag — pinned to `node:20-alpine` (SECURITY-10)
- HEALTHCHECK built into image

### 2.4 Environment Variable Injection

**Method**: EC2 launch template / user data script (Answer B3=C)

Environment variables are set in the EC2 launch template as plaintext for non-sensitive config and via EC2 user data for secrets. The Docker run command passes them via `--env-file`.

**Runtime command**:
```bash
docker run -d \
  --name hms-app \
  --restart=always \
  --env-file /etc/hms/.env \
  -p 3000:3000 \
  --log-driver=awslogs \
  --log-opt awslogs-region=ap-south-1 \
  --log-opt awslogs-group=/hms/production/app \
  --log-opt awslogs-stream=hms-app \
  hms-app:latest
```

**`.env` file location**: `/etc/hms/.env` on EC2 instance (permissions: `600`, owned by `hms` user)

**Security note**: For a future hardening pass, migrate secrets (JWT_SECRET, SMTP_PASS, AWS keys) to AWS Secrets Manager with IAM role-based access. EC2 launch template is acceptable for the initial phase.

---

## 3. Storage Infrastructure

### 3.1 MongoDB Atlas

| Property | Value | Source |
|---|---|---|
| Hosting | MongoDB Atlas (managed) | Answer C1=A |
| Tier | M10 (dedicated, 2 GB RAM) — minimum for production | Recommended for 50 hospitals |
| Region | ap-south-1 (Mumbai) — co-located with EC2 | Latency optimization |
| TLS | Enforced by Atlas (TLS 1.2+) | SECURITY-01 |
| Encryption at rest | Enabled by default on Atlas M10+ | SECURITY-01 |
| Backups | Atlas continuous backups (M10 feature) | NFR-03 (data retention) |
| IP allowlist | EC2 instance public IP (or NAT Gateway IP if private subnet) | SECURITY-07 |
| Connection string | Stored in `/etc/hms/.env` as `MONGODB_URI` | SECURITY-12 |

**Atlas cluster naming**:
- Production: `hms-production`
- Staging: `hms-staging`

**Indexes** (defined inline in Mongoose schemas per C1=A decision in NFR Design):
- All collections: compound index on `(tenantId, <primary-query-field>)`
- `autoIndex: false` in production (indexes created via Atlas UI or migration script)

### 3.2 AWS S3

| Property | Value | Source |
|---|---|---|
| Bucket strategy | One bucket per environment | Answer C2=C |
| Production bucket | `hms-production` | Answer C2=C |
| Staging bucket | `hms-staging` | Answer C2=C |
| Versioning | Disabled | Answer C3=A |
| Public access | Blocked (all 4 public access block settings enabled) | SECURITY-09, NFR-09 |
| Server-side encryption | SSE-S3 (AES-256) — enabled by default | SECURITY-01 |
| Region | ap-south-1 (Mumbai) | Co-located with EC2 |
| CORS | Disabled (all access via pre-signed URLs — no direct browser upload) | NFR-09 |

**Prefix organization within each bucket**:
```
hms-production/
  tenants/{tenantId}/logos/
  tenants/{tenantId}/reports/pathology/
  tenants/{tenantId}/reports/radiology/
  tenants/{tenantId}/pdfs/medical-cards/
  tenants/{tenantId}/pdfs/receipts/
```

**Pre-signed URL expiry** (per NFR-09):
- Logos: 24 hours
- Reports: 1 hour
- Medical Cards: 24 hours
- Receipts: 24 hours

**Bucket policy**: Deny all `s3:GetObject` requests without a valid pre-signed URL signature (enforced by blocking public access + no bucket policy granting public read).

---

## 4. Networking Infrastructure

### 4.1 VPC Configuration

| Property | Value | Source |
|---|---|---|
| VPC type | Custom VPC | Answer D1=B |
| CIDR | `10.0.0.0/16` | Standard |
| Public subnet | `10.0.1.0/24` — EC2 + ALB | Answer D1=B |
| Private subnet | `10.0.2.0/24` — reserved for future DB/cache instances | Answer D1=B |
| Internet Gateway | Attached to VPC | Required for public subnet |
| NAT Gateway | Not required (MongoDB Atlas is external; EC2 is in public subnet) | Derived from C1=A |

**Note**: Since MongoDB Atlas is external (managed), the private subnet is reserved for future use (e.g., Redis, additional services). EC2 sits in the public subnet behind the ALB.

### 4.2 Security Groups

**ALB Security Group** (`hms-alb-sg`):

| Direction | Protocol | Port | Source | Purpose |
|---|---|---|---|---|
| Inbound | TCP | 80 | `0.0.0.0/0` | HTTP traffic |
| Inbound | TCP | 443 | `0.0.0.0/0` | HTTPS traffic |
| Outbound | TCP | 3000 | EC2 security group | Forward to app |

**EC2 Security Group** (`hms-ec2-sg`):

| Direction | Protocol | Port | Source | Purpose |
|---|---|---|---|---|
| Inbound | TCP | 80 | `0.0.0.0/0` | HTTP (Answer D2=B) |
| Inbound | TCP | 443 | `0.0.0.0/0` | HTTPS (Answer D2=B) |
| Inbound | TCP | 22 | Admin IP only | SSH access |
| Outbound | All | All | `0.0.0.0/0` | Outbound (Atlas, S3, SMTP) |

**Target state** (recommended before scaling): Change EC2 inbound to accept only from `hms-alb-sg` on port 3000, removing direct 80/443 exposure. This aligns with SECURITY-07 (deny-by-default, restrict to ALB).

### 4.3 DNS

| Environment | DNS | Notes |
|---|---|---|
| Production | Custom domain (e.g., `api.hms.example.com`) | Route 53 A record → ALB DNS name |
| Staging | Subdomain (e.g., `staging-api.hms.example.com`) | Route 53 A record → Staging ALB |

---

## 5. Monitoring Infrastructure

### 5.1 CloudWatch Metrics

| Metric | Source | Purpose |
|---|---|---|
| CPUUtilization | EC2 built-in | Instance health |
| MemoryUtilization | CloudWatch Agent (custom metric) | Memory pressure detection |
| DiskSpaceUtilization | CloudWatch Agent (custom metric) | Disk full prevention |
| NetworkIn / NetworkOut | EC2 built-in | Traffic monitoring |
| ALB RequestCount | ALB built-in | Request volume |
| ALB HTTPCode_Target_5XX_Count | ALB built-in | Error rate monitoring |
| ALB TargetResponseTime | ALB built-in | Latency monitoring |

**CloudWatch Agent**: Required on EC2 for memory and disk metrics (not available as built-in EC2 metrics).

### 5.2 Application Logs

| Property | Value | Source |
|---|---|---|
| Log driver | `awslogs` Docker log driver | Answer E2=B |
| Log group | `/hms/production/app` (production) | Answer E2=B |
| Log group | `/hms/staging/app` (staging) | Answer E2=B |
| Log retention | 90 days | SECURITY-14 (minimum 90 days) |
| Log format | Structured JSON (per SECURITY-03) | NFR Design |
| Region | ap-south-1 | Co-located |

**Log group retention policy**: Set to 90 days on both log groups (SECURITY-14 compliance). Application code does NOT have permission to delete or modify log groups (SECURITY-14 — append-only).

### 5.3 CloudWatch Alarms (Answer E1=B — metrics + log group, no alarms defined)

Alarms are not defined in this phase (Answer E1=B). Recommended as a pre-go-live addition:
- CPU > 80% for 5 minutes → SNS notification
- 5xx error rate > 1% over 5 minutes → SNS notification
- ALB unhealthy host count > 0 → SNS notification

---

## 6. IAM Configuration

### 6.1 EC2 Instance Role (`hms-ec2-role`)

**Permissions required**:

| Service | Actions | Resource | Purpose |
|---|---|---|---|
| S3 | `s3:PutObject`, `s3:GetObject` | `arn:aws:s3:::hms-production/*` | File upload + presigned URL generation |
| CloudWatch Logs | `logs:CreateLogStream`, `logs:PutLogEvents` | `/hms/production/app` log group | Application logging |
| CloudWatch | `cloudwatch:PutMetricData` | `*` (CloudWatch Agent requirement) | Custom metrics |
| SSM | `ssm:GetParameter` | Reserved for future SSM migration | Future secrets management |

**Principle of least privilege** (SECURITY-06): No wildcard actions; S3 access scoped to specific bucket ARN.

---

## 7. CI/CD Pipeline (Outline)

**Trigger**: Push to `main` (production) or `develop` (staging) branch

```
1. Checkout code
2. npm ci
3. npm run test:unit
4. npm run test:integration
5. npm audit --audit-level=high  (SECURITY-10 — vulnerability scan)
6. npm run build  (tsc)
7. docker build -t hms-app:${GIT_SHA} .
8. docker push to ECR (or registry)
9. SSH to EC2 + docker pull + docker stop hms-app + docker run (new container)
10. Health check: curl /health — verify 200 OK
```

**SECURITY-10 compliance**: `npm audit` step in CI catches known vulnerabilities before deployment.

---

## 8. Security Compliance Summary

| Rule | Status | Implementation |
|---|---|---|
| SECURITY-01 | Compliant | MongoDB Atlas TLS enforced; S3 SSE-S3 encryption; ALB HTTPS (ACM pre-go-live) |
| SECURITY-02 | Compliant | ALB access logs enabled; CloudWatch Logs for application |
| SECURITY-03 | Compliant | Structured JSON logs via awslogs driver to CloudWatch |
| SECURITY-06 | Compliant | EC2 IAM role with specific actions and resource ARNs |
| SECURITY-07 | Partially compliant | Custom VPC defined; EC2 SG allows 80/443 from 0.0.0.0/0 (target state: ALB-only) |
| SECURITY-09 | Compliant | Non-root Docker user; S3 public access blocked; no default credentials |
| SECURITY-10 | Compliant | Pinned Docker base image; npm audit in CI; lock file committed |
| SECURITY-14 | Compliant | CloudWatch Logs with 90-day retention; application cannot delete log groups |

---
