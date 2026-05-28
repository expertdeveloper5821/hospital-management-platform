import { Router }          from 'express';
import rateLimit           from 'express-rate-limit';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }     from '../../shared/middleware/scope-tenant';
import { searchEntities }  from './search.controller';

const router = Router();

// 30 requests per minute per authenticated user
const searchRateLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             30,
  keyGenerator:    (req) => req.user?.userId ?? req.ip ?? 'unknown',
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         (_req, res) => {
    res.status(429).json({
      status:  'error',
      message: 'Too many search requests — please slow down',
    });
  },
});

router.get(
  '/',
  authenticateJWT,
  scopeTenant,
  searchRateLimiter,
  searchEntities,
);

export default router;
