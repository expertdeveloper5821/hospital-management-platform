import { Request, Response, NextFunction } from 'express';
import { authenticateJWT } from './authenticate-jwt';
import { requireFirstPasswordChange } from './require-first-password-change';
import { requireRole } from './require-role';
import { UserRole } from '../types/common.types';

const requireSuperAdminRole = requireRole(UserRole.SUPER_ADMIN);

export function authenticateSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  authenticateJWT(req, res, (authErr?: unknown) => {
    if (authErr) return next(authErr);

    requireFirstPasswordChange(req, res, (passwordErr?: unknown) => {
      if (passwordErr) return next(passwordErr);

      requireSuperAdminRole(req, res, next);
    });
  });
}
