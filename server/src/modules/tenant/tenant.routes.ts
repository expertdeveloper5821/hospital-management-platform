import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import config from '../../shared/config/env';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { requireRole } from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole } from '../../shared/types/common.types';
import {
  createTenant,
  listTenants,
  approveTenant,
  deactivateTenant,
  resendInvite,
  completeTenantSetup,
  getBranding,
  updateBranding,
} from './tenant.controller';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  },
});

const router = Router();

// Public rate limiter for /setup endpoint
const publicRateLimiter = rateLimit({
  windowMs:        config.rateLimit.windowMs,
  max:             config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'error', message: 'Too many requests — please try again later' });
  },
});

// Super Admin routes
router.post('/',                        authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), createTenant);
router.get('/',                         authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), listTenants);
router.patch('/:tenantId/approve',      authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), approveTenant);
router.patch('/:tenantId/deactivate',   authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), deactivateTenant);
router.post('/:tenantId/resend-invite', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), resendInvite);

// Public — invite consumption (rate-limited, no auth)
router.post('/setup', publicRateLimiter, completeTenantSetup);

// Branding — accessible by Hospital Admin within their tenant
router.get('/:tenantId/branding',   getBranding);
router.patch('/:tenantId/branding', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.HOSPITAL_ADMIN), logoUpload.single('logo'), updateBranding);

export default router;
