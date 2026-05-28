import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { userService } from './user.service';
import { UserRole } from '../../shared/types/common.types';
import { ValidationError } from '../../shared/middleware/error-handler';
import { objectIdSchema, paginationSchema } from '../../shared/utils/validation';

const createUserSchema = z.object({
  email: z.string().email().max(254),
  name:  z.string().min(1).max(200),
  role:  z.enum(Object.values(UserRole) as [string, ...string[]]),
});

const updateRoleSchema = z.object({
  role: z.enum(Object.values(UserRole) as [string, ...string[]]),
});

const userListSchema = paginationSchema.extend({
  role:     z.enum(Object.values(UserRole) as [string, ...string[]]).optional(),
  isActive: z.coerce.boolean().optional(),
});

const userIdParamSchema = z.object({
  userId: objectIdSchema,
});

// ─── /me handlers (no requireRole — all authenticated users) ─────────────────

const meProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200).trim(),
});

export async function getMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await userService.getUserById(req.user!.tenantId!, req.user!.userId);
    res.status(200).json({
      status: 'success',
      data: { userId: user._id, email: user.email, name: user.name, role: user.role, isActive: user.isActive },
    });
  } catch (err) { next(err); }
}

export async function updateMyProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = meProfileSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const user = await userService.updateUserProfile(
      req.user!.tenantId!,
      req.user!.userId,
      { name: body.data.name },
      req.user!.userId,
    );
    res.status(200).json({
      status: 'success',
      data: { userId: user._id, email: user.email, name: user.name, role: user.role },
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
    const { page, limit, role, isActive } = query.data;
    const result = await userService.listUsers(req.user!.tenantId!, { role: role as UserRole | undefined, isActive }, page, limit);
    res.status(200).json({ status: 'success', data: result });
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
