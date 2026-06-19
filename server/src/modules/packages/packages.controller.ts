import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { packageService } from './packages.service';
import { ValidationError } from '../../shared/middleware/error-handler';

const createPackageSchema = z.object({
  name:             z.string().min(1).max(200),
  description:      z.string().min(0).max(500).optional(),
  price:            z.number().min(0),
  includedServices: z.array(z.string().min(1).max(300)).min(1).max(50),
});

const updatePackageSchema = z.object({
  name:             z.string().min(1).max(200).optional(),
  description:      z.string().min(0).max(500).optional(),
  price:            z.number().min(0).optional(),
  includedServices: z.array(z.string().min(1).max(300)).min(1).max(50).optional(),
  status:           z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const assignPackageSchema = z.object({
  patientId:    z.string().min(1),
  assignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function createPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createPackageSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const pkg = await packageService.createPackage(req.user!.tenantId!, body.data, req.user!.userId);
    res.status(201).json({ status: 'success', data: pkg });
  } catch (err) { next(err); }
}

export async function listPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page   = Number(req.query.page)  || 1;
    const limit  = Number(req.query.limit) || 20;
    const status = req.query.status as 'ACTIVE' | 'INACTIVE' | undefined;
    const result = await packageService.listPackages(req.user!.tenantId!, { status, page, limit });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pkg = await packageService.getPackageById(req.user!.tenantId!, req.params.packageId);
    res.status(200).json({ status: 'success', data: pkg });
  } catch (err) { next(err); }
}

export async function updatePackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updatePackageSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const pkg = await packageService.updatePackage(
      req.user!.tenantId!,
      req.params.packageId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: pkg });
  } catch (err) { next(err); }
}

export async function assignPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = assignPackageSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const assignment = await packageService.assignPackage(
      req.user!.tenantId!,
      req.params.packageId,
      body.data,
      req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: assignment });
  } catch (err) { next(err); }
}

export async function cancelAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const assignment = await packageService.cancelAssignment(
      req.user!.tenantId!,
      req.params.assignmentId,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: assignment });
  } catch (err) { next(err); }
}
