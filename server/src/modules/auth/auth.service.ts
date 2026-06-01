import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import config from '../../shared/config/env';
import { JWTPayload, UserRole, AuditEntityType } from '../../shared/types/common.types';
import { authRepository } from './auth.repository';
import { tenantRepository } from '../tenant/tenant.repository';
import { emailService } from '../../shared/services/email.service';
import { auditService } from '../../shared/services/audit.service';
import { addToDenylist } from '../../shared/middleware/token-denylist';
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
  AppError,
} from '../../shared/middleware/error-handler';
import { LoginRequest, LoginResponse, ChangePasswordResponse } from './auth.types';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export class AuthService {
  async login(data: LoginRequest): Promise<LoginResponse> {
    const { email, password, tenantId: inputTenantId, isSuperAdmin = false } = data;
    
    const account = isSuperAdmin
      ? await authRepository.findSuperAdminByEmail(email)
      : null;

    const user = !isSuperAdmin
      ? inputTenantId
        ? await authRepository.findUserByEmail(inputTenantId, email)
        : await authRepository.findUserByEmailAnyTenant(email)
      : null;

    const record = account ?? user;
   
    if (!record) {
      // FR-05.2: Never reveal whether email or password was incorrect
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check account lock
    if ('lockedUntil' in record && record.lockedUntil) {
      if (new Date() < record.lockedUntil) {
        throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
      }
      // Lock expired — auto-unlock
      await authRepository.unlockAccount(record._id.toString());
    }

    // Verify password
    const isValid = await bcrypt.compare(password, record.passwordHash);
    if (!isValid) {
      if ('failedLoginAttempts' in record) {
        const attempts = (record.failedLoginAttempts ?? 0) + 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
          await authRepository.lockAccount(record._id.toString(), lockUntil);
          await emailService.sendAccountLockEmail(record.email);
          await auditService.log({
            entityType: AuditEntityType.AUTH,
            entityId:   record._id.toString(),
            action:     'LOCKOUT',
            userId:     record._id.toString(),
            tenantId:   'tenantId' in record ? (record as { tenantId: string }).tenantId : null,
          });
          throw new UnauthorizedError('Account locked due to too many failed attempts. Check your email.');
        }
        await authRepository.incrementFailedAttempts(record._id.toString());
      }
      throw new UnauthorizedError('Invalid credentials');
    }

    // Check user is active (tenant users only)
    if ('isActive' in record && !record.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const userId   = record._id.toString();
    const role     = isSuperAdmin ? UserRole.SUPER_ADMIN : (record as { role: UserRole }).role;
    const tenantId = isSuperAdmin ? null : (record as { tenantId: string }).tenantId;
    const isFirstLogin = 'isFirstLogin' in record ? (record as { isFirstLogin: boolean }).isFirstLogin : false;

    const payload: JWTPayload = { userId, tenantId, role, email, isFirstLogin };
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiry as jwt.SignOptions['expiresIn'],
    });

    await auditService.log({
      entityType: AuditEntityType.AUTH,
      entityId:   userId,
      action:     'LOGIN',
      userId,
      tenantId,
    });

    return { token, userId, role, isFirstLogin };
  }

  async logout(token: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
      const expiryMs = ((decoded.exp ?? 0) * 1000) - Date.now();
      if (expiryMs > 0) addToDenylist(token, expiryMs);
      await auditService.log({
        entityType: AuditEntityType.AUTH,
        entityId:   decoded.userId,
        action:     'LOGOUT',
        userId:     decoded.userId,
        tenantId:   decoded.tenantId,
      });
    } catch {
      // Token already invalid — logout is idempotent
    }
  }

  async changePassword(
    userId: string,
    tenantId: string | null,
    currentPassword: string,
    newPassword: string,
  ): Promise<ChangePasswordResponse> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new NotFoundError('User not found');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedError('Current password is incorrect');

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) throw new ValidationError('New password must be different from the current password');

    const newHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await authRepository.recordPasswordChange(userId, newHash);

    await auditService.log({
      entityType: AuditEntityType.AUTH,
      entityId:   userId,
      action:     'PASSWORD_RESET',
      userId,
      tenantId,
    });

    // Issue a fresh token so the client's isFirstLogin flag is immediately updated
    const payload: JWTPayload = { userId, tenantId, role: user.role, email: user.email, isFirstLogin: false };
    const token = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiry as jwt.SignOptions['expiresIn'],
    });
    return { token };
  }

  async forgotPassword(email: string, tenantId: string): Promise<void> {
    const user = await authRepository.findUserByEmail(tenantId, email);

    if (!user) {
      // Detect setup-not-completed: tenant exists with this adminEmail but no user record yet
      const tenant = await tenantRepository.findById(tenantId);
      if (tenant && tenant.adminEmail === email.toLowerCase()) {
        throw new ValidationError(
          'Your account setup is not complete. Please check your email for the setup link, or ask your administrator to resend it.',
        );
      }
      // FR-05.8: For all other cases never reveal whether the email exists
      return;
    }

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await authRepository.saveResetToken(user._id.toString(), token, expiry);

    const resetLink = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/reset-password?token=${token}`;
    await emailService.sendPasswordResetEmail(email, resetLink);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await authRepository.consumeResetToken(token);
    if (!user) throw new UnauthorizedError('Invalid or expired reset token');

    const newHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await authRepository.recordPasswordChange(user._id.toString(), newHash);

    await auditService.log({
      entityType: AuditEntityType.AUTH,
      entityId:   user._id.toString(),
      action:     'PASSWORD_RESET',
      userId:     user._id.toString(),
      tenantId:   user.tenantId,
    });
  }

  async changeSuperAdminPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentToken: string,
  ): Promise<void> {
    const admin = await authRepository.findSuperAdminById(userId);
    if (!admin) throw new NotFoundError('Super admin not found');

    const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isValid) throw new UnauthorizedError('Current password is incorrect');

    const isSame = await bcrypt.compare(newPassword, admin.passwordHash);
    if (isSame) throw new ValidationError('New password must be different from the current password');

    const newHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await authRepository.recordSuperAdminPasswordChange(userId, newHash);

    try {
      const decoded = jwt.verify(currentToken, config.jwtSecret) as JWTPayload;
      const expiryMs = ((decoded.exp ?? 0) * 1000) - Date.now();
      if (expiryMs > 0) addToDenylist(currentToken, expiryMs);
    } catch { /* already invalid */ }

    await auditService.log({
      entityType: AuditEntityType.AUTH,
      entityId:   userId,
      action:     'PASSWORD_RESET',
      userId,
      tenantId:   null,
      newValue:   { field: 'password', changed: true },
    });
  }

  validateJWT(token: string): JWTPayload {
    try {
      return jwt.verify(token, config.jwtSecret) as JWTPayload;
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }
}

export const authService = new AuthService();
