import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import config from './shared/config/env';
import { requestLogger } from './shared/middleware/request-logger';
import { errorHandler, NotFoundError } from './shared/middleware/error-handler';
import healthRouter from './shared/routes/health.routes';
import authRouter from './modules/auth/auth.routes';
import superAdminRouter from './modules/super-admin/super-admin.routes';
import tenantRouter from './modules/tenant/tenant.routes';
import userRouter    from './modules/user/user.routes';
import patientRouter from './modules/patient/patient.routes';
import opdRouter     from './modules/opd/opd.routes';
import ipdRouter       from './modules/ipd/ipd.routes';
import labRouter          from './modules/lab/lab.routes';
import inventoryRouter    from './modules/inventory/inventory.routes';
import notificationRouter from './modules/notification/notification.routes';
import paymentRouter      from './modules/payment/payment.routes';
import webhookRouter      from './modules/payment/payment.webhook.routes';
import auditRouter        from './modules/audit/audit.routes';

const app = express();

// ─── Trust proxy (D1: req.ip reads X-Forwarded-For correctly behind ALB) ─────
app.set('trust proxy', 1);

// ─── Security headers (SECURITY-04) ──────────────────────────────────────────
app.use(helmet());

// ─── CORS (SECURITY-08: restricted to CORS_ORIGINS) ──────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., server-to-server, curl)
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
}));

// ─── Webhook route (before JSON parser — needs raw Buffer body for HMAC) ─────
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRouter);

// ─── Body parser (APP-03) ─────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── Request logger (APP-04) ──────────────────────────────────────────────────
app.use(requestLogger);

// ─── Public rate limiter for non-auth public endpoints (D2=B) ────────────────
const publicRateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'error', message: 'Too many requests — please try again later' });
  },
});

// ─── Routes ───────────────────────────────────────────────────────────────────
// Health check — first route, rate-limited (APP-07, SRV-03)
app.use(publicRateLimiter, healthRouter);

// API routes
app.use('/api/auth',        authRouter);
app.use('/api/super-admin', superAdminRouter);
app.use('/api/tenants',     tenantRouter);
app.use('/api/users',       userRouter);
app.use('/api/patients',    patientRouter);
app.use('/api/opd',         opdRouter);
app.use('/api/ipd',         ipdRouter);
app.use('/api/lab',           labRouter);
app.use('/api/inventory',     inventoryRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/payments',     paymentRouter);
app.use('/api/audit',        auditRouter);

// ─── 404 handler (APP-08) ─────────────────────────────────────────────────────
app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

// ─── Global error handler — MUST be last (APP-06, SECURITY-15) ───────────────
app.use(errorHandler);

export default app;
