import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { tenantService } from './tenant.service';
import { ValidationError } from '../../shared/middleware/error-handler';

export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 }, // 2 MB — enforced again server-side
  fileFilter(_req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
}).single('logo');

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

const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
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
    await tenantService.approveTenant(req.params.tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Tenant approved' } });
  } catch (err) { next(err); }
}

export async function deactivateTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await tenantService.deactivateTenant(req.params.tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Tenant deactivated' } });
  } catch (err) { next(err); }
}

export async function resendInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await tenantService.resendInvite(req.params.tenantId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Invite resent' } });
  } catch (err) { next(err); }
}

export async function completeTenantSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = z.object({
      token:    z.string().min(1),
      password: z.string().min(8).max(128),
    }).safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const result = await tenantService.completeTenantSetup(body.data.token, body.data.password);
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const branding = await tenantService.getBranding(req.params.tenantId);
    res.status(200).json({ status: 'success', data: branding });
  } catch (err) { next(err); }
}

export async function updateBranding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateBrandingSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    await tenantService.updateBranding(
      req.params.tenantId,
      body.data,
      undefined,
      undefined,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: { message: 'Branding updated' } });
  } catch (err) { next(err); }
}

export async function uploadLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No logo file provided');
    await tenantService.updateBranding(
      req.params.tenantId,
      {},
      req.file.buffer,
      req.file.mimetype,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: { message: 'Logo uploaded' } });
  } catch (err) { next(err); }
}
