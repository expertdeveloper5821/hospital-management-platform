import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../../shared/config/env';
import { verifyStaffIdCard } from './staff-id-card.controller';

// Public Staff ID Card QR verification. Deliberately NO authenticateJWT /
// scopeTenant: the caller is anyone who scanned a card. Tenant isolation is
// enforced in StaffIdCardService.verify via the card record's own tenantId.
const router = Router();

export const staffVerifyRateLimiter = rateLimit({
  windowMs:        config.staffVerification.rateLimitWindowMs,
  limit:           config.staffVerification.rateLimitMax,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).set('Cache-Control', 'no-store').json({
      status:  'error',
      message: 'Too many requests - please try again later',
    });
  },
});

// Limiter covers every request under this mount (any method / malformed path),
// not just well-formed GETs, so probing can't bypass it.
router.use(staffVerifyRateLimiter);
router.get('/:token', verifyStaffIdCard);

export default router;
