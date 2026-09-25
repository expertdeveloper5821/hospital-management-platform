import { Router } from 'express';
import multer, { FileFilterCallback } from 'multer';
import rateLimit from 'express-rate-limit';
import config from '../../shared/config/env';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { authenticateSuperAdmin } from '../../shared/middleware/authenticate-super-admin';
import { requireRole } from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { ValidationError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';
import {
  createTenant,
  listTenants,
  approveTenant,
  deactivateTenant,
  reactivateTenant,
  resendInvite,
  completeTenantSetup,
  getBranding,
  updateBranding,
  uploadParchaTemplate,
  removeParchaTemplate,
  getOpdSettings,
  updateOpdSettings,
  getPlatformSettings,
  updatePlatformTitle,
  uploadPlatformLogo,
  uploadPlatformFavicon,
} from './tenant.controller';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
      cb(null, true);
    } else {
      // Pass a ValidationError (400) so the global error handler surfaces a clear,
      // client-readable message instead of a generic 500 "something went wrong".
      cb(new ValidationError('Only JPEG and PNG images are allowed. Please upload a .jpg or .png file.'));
    }
  },
});

// Parcha template — full A4-page hospital-supplied background, larger budget than the logo.
// Also accepts PDF (a common letterhead export format) alongside PNG/JPEG images.
const parchaTemplateUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/png' || file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new ValidationError('Only JPEG, PNG, and PDF files are allowed. Please upload a .jpg, .png, or .pdf file.'));
    }
  },
});

// Platform-settings uploads — permissive MIME filter; handler validates via magic bytes
const platformLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true),
});

const platformFaviconUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true),
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
router.patch('/:tenantId/reactivate',   authenticateSuperAdmin, reactivateTenant);
router.post('/:tenantId/resend-invite', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), resendInvite);

// Public — invite consumption (rate-limited, no auth)
router.post('/setup', publicRateLimiter, completeTenantSetup);

// Branding — accessible by Hospital Admin within their tenant
router.get('/:tenantId/branding',   getBranding);
router.patch('/:tenantId/branding', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.HOSPITAL_ADMIN), logoUpload.single('logo'), updateBranding);

// Parcha template — hospital-supplied prescription slip background for OPD/IPD print pages
router.post('/:tenantId/branding/parcha-template',   authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.HOSPITAL_ADMIN), parchaTemplateUpload.single('template'), uploadParchaTemplate);
router.delete('/:tenantId/branding/parcha-template', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.HOSPITAL_ADMIN), removeParchaTemplate);

// OPD settings — readable by any authenticated tenant role (drives the New OPD
// Visit payment check); editable by Hospital Admin only. Tenant-pinned in the
// controller (assertOwnTenant), not just role-gated.
router.get('/:tenantId/opd-settings',   authenticateJWT, requireFirstPasswordChange, getOpdSettings);
router.patch('/:tenantId/opd-settings', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.HOSPITAL_ADMIN), updateOpdSettings);

// Platform settings — GET is public (rate-limited); PATCH + POST require Super Admin auth
const platformSettingsRateLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'error', message: 'Too many requests — please try again later' });
  },
});

router.get('/platform-settings',         platformSettingsRateLimiter, getPlatformSettings);
router.patch('/platform-settings',       authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), updatePlatformTitle);
router.post('/platform-settings/logo',   authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), platformLogoUpload.single('logo'),    uploadPlatformLogo);
router.post('/platform-settings/favicon', authenticateJWT, requireFirstPasswordChange, requireRole(UserRole.SUPER_ADMIN), platformFaviconUpload.single('favicon'), uploadPlatformFavicon);

export default router;
