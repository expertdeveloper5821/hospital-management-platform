import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './error-handler';

/**
 * Blocks access until the user changes their temporary password.
 * MW-FPC-01..05: Read isFirstLogin from JWT → 403 if true.
 * IMPORTANT: Must NOT be applied to POST /api/auth/change-password (deadlock).
 */
export function requireFirstPasswordChange(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.user?.isFirstLogin === true) {
    return next(
      new ForbiddenError(
        'Password change required before accessing this resource',
      ),
    );
  }
  next();
}
