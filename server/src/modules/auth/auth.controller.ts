import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from './auth.service';
import { authRepository } from './auth.repository';
import { ValidationError } from '../../shared/middleware/error-handler';

// ─── Zod schemas ──────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:        z.string().email().max(254),
  password:     z.string().min(1).max(128),
  tenantId:     z.string().optional(),
  isSuperAdmin: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword:     z.string().min(8).max(128),
});

const forgotPasswordSchema = z.object({
  email:    z.string().email().max(254),
  tenantId: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

// ─── Controllers ──────────────────────────────────────────────────────────────
export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const result = await authService.login({
      email:        body.data.email,
      password:     body.data.password,
      tenantId:     body.data.tenantId,
      isSuperAdmin: body.data.isSuperAdmin,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.headers.authorization?.slice(7) ?? '';
    await authService.logout(token);
    res.status(200).json({ status: 'success', data: { message: 'Logged out successfully' } });
  } catch (err) { next(err); }
}

export async function changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = changePasswordSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const { token } = await authService.changePassword(
      req.user!.userId,
      req.user!.tenantId,
      req.user!.role,
      req.user!.email,
      body.data.currentPassword,
      body.data.newPassword,
    );
    res.status(200).json({ status: 'success', data: { message: 'Password changed successfully', token } });
  } catch (err) { next(err); }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = forgotPasswordSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    await authService.forgotPassword(body.data.email, body.data.tenantId);
    // Always return success — never reveal whether email exists (FR-05.8)
    res.status(200).json({ status: 'success', data: { message: 'If that email exists, a reset link has been sent' } });
  } catch (err) { next(err); }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = resetPasswordSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    await authService.resetPassword(body.data.token, body.data.newPassword);
    res.status(200).json({ status: 'success', data: { message: 'Password reset successfully' } });
  } catch (err) { next(err); }
}

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authRepository.findUserById(req.user!.userId);
    if (!user) {
      res.status(200).json({ status: 'success', data: {
        userId:   req.user!.userId,
        email:    req.user!.email,
        role:     req.user!.role,
        tenantId: req.user!.tenantId,
      }});
      return;
    }
    res.status(200).json({ status: 'success', data: {
      userId:      user._id.toString(),
      email:       user.email,
      role:        user.role,
      tenantId:    user.tenantId,
      isFirstLogin: user.isFirstLogin,
    }});
  } catch (err) { next(err); }
}
