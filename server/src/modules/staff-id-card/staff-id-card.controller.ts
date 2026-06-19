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
