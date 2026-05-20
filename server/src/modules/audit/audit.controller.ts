import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { auditService } from './audit.service';
import { UserRole } from '../../shared/types/common.types';

const querySchema = z.object({
  entityType: z.string().optional(),
  entityId:   z.string().optional(),
  userId:     z.string().optional(),
  dateFrom:   z.coerce.date().optional(),
  dateTo:     z.coerce.date().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/audit — accessible by HOSPITAL_ADMIN (own tenant) and SUPER_ADMIN (all tenants)
export async function getAuditLogs(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }

    // SUPER_ADMIN queries cross-tenant (tenantId: null); others are scoped to their tenant
    const tenantId = req.user!.role === UserRole.SUPER_ADMIN
      ? null
      : (req.user!.tenantId as string);

    const result = await auditService.queryLogs(tenantId, parsed.data);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
