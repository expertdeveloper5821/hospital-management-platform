# Shared Infrastructure — Hospital Management Platform

**Scope**: Platform-wide baseline infrastructure shared by all 7 units  
**Established in**: Unit 1: Foundation  
**Last updated**: Unit 1: Foundation

---

## Platform Baseline

| Component | Service | Details |
|---|---|---|
| Cloud Provider | AWS | Region: ap-south-1 (Mumbai) |
| Compute | EC2 t3.medium | Docker container, public subnet |
| Load Balancer | ALB | Ports 80/443; health check: GET /health |
| Database | MongoDB Atlas M10 | TLS enforced, backups enabled |
| File Storage | AWS S3 | `hms-production` / `hms-staging` buckets |
| Logging | CloudWatch Logs | `/hms/production/app`, 90-day retention |
| Metrics | CloudWatch | EC2 + ALB built-in metrics |
| Container Registry | ECR (or Docker Hub) | Image tag: `hms-app:${GIT_SHA}` |
| VPC | Custom VPC 10.0.0.0/16 | Public subnet 10.0.1.0/24 |

## Unit Infrastructure Additions

| Unit | Additional Infrastructure |
|---|---|
| Unit 1: Foundation | Baseline (above) |
| Unit 2: Patient & OPD | S3 prefix: `pdfs/medical-cards/` |
| Unit 3: IPD | No new infrastructure |
| Unit 4: Lab & Inventory | S3 prefix: `reports/pathology/`, `reports/radiology/` |
| Unit 5: Payments | S3 prefix: `pdfs/receipts/`; Razorpay webhook endpoint |
| Unit 6: Notifications & Audit | WebSocket upgrade on ALB (sticky sessions if scaled) |
| Unit 7: Frontend | Next.js deployment (separate EC2 or Vercel/Amplify — TBD) |

## Scaling Migration Path

When scaling beyond single instance:
1. Add second EC2 to ALB target group
2. Replace in-memory token denylist → Redis ElastiCache
3. Replace in-memory tenant cache → Redis ElastiCache
4. Replace in-memory WebSocket registry → Redis Pub/Sub
5. Migrate secrets from `.env` file → AWS Secrets Manager

See `docs/scaling.md` (to be created) for detailed migration guide.
