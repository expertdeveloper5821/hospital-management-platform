import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../../shared/config/env';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { login, logout, changePassword, forgotPassword, resetPassword, getMe } from './auth.controller';

const router = Router();

// Rate limiter for sensitive auth endpoints (FR-05.10, SECURITY-11)
const authRateLimiter = rateLimit({
  windowMs:       config.rateLimit.windowMs,
  max:            config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ status: 'error', message: 'Too many requests — please try again later' });
  },
});

// Public routes (rate-limited)
router.post('/login',          authRateLimiter, login);
router.post('/forgot-password', authRateLimiter, forgotPassword);
router.post('/reset-password',  authRateLimiter, resetPassword);

// Protected routes — require valid JWT
// change-password: authenticateJWT only (NOT requireFirstPasswordChange — would deadlock)
router.post('/change-password', authenticateJWT, changePassword);

// All other protected routes require first-password-change
router.post('/logout', authenticateJWT, requireFirstPasswordChange, logout);
router.get('/me',      authenticateJWT, requireFirstPasswordChange, getMe);

export default router;
