import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../auth/auth.service';
import { authRepository } from '../auth/auth.repository';
import { ValidationError } from '../../shared/middleware/error-handler';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Minimum 8 characters')
    .regex(/[A-Z]/, 'Must include an uppercase letter')
    .regex(/[0-9]/, 'Must include a digit')
    .regex(/[^A-Za-z0-9]/, 'Must include a special character'),
});

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email().max(254),
  password: z.string().min(1).max(128),
});

// ─── Controllers ──────────────────────────────────────────────────────────────
export async function superAdminLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const result = await authService.login({
      email:        body.data.email,
      password:     body.data.password,
      isSuperAdmin: true,
    });

    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getSuperAdminProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await authRepository.findSuperAdminById(req.user!.userId);
    res.status(200).json({
      status: 'success',
      data: {
        userId:    req.user!.userId,
        email:     admin?.email ?? req.user!.email,
        role:      req.user!.role,
        tenantId:  null,
        createdAt: admin?.createdAt,
      },
    });
  } catch (err) { next(err); }
}

export async function superAdminLogout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers.authorization?.slice(7) ?? '';
    await authService.logout(token);
    res.status(200).json({ status: 'success', data: { message: 'Logged out successfully' } });
  } catch (err) { next(err); }
}

export async function changeSuperAdminPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = changePasswordSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const token = req.headers.authorization?.slice(7) ?? '';
    await authService.changeSuperAdminPassword(
      req.user!.userId,
      body.data.currentPassword,
      body.data.newPassword,
      token,
    );

    res.status(200).json({
      status: 'success',
      data:   { message: 'Password changed. Please log in again.' },
    });
  } catch (err) { next(err); }
}
