import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import config from './shared/config/env';
import {
  isAllowedOrigin,
  normalizeOrigin,
} from './shared/utils/cors';

import { requestLogger } from './shared/middleware/request-logger';
import {
  errorHandler,
  NotFoundError,
} from './shared/middleware/error-handler';

import healthRouter from './shared/routes/health.routes';

import authRouter from './modules/auth/auth.routes';
import superAdminRouter from './modules/super-admin/super-admin.routes';
import tenantRouter from './modules/tenant/tenant.routes';
import userRouter from './modules/user/user.routes';
import patientRouter from './modules/patient/patient.routes';
import opdRouter from './modules/opd/opd.routes';
import ipdRouter from './modules/ipd/ipd.routes';
import labRouter from './modules/lab/lab.routes';
import inventoryRouter from './modules/inventory/inventory.routes';
import notificationRouter from './modules/notification/notification.routes';
import paymentRouter from './modules/payment/payment.routes';
import webhookRouter from './modules/payment/payment.webhook.routes';
import auditRouter from './modules/audit/audit.routes';
import dashboardRouter from './modules/dashboard/dashboard.routes';
import searchRouter    from './modules/search/search.routes';

const app = express();

app.set('trust proxy', 1);

// SECURITY HEADERS
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

// CORS CONFIG
const normalizedAllowedOrigins = (config.allowedOrigins || []).map((origin) =>
  origin.replace(/\/+$/, '')
);

console.log('Allowed Origins:', normalizedAllowedOrigins);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin
    // (mobile apps, Postman, curl, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    const normalizedOrigin = origin.replace(/\/+$/, '');

    if (normalizedAllowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    console.error(`CORS blocked for origin: ${origin}`);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
  ],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Correlation-ID',
  ],
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// WEBHOOK ROUTE
// Must be BEFORE express.json()
app.use(
  '/api/webhooks',
  express.raw({ type: 'application/json' }),
  webhookRouter
);

// BODY PARSER
app.use(
  express.json({
    limit: '10mb',
  })
);

// REQUEST LOGGER
app.use(requestLogger);

// RATE LIMITER
const publicRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,

  max: config.rateLimit.maxRequests,

  standardHeaders: true,

  legacyHeaders: false,

  handler: (_req, res) => {
    res.status(429).json({
      status: 'error',
      message:
        'Too many requests - please try again later',
    });
  },
});

// HEALTH ROUTE
app.use(publicRateLimiter, healthRouter);

// API ROUTES
app.use('/api/auth', authRouter);

app.use('/api/super-admin', superAdminRouter);
app.use('/api/tenants', tenantRouter);
app.use('/api/users', userRouter);
app.use('/api/patients', patientRouter);
app.use('/api/opd', opdRouter);
app.use('/api/ipd', ipdRouter);
app.use('/api/lab', labRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/payments', paymentRouter);
app.use('/api/audit', auditRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/search',    searchRouter);

// 404 HANDLER
app.use((_req, _res, next) => {
  next(new NotFoundError('Route not found'));
});

// GLOBAL ERROR HANDLER
// MUST BE LAST
app.use(errorHandler);
export default app;
