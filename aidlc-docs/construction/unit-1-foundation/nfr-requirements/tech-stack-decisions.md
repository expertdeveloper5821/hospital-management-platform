# Tech Stack Decisions — Unit 1: Foundation

**Unit**: Unit 1 — Foundation  
**Stage**: NFR Requirements  
**Status**: Approved

---

## 1. Runtime & Language

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js (LTS) | Specified in requirements |
| Language | TypeScript | Specified in requirements |
| TS target | `ES2020` | Answer E3=A — Node.js native CJS, no ESM complexity |
| Module system | `CommonJS` | Answer E3=A — widest compatibility, no `.js` import extensions needed |
| Strict mode | `"strict": true` in tsconfig | Best practice for type safety |

**tsconfig.json key settings**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

## 2. Web Framework

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| HTTP framework | Express | `4.18.2` | Specified in requirements |
| Security headers | helmet | `7.1.0` | SECURITY-04 compliance |
| CORS | cors | `2.8.5` | SECURITY-08 compliance |
| Rate limiting | express-rate-limit | `7.2.0` | SECURITY-11, FR-05.10 |
| Body parsing | express.json (built-in) | — | No extra dependency |

---

## 3. Database

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Database | MongoDB | — | Specified in requirements |
| ODM | Mongoose | `8.3.0` | Specified in requirements |
| Connection pool | maxPoolSize: 10 | — | Answer B1=A — sufficient for initial phase |
| Indexes | Compound `(tenantId, <field>)` | — | NFR-01 performance requirement |

---

## 4. Authentication & Security

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| JWT library | jsonwebtoken | `9.0.2` | Industry standard for Node.js |
| Password hashing | bcryptjs | `2.4.3` | Answer E1=B — pure JS, no native bindings needed |
| bcrypt rounds | `BCRYPT_ROUNDS` env var (default: 12) | — | Answer D1=B, SECURITY-12 |
| Token denylist | In-memory Map | — | Requirements decision; Redis migration path documented |
| Input validation | zod | `3.23.8` | Answer E1=B — used for API request validation (SECURITY-05) |

**bcryptjs vs bcrypt**: `bcryptjs` is pure JavaScript (no native bindings), making it easier to build in Docker without native compilation tools. Performance difference is negligible at bcrypt cost factor 12 for a hospital management system at this scale.

---

## 5. Environment Configuration

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Env validation | dotenv-safe | `8.2.0` | Answer B1=C — validates against .env.example |
| Config immutability | Object.freeze (shallow) | — | Answer F1=B |
| Secrets management | Environment variables only | — | SECURITY-12 — no hardcoded credentials |

---

## 6. File Storage

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Object storage | AWS S3 | — | Specified in requirements |
| AWS SDK | @aws-sdk/client-s3 | `3.575.0` | AWS SDK v3 — modular, tree-shakeable |
| Presigned URLs | @aws-sdk/s3-request-presigner | `3.575.0` | Required for NFR-09 |
| Server-side encryption | AES256 (SSE-S3) | — | SECURITY-01 |

---

## 7. Email

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Email library | nodemailer | `6.9.13` | Specified in requirements |
| SMTP config | Environment variables | — | NFR-08 — configurable SMTP |
| Template engine | Inline HTML functions | — | No extra dependency; templates are simple |
| Failure behavior | Fail operation (throw AppError) | — | Answer C2=A — email is critical for auth flows |

---

## 8. Real-time (WebSocket Stub)

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| WebSocket library | ws | `8.17.0` | Specified in requirements; lightweight |
| Unit 1 scope | Server init + no-op stubs only | — | Full implementation in Unit 6 |

---

## 9. Logging

| Decision | Choice | Rationale |
|---|---|---|
| Logging approach | `console.log` + `JSON.stringify` | Answer E2=A — no extra dependency; sufficient for this phase |
| Log format | Structured JSON | SECURITY-03 |
| Log levels | `info` (2xx/3xx), `warn` (4xx), `error` (5xx + exceptions) | Answer D3=C |
| Correlation IDs | UUID v4 per request, attached to `X-Correlation-ID` header | SECURITY-03 |
| Sensitive data | Excluded from all logs (passwords, tokens, SMTP creds, AWS keys) | SECURITY-03 |

---

## 10. Testing

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Test runner | Jest | `29.7.0` | Industry standard for Node.js/TypeScript |
| TypeScript transform | ts-jest | `29.1.4` | Native TypeScript support in Jest |
| PBT framework | fast-check | `3.19.0` | PBT-09 — TypeScript + Jest integration |
| HTTP testing | supertest | `7.0.0` | Integration test HTTP assertions |
| Test config | Single `jest.config.ts` + separate npm scripts | — | Answer G1=C |

**jest.config.ts**:
```typescript
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
  coverageThreshold: {
    global: { branches: 70, functions: 80, lines: 80, statements: 80 }
  },
  setupFilesAfterFramework: [],
  verbose: true,
};

export default config;
```

---

## 11. Shared Utilities

| Utility | Implementation | Source |
|---|---|---|
| `generateId()` | `import { v4 as uuidv4 } from 'uuid'; export const generateId = () => uuidv4();` | Answer F2=B |
| `formatDate(date)` | `export const formatDate = (date: Date): string => date.toISOString();` | Answer F2=B |
| Location | `src/shared/utils/index.ts` | Answer F2=B |

---

## 12. Complete package.json Dependencies

```json
{
  "name": "hospital-management-platform",
  "version": "1.0.0",
  "description": "Multi-tenant Hospital Management Platform",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "test": "jest",
    "test:unit": "jest --testPathPattern=tests/unit",
    "test:integration": "jest --testPathPattern=tests/integration",
    "test:coverage": "jest --coverage"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "3.575.0",
    "@aws-sdk/s3-request-presigner": "3.575.0",
    "bcryptjs": "2.4.3",
    "cors": "2.8.5",
    "dotenv-safe": "8.2.0",
    "express": "4.18.2",
    "express-rate-limit": "7.2.0",
    "helmet": "7.1.0",
    "jsonwebtoken": "9.0.2",
    "mongoose": "8.3.0",
    "nodemailer": "6.9.13",
    "uuid": "9.0.1",
    "ws": "8.17.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "2.4.6",
    "@types/cors": "2.8.17",
    "@types/express": "4.17.21",
    "@types/jest": "29.5.12",
    "@types/jsonwebtoken": "9.0.6",
    "@types/nodemailer": "6.4.14",
    "@types/supertest": "6.0.2",
    "@types/uuid": "9.0.8",
    "@types/ws": "8.5.10",
    "fast-check": "3.19.0",
    "jest": "29.7.0",
    "supertest": "7.0.0",
    "ts-jest": "29.1.4",
    "ts-node": "10.9.2",
    "typescript": "5.4.5"
  }
}
```

**Note**: All versions are pinned (no `^` prefix) per SECURITY-10 — exact versions with committed lock file.

---

## 13. Known Limitations & Migration Paths

| Limitation | Current Solution | Migration Path | Timeline |
|---|---|---|---|
| Token denylist not shared across instances | In-memory Map | Redis SETEX with JWT expiry as TTL | Before horizontal scaling |
| Tenant cache not shared across instances | In-memory Map | Redis GET/SETEX with 60s TTL | Before horizontal scaling |
| WebSocket connections not shared across instances | In-memory Map (stub) | Redis Pub/Sub for cross-instance delivery | Unit 6 + before scaling |
| No MFA for Hospital Admin | Not implemented | TOTP (e.g., speakeasy library) | Future phase |
| Single SMTP provider | Nodemailer SMTP | Add fallback provider or queue-based retry | Future phase |

---
