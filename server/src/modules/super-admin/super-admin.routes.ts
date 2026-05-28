import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../../shared/config/env';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { requireRole } from '../../shared/middleware/require-role';
import { UserRole } from '../../shared/types/common.types';
import { superAdminLogin, getSuperAdminProfile, superAdminLogout, changeSuperAdminPassword } from './super-admin.controller';

const router = Router();

const authRateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'error', message: 'Too many requests — please try again later' });
  },
});

// Public — rate-limited
router.post('/login', authRateLimiter, superAdminLogin);

// Protected — must be SUPER_ADMIN
router.get('/me',          authenticateJWT, requireRole(UserRole.SUPER_ADMIN), getSuperAdminProfile);
router.patch('/me/password', authenticateJWT, requireRole(UserRole.SUPER_ADMIN), changeSuperAdminPassword);
router.post('/logout',     authenticateJWT, requireRole(UserRole.SUPER_ADMIN), superAdminLogout);

export default router;





