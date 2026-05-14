# Deployment Architecture — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: Infrastructure Design  
**Status**: Approved

---

## 1. Production Deployment Architecture

```
                        INTERNET
                           |
                    +------+------+
                    |     ALB     |  hms-alb-sg
                    | port 80/443 |  (0.0.0.0/0 inbound)
                    +------+------+
                           |
                    +------+------+
                    |  EC2        |  hms-ec2-sg
                    |  t3.medium  |  ap-south-1
                    |  public     |
                    |  subnet     |
                    |  10.0.1.0/24|
                    |             |
                    |  +--------+ |
                    |  | Docker | |
                    |  | hms-app| |
                    |  | :3000  | |
                    |  +--------+ |
                    +------+------+
                           |
          +----------------+----------------+
          |                |                |
   +------+------+  +------+------+  +------+------+
   | MongoDB     |  |   AWS S3    |  | CloudWatch  |
   | Atlas       |  | hms-prod    |  | Logs        |
   | (managed)   |  | ap-south-1  |  | /hms/prod   |
   | TLS 1.2+    |  | SSE-S3      |  | 90-day ret. |
   +-------------+  +-------------+  +-------------+
```

---

## 2. Network Topology

```
AWS Region: ap-south-1 (Mumbai)
  |
  +-- VPC: 10.0.0.0/16
        |
        +-- Public Subnet: 10.0.1.0/24
        |     - Internet Gateway attached
        |     - EC2 t3.medium (hms-app Docker container)
        |     - ALB (Application Load Balancer)
        |
        +-- Private Subnet: 10.0.2.0/24 (reserved)
              - Future: Redis, additional services
              - No internet gateway route
```

---

## 3. Environment Comparison

| Property | Production | Staging |
|---|---|---|
| EC2 instance | `t3.medium` | `t3.small` (cost saving) |
| ALB | Yes | Yes |
| MongoDB Atlas | `hms-production` cluster (M10) | `hms-staging` cluster (M0 free tier acceptable) |
| S3 bucket | `hms-production` | `hms-staging` |
| CloudWatch log group | `/hms/production/app` | `/hms/staging/app` |
| Log retention | 90 days | 30 days |
| Docker image tag | `hms-app:${GIT_SHA}` | `hms-app:${GIT_SHA}-staging` |
| Env file location | `/etc/hms/.env` | `/etc/hms/.env` |

---

## 4. Container Lifecycle

```
Deployment trigger (CI/CD push to main/develop)
    |
    v
Build: docker build -t hms-app:${GIT_SHA} .
    |
    v
Push: docker push to registry (ECR or Docker Hub)
    |
    v
Deploy to EC2:
    1. docker pull hms-app:${GIT_SHA}
    2. docker stop hms-app (graceful — SIGTERM → 10s timeout)
    3. docker rm hms-app
    4. docker run -d --name hms-app --restart=always \
         --env-file /etc/hms/.env \
         -p 3000:3000 \
         --log-driver=awslogs \
         --log-opt awslogs-region=ap-south-1 \
         --log-opt awslogs-group=/hms/production/app \
         hms-app:${GIT_SHA}
    5. Health check: curl http://localhost:3000/health
    6. ALB health check confirms target healthy (30s interval)
```

**Zero-downtime note**: Single-instance deployment has a brief downtime window during container swap (~5-10 seconds). For true zero-downtime, add a second EC2 instance to the ALB target group (future scaling step).

---

## 5. Data Flow Diagrams

### 5.1 Authentication Request Flow

```
Client
  |  HTTPS (ALB terminates TLS)
  v
ALB :443
  |  HTTP :3000
  v
EC2 Docker (hms-app)
  |
  +-- authenticateJWT (in-memory denylist check)
  |
  +-- scopeTenant (TenantCache → MongoDB Atlas if miss)
  |         |
  |         v
  |     MongoDB Atlas (TLS 1.2+, ap-south-1)
  |
  +-- requireRole (in-memory check)
  |
  v
Route Handler → Response
  |
  v
CloudWatch Logs (awslogs driver, async)
```

### 5.2 File Upload Flow (Logo)

```
Client
  |  HTTPS multipart/form-data
  v
ALB → EC2 Docker (hms-app)
  |
  +-- authenticateJWT + scopeTenant + requireRole(HOSPITAL_ADMIN)
  |
  +-- Validate file: size ≤ 2MB, mimeType in [image/jpeg, image/png]
  |
  +-- S3Service.uploadFile(key, buffer, 'image/jpeg')
  |         |
  |         v
  |     AWS S3 hms-production bucket
  |     Key: tenants/{tenantId}/logos/{filename}
  |     SSE-S3 encryption applied
  |
  +-- TenantService.updateBranding({ logoUrl: s3Key })
  |         |
  |         v
  |     MongoDB Atlas (update tenant document)
  |
  v
Response: { status: 'success', data: { logoUrl: presignedUrl } }
```

### 5.3 Email Delivery Flow

```
EC2 Docker (hms-app)
  |
  +-- EmailService.sendInviteEmail(to, inviteLink)
  |
  +-- Nodemailer transporter.sendMail()
  |         |
  |         v
  |     SMTP Provider (external — configurable)
  |     Credentials: SMTP_HOST, SMTP_USER, SMTP_PASS (env vars)
  |
  +-- Success: return void
  +-- Failure: throw AppError(500, 'Unable to send email...')
              |
              v
          CloudWatch Logs: { level: 'error', event: 'smtp_failure', correlationId }
```

---

## 6. Secrets and Configuration Management

| Secret / Config | Storage | Access Method |
|---|---|---|
| `MONGODB_URI` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `JWT_SECRET` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `INVITE_JWT_SECRET` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `SMTP_PASS` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `AWS_ACCESS_KEY_ID` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `AWS_SECRET_ACCESS_KEY` | `/etc/hms/.env` on EC2 | Docker `--env-file` |
| `PORT`, `NODE_ENV`, etc. | `/etc/hms/.env` on EC2 | Docker `--env-file` |

**File permissions**: `/etc/hms/.env` — `chmod 600`, owned by `hms` user (same user as Docker container process).

**Future migration path**: Move secrets to AWS Secrets Manager; EC2 IAM role fetches secrets at startup via bootstrap script. Non-sensitive config moves to SSM Parameter Store.

---

## 7. Pre-Go-Live Checklist

- [ ] Provision ACM certificate for production domain → attach to ALB HTTPS listener
- [ ] Update EC2 security group: restrict inbound to ALB security group only (port 3000), remove direct 80/443
- [ ] Configure CloudWatch Alarms: CPU > 80%, 5xx rate > 1%, unhealthy host count > 0
- [ ] Set MongoDB Atlas IP allowlist to EC2 Elastic IP (not 0.0.0.0/0)
- [ ] Rotate all secrets in `/etc/hms/.env` from development values to production values
- [ ] Verify S3 bucket public access block is enabled on `hms-production`
- [ ] Confirm CloudWatch log group retention is set to 90 days
- [ ] Run `npm audit` — zero high/critical vulnerabilities
- [ ] Verify Docker container runs as non-root user (`hms`)
- [ ] Test graceful shutdown: `docker stop hms-app` → verify 10s timeout → clean exit

---
