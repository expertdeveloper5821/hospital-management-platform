import { Router }         from 'express';
import rateLimit          from 'express-rate-limit';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }     from '../../shared/middleware/scope-tenant';
import { requireRole }     from '../../shared/middleware/require-role';
import { getDashboardStats } from './dashboard.controller';
import { UserRole }        from '../../shared/types/common.types';

const router = Router();

// FR-E01.5.2: Max 10 cache-bypass requests per minute per tenant (applied on top of global limiter)
const dashboardRateLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             10,
  keyGenerator:    (req) => req.user?.tenantId ?? req.ip ?? 'unknown',
  skip:            (req) => req.query['refresh'] !== 'true',
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         (_req, res) => {
    res.status(429).json({
      status:  'error',
      message: 'Too many refresh requests — please wait before bypassing the cache again',
    });
  },
});

router.get(
  '/stats',
  authenticateJWT,
  scopeTenant,
  requireRole(
    UserRole.HOSPITAL_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.RECEPTIONIST,
    UserRole.STAFF,
  ),
  dashboardRateLimiter,
  getDashboardStats,
);

export default router;
