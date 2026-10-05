import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { staffIdCardService } from './staff-id-card.service';
import { userRepository }    from '../user/user.repository';
import { ForbiddenError, ValidationError } from '../../shared/middleware/error-handler';

const userIdParamSchema = z.object({
  userId: z.string().min(1),
});

export async function generateStaffIdCard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const params = userIdParamSchema.safeParse(req.params);
    if (!params.success) throw new ValidationError('Invalid userId', { errors: params.error.flatten() });

    const targetUserId = params.data.userId;
    const requesterTenantId = req.user!.tenantId!;

    // Verify target user belongs to the same tenant
    const targetUser = await userRepository.findById(requesterTenantId, targetUserId);
    if (!targetUser) throw new ForbiddenError('Cross-tenant access denied');

    const result = await staffIdCardService.generate(
      requesterTenantId,
      targetUserId,
      req.user!.userId,
    );

    res.status(result.isNew ? 201 : 200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/public/staff-verification/:token — unauthenticated, read-only.
 * Always 200 with the allow-listed result shape, so status codes can't be used
 * as an existence oracle; `no-store` + `noindex` keep results out of caches
 * and search engines.
 */
export async function verifyStaffIdCard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await staffIdCardService.verify(req.params.token);

    res.set({
      'Cache-Control':   'no-store, max-age=0',
      Pragma:            'no-cache',
      'X-Robots-Tag':    'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}
