import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { tenantService } from './tenant.service';
import { ValidationError } from '../../shared/middleware/error-handler';
import { objectIdSchema, paginationSchema } from '../../shared/utils/validation';

const createTenantSchema = z.object({
  name:       z.string().min(1).max(200),
  adminEmail: z.string().email().max(254),
  onboardingDocuments: z.object({
    registrationCertificate: z.string().min(1),
    gstNumber:               z.string().min(1),
    panCard:                 z.string().min(1),
    addressProof:            z.string().min(1),
  }),
});

const updateBrandingSchema = z.object({
  displayName:  z.string().min(1).max(200).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const tenantIdParamSchema = z.object({
  tenantId: objectIdSchema,
});

export async function createTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createTenantSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const tenant = await tenantService.createTenant(body.data, req.user!.userId);
    res.status(201).json({ status: 'success', data: tenant });
  } catch (err) { next(err); }
}

export async function listTenants(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = paginationSchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');
    const result = await tenantService.listTenants(query.data.page, query.data.limit);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function approveTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = tenantIdParamSchema.parse(req.params);
    await tenantService.approveTenant(tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Tenant approved' } });
  } catch (err) { next(err); }
}

export async function deactivateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = tenantIdParamSchema.parse(req.params);
    await tenantService.deactivateTenant(tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Tenant deactivated' } });
  } catch (err) { next(err); }
}

export async function resendInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = tenantIdParamSchema.parse(req.params);
    await tenantService.resendInvite(tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Invite resent' } });
  } catch (err) { next(err); }
}

const completeSetupSchema = z.object({
  token:    z.string().min(1),
  name:     z.string().min(1).max(200),
  password: z.string().min(8).max(128),
});

export async function completeTenantSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = completeSetupSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const jwtToken = await tenantService.completeTenantSetup(body.data.token, body.data.name, body.data.password);
    res.status(201).json({ status: 'success', data: { jwtToken } });
  } catch (err) { next(err); }
}

export async function getBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = tenantIdParamSchema.parse(req.params);
    const branding = await tenantService.getBranding(tenantId);
    res.status(200).json({ status: 'success', data: branding });
  } catch (err) { next(err); }
}

export async function updateBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenantId } = tenantIdParamSchema.parse(req.params);
    const body = updateBrandingSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    await tenantService.updateBranding(
      tenantId,
      body.data,
      req.file?.buffer,
      req.file?.mimetype,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: { message: 'Branding updated' } });
  } catch (err) { next(err); }
}
