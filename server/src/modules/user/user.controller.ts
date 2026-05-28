import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from './user.service';
import { s3Service } from '../../shared/services/s3.service';
import { UserRole } from '../../shared/types/common.types';
import { ValidationError } from '../../shared/middleware/error-handler';
import { objectIdSchema, paginationSchema } from '../../shared/utils/validation';
const PROFILE_IMAGE_URL_EXPIRY = 86400; // 24 h

async function resolveProfileImageUrl(key: string | null | undefined): Promise<string | null> {
  if (!key) return null;
  return s3Service.getPresignedUrl(key, PROFILE_IMAGE_URL_EXPIRY);
}

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

const createUserSchema = z.object({
  email: z.string().email().max(254),
  name:  z.string().min(1).max(200),
  role:  z.enum(Object.values(UserRole) as [string, ...string[]]),
});

const updateRoleSchema = z.object({
  role: z.enum(Object.values(UserRole) as [string, ...string[]]),
});

const SORT_BY_VALUES = ['name', 'createdAt', 'role'] as const;

const userListSchema = paginationSchema.extend({
  role:      z.enum(Object.values(UserRole) as [string, ...string[]]).optional(),
  isActive:  z.coerce.boolean().optional(),
  status:    z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search:    z.string().min(1).max(100).optional(),
  sortBy:    z.enum(SORT_BY_VALUES).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const userIdParamSchema = z.object({
  userId: objectIdSchema,
});

// ─── /me handlers ─────────────────────────────────────────────────────────────

const meProfileSchema = z.object({
  name:  z.string().min(1, 'Name is required').max(200).trim().optional(),
  phone: z.string().max(20).trim().nullable().optional(),
});

const mePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Minimum 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
});

export async function getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.getUserById(req.user!.tenantId!, req.user!.userId);
    const profileImageUrl = await resolveProfileImageUrl(user.profileImageUrl);
    res.status(200).json({
      status: 'success',
      data: {
        userId:          user._id,
        email:           user.email,
        name:            user.name,
        phone:           user.phone ?? null,
        profileImageUrl,
        role:            user.role,
        isActive:        user.isActive,
      },
    });
  } catch (err) { next(err); }
}

export async function updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = meProfileSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    if (body.data.name === undefined && body.data.phone === undefined) {
      throw new ValidationError('At least one of name or phone must be provided');
    }

    const user = await userService.updateMyOwnProfile(
      req.user!.tenantId!,
      req.user!.userId,
      body.data,
      req.user!.userId,
    );
    const profileImageUrl = await resolveProfileImageUrl(user.profileImageUrl);
    res.status(200).json({
      status: 'success',
      data: {
        userId:          user._id,
        email:           user.email,
        name:            user.name,
        phone:           user.phone ?? null,
        profileImageUrl,
        role:            user.role,
      },
    });
  } catch (err) { next(err); }
}

export async function uploadProfileImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No image file provided');

    const mimeType = req.file.mimetype;
    const ext = ALLOWED_IMAGE_TYPES[mimeType];
    if (!ext) throw new ValidationError('Unsupported image type. Use JPEG, PNG, or WebP.');

    // Magic-bytes check: verify declared MIME matches actual file header
    const buf = req.file.buffer;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    const isWebp = buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP';

    const mimeOk =
      (mimeType === 'image/jpeg' && isJpeg) ||
      (mimeType === 'image/png'  && isPng)  ||
      (mimeType === 'image/webp' && isWebp);
    if (!mimeOk) throw new ValidationError('File content does not match declared image type.');

    const user = await userService.uploadProfileImage(
      req.user!.tenantId!,
      req.user!.userId,
      buf,
      mimeType,
      ext,
      req.user!.userId,
    );

    const profileImageUrl = await resolveProfileImageUrl(user.profileImageUrl);
    res.status(200).json({
      status: 'success',
      data: { profileImageUrl },
    });
  } catch (err) { next(err); }
}

export async function changeMyPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = mePasswordSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    await userService.changeMyPassword(
      req.user!.tenantId!,
      req.user!.userId,
      body.data,
      token,
    );

    res.status(200).json({
      status:  'success',
      data:    { message: 'Password changed. Please log in again.' },
    });
  } catch (err) { next(err); }
}

// ─── Admin / HR handlers ──────────────────────────────────────────────────────

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createUserSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const user = await userService.createUser(req.user!.tenantId!, body.data as Parameters<typeof userService.createUser>[1], req.user!.userId);
    res.status(201).json({ status: 'success', data: { userId: user._id, email: user.email, name: user.name, role: user.role } });
  } catch (err) { next(err); }
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = userListSchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');
    const { page, limit, role, isActive, status, search, sortBy, sortOrder } = query.data;

    // `status` (ACTIVE/INACTIVE) takes precedence over legacy `isActive` boolean
    let resolvedIsActive: boolean | undefined = isActive;
    if (status !== undefined) resolvedIsActive = status === 'ACTIVE';

    // Clamp limit per FR-E04.4.2 (paginationSchema already caps at 100, but make explicit)
    const clampedLimit = Math.min(limit, 100);

    const result = await userService.listUsers(
      req.user!.tenantId!,
      {
        role:      role as UserRole | undefined,
        isActive:  resolvedIsActive,
        search,
        sortBy:    sortBy as 'name' | 'createdAt' | 'role' | undefined,
        sortOrder: sortOrder as 'asc' | 'desc' | undefined,
      },
      page,
      clampedLimit,
    );

    const responseData = clampedLimit < limit
      ? { ...result, warning: 'limit clamped to 100' }
      : result;

    res.status(200).json({ status: 'success', data: responseData });
  } catch (err) { next(err); }
}

export async function getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = userIdParamSchema.parse(req.params);
    const user = await userService.getUserById(req.user!.tenantId!, userId);
    res.status(200).json({ status: 'success', data: { userId: user._id, email: user.email, name: user.name, role: user.role, isActive: user.isActive } });
  } catch (err) { next(err); }
}

export async function updateUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = userIdParamSchema.parse(req.params);
    const body = updateRoleSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    await userService.updateUserRole(req.user!.tenantId!, userId, body.data.role as UserRole, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'Role updated' } });
  } catch (err) { next(err); }
}

export async function deactivateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = userIdParamSchema.parse(req.params);
    await userService.deactivateUser(req.user!.tenantId!, userId, req.user!.userId);
    res.status(200).json({ status: 'success', data: { message: 'User deactivated' } });
  } catch (err) { next(err); }
}

const updateProfileSchema = z.object({
  name:  z.string().min(1).max(200).optional(),
  email: z.string().email().max(254).optional(),
}).refine((d) => d.name !== undefined || d.email !== undefined, {
  message: 'At least one of name or email must be provided',
});

export async function updateUserProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = userIdParamSchema.parse(req.params);
    const body = updateProfileSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const user = await userService.updateUserProfile(
      req.user!.tenantId!,
      userId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({
      status: 'success',
      data: { userId: user._id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
    });
  } catch (err) { next(err); }
}
