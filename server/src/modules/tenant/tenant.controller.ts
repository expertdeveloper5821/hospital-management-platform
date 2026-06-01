import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { tenantService } from './tenant.service';
import { platformSettingsRepository } from './platform-settings.repository';
import { s3Service } from '../../shared/services/s3.service';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
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

// ─── Platform Settings ────────────────────────────────────────────────────────

const updatePlatformTitleSchema = z.object({
  platformTitle: z.string()
    .min(1, 'Platform title is required')
    .max(100, 'Platform title must not exceed 100 characters')
    .transform((v) => v.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' }[c] ?? c))),
});

const LOGO_ALLOWED_MIMES    = new Set(['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']);
const FAVICON_ALLOWED_MIMES = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png']);
const MAX_LOGO_BYTES         = 2 * 1024 * 1024;   // 2 MB
const MAX_FAVICON_BYTES      = 500 * 1024;          // 500 KB

function detectMimeFromMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  // WebP: 52 49 46 46 ... 57 45 42 50
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'image/webp';
  }
  // SVG: starts with '<' (0x3C) — text-based, accept declared mime
  if (buffer[0] === 0x3c) return 'image/svg+xml';
  // ICO: 00 00 01 00
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
  return null;
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg':              'jpg',
    'image/png':               'png',
    'image/svg+xml':           'svg',
    'image/webp':              'webp',
    'image/x-icon':            'ico',
    'image/vnd.microsoft.icon': 'ico',
  };
  return map[mime] ?? 'bin';
}

export async function getPlatformSettings(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await platformSettingsRepository.get();
    const logoUrl    = settings.logoUrl    ? await s3Service.getPresignedUrl(settings.logoUrl,    86400) : null;
    const faviconUrl = settings.faviconUrl ? await s3Service.getPresignedUrl(settings.faviconUrl, 86400) : null;
    res.status(200).json({
      status: 'success',
      data: {
        logoUrl,
        faviconUrl,
        platformTitle: settings.platformTitle,
        updatedAt:     settings.updatedAt,
      },
    });
  } catch (err) { next(err); }
}

export async function updatePlatformTitle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updatePlatformTitleSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const prev = await platformSettingsRepository.get();
    await platformSettingsRepository.upsert({ platformTitle: body.data.platformTitle, updatedBy: req.user!.userId });

    await auditService.log({
      entityType:    AuditEntityType.PLATFORM_SETTINGS,
      entityId:      'singleton',
      action:        'UPDATE',
      userId:        req.user!.userId,
      tenantId:      null,
      previousValue: { platformTitle: prev.platformTitle },
      newValue:      { platformTitle: body.data.platformTitle },
    });

    res.status(200).json({ status: 'success', data: { message: 'Platform title updated' } });
  } catch (err) { next(err); }
}

export async function uploadPlatformLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('Logo file is required');

    const detectedMime = detectMimeFromMagicBytes(req.file.buffer) ?? req.file.mimetype;
    if (!LOGO_ALLOWED_MIMES.has(detectedMime)) {
      throw new ValidationError('Logo must be JPEG, PNG, SVG, or WebP');
    }
    if (req.file.buffer.length > MAX_LOGO_BYTES) {
      throw new ValidationError('Logo must not exceed 2 MB');
    }

    const prev = await platformSettingsRepository.get();
    const ext  = mimeToExt(detectedMime);
    const key  = `platform/logo.${ext}`;

    if (prev.logoUrl && prev.logoUrl !== key) {
      await s3Service.deleteFile(prev.logoUrl).catch(() => { /* best-effort */ });
    }

    await s3Service.uploadFile(key, req.file.buffer, detectedMime);
    await platformSettingsRepository.upsert({ logoUrl: key, updatedBy: req.user!.userId });

    await auditService.log({
      entityType: AuditEntityType.PLATFORM_SETTINGS,
      entityId:   'singleton',
      action:     'UPDATE',
      userId:     req.user!.userId,
      tenantId:   null,
      newValue:   { logoUrl: key },
    });

    res.status(200).json({ status: 'success', data: { message: 'Platform logo updated' } });
  } catch (err) { next(err); }
}

export async function uploadPlatformFavicon(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('Favicon file is required');

    const detectedMime = detectMimeFromMagicBytes(req.file.buffer) ?? req.file.mimetype;
    if (!FAVICON_ALLOWED_MIMES.has(detectedMime)) {
      throw new ValidationError('Favicon must be ICO or PNG');
    }
    if (req.file.buffer.length > MAX_FAVICON_BYTES) {
      throw new ValidationError('Favicon must not exceed 500 KB');
    }

    const prev = await platformSettingsRepository.get();
    const ext  = mimeToExt(detectedMime);
    const key  = `platform/favicon.${ext}`;

    if (prev.faviconUrl && prev.faviconUrl !== key) {
      await s3Service.deleteFile(prev.faviconUrl).catch(() => { /* best-effort */ });
    }

    await s3Service.uploadFile(key, req.file.buffer, detectedMime);
    await platformSettingsRepository.upsert({ faviconUrl: key, updatedBy: req.user!.userId });

    await auditService.log({
      entityType: AuditEntityType.PLATFORM_SETTINGS,
      entityId:   'singleton',
      action:     'UPDATE',
      userId:     req.user!.userId,
      tenantId:   null,
      newValue:   { faviconUrl: key },
    });

    res.status(200).json({ status: 'success', data: { message: 'Platform favicon updated' } });
  } catch (err) { next(err); }
}
