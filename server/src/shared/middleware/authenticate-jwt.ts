import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import { JWTPayload } from '../types/common.types';
import { isInDenylist } from './token-denylist';
import { UnauthorizedError } from './error-handler';

// Extend Express Request to carry decoded JWT payload
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      correlationId?: string;
    }
  }
}

/**
 * Validates Bearer JWT on every protected request.
 * MW-AUTH-01..09: Extract → verify signature → check denylist → attach req.user
 * SECURITY-08: Deny by default — all protected routes require this middleware.
 * PBT property: sign(payload) → verify → decoded equals original payload (round-trip).
 */
export function authenticateJWT(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Authentication required'));
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;

    // MW-AUTH-06/07: Check token denylist (logout invalidation)
    if (isInDenylist(token)) {
      return next(new UnauthorizedError('Authentication required'));
    }

    req.user = decoded;
    next();
  } catch {
    // MW-AUTH-09: Generic 401 — never reveal whether failure was expiry or bad signature
    next(new UnauthorizedError('Authentication required'));
  }
}
