import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { chargeService } from './charges.service';
import { CHARGE_CATEGORIES, ChargeCategory } from './charges.model';
import { ValidationError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';

const addChargeSchema = z.object({
  patientId:          z.string().min(1),
  category:           z.enum(CHARGE_CATEGORIES),
  description:        z.string().min(1).max(500),
  amount:             z.number().min(0.01).max(999_999_999.99),
  encounterReference: z.string().optional(),
});

const listChargesSchema = z.object({
  patientId:  z.string().optional(),
  category:   z.enum(CHARGE_CATEGORIES).optional(),
  startDate:  z.string().optional(),
  endDate:    z.string().optional(),
  addedBy:    z.string().optional(),
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(20).default(20),
});

export async function addCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = addChargeSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const charge = await chargeService.addCharge(
      req.user!.tenantId!,
      body.data,
      req.user!.userId,
      req.user!.role as UserRole,
    );
    res.status(201).json({ status: 'success', data: charge });
  } catch (err) { next(err); }
}

export async function voidCharge(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const charge = await chargeService.voidCharge(
      req.user!.tenantId!,
      req.params.chargeId,
      req.user!.userId,
      (req.user as { name?: string })?.name ?? req.user!.userId,
      req.user!.role as UserRole,
    );
    res.status(200).json({ status: 'success', data: charge });
  } catch (err) { next(err); }
}

export async function getPatientBill(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const bill = await chargeService.getBill(req.user!.tenantId!, req.params.patientId);
    res.status(200).json({ status: 'success', data: bill });
  } catch (err) { next(err); }
}

export async function listCharges(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listChargesSchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query', { errors: query.error.flatten() });

    const result = await chargeService.listCharges(req.user!.tenantId!, {
      patientId: query.data.patientId,
      category:  query.data.category as ChargeCategory | undefined,
      startDate: query.data.startDate,
      endDate:   query.data.endDate,
      addedBy:   query.data.addedBy,
      page:      query.data.page,
      limit:     query.data.limit,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
