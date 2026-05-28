import { Request, Response, NextFunction } from 'express';
import { z }                              from 'zod';
import { dashboardService }               from './dashboard.service';
import { UserRole }                        from '../../shared/types/common.types';

const querySchema = z.object({
  refresh: z.enum(['true', 'false']).optional(),
});

export async function getDashboardStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = querySchema.safeParse(req.query);
    const bypassCache = parsed.success && parsed.data.refresh === 'true';

    const tenantId = req.user!.tenantId as string;
    const role     = req.user!.role as UserRole;

    const stats = await dashboardService.getStats(tenantId, role, bypassCache);

    res.status(200).json({ status: 'success', data: stats });
  } catch (err) {
    next(err);
  }
}
