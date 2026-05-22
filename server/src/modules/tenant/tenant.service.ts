import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { tenantRepository } from './tenant.repository';
import { userRepository } from '../user/user.repository';
import { ITenant } from './tenant.model';
import { emailService } from '../../shared/services/email.service';
import { s3Service } from '../../shared/services/s3.service';
import { auditService } from '../../shared/services/audit.service';
import { tenantCache } from '../../shared/config/tenant-cache';
import config from '../../shared/config/env';
import { TenantStatus, AuditEntityType, UserRole, JWTPayload, PaginatedResult } from '../../shared/types/common.types';
import { NotFoundError, ConflictError, ValidationError, UnauthorizedError } from '../../shared/middleware/error-handler';
import { CreateTenantRequest, UpdateBrandingRequest, BrandingConfig } from './tenant.types';

const INVITE_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_LOGO_BYTES   = 2 * 1024 * 1024;       // 2 MB

export class TenantService {
  async createTenant(data: CreateTenantRequest, superAdminId: string): Promise<ITenant> {
    const tenant = await tenantRepository.save({
      name:                data.name,
      adminEmail:          data.adminEmail,
      status:              TenantStatus.PENDING_VERIFICATION,
      onboardingDocuments: data.onboardingDocuments,
      branding:            { displayName: data.name, primaryColor: '#1A73E8' },
    });

    await auditService.log({
      entityType: AuditEntityType.TENANT,
      entityId:   tenant._id.toString(),
      action:     'CREATE',
      userId:     superAdminId,
      tenantId:   null,
      newValue:   { name: data.name, adminEmail: data.adminEmail },
    });

    return tenant;
  }

  async approveTenant(tenantId: string, superAdminId: string): Promise<void> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    if (tenant.status === TenantStatus.ACTIVE) throw new ConflictError('Tenant is already active');

    await tenantRepository.updateStatus(tenantId, TenantStatus.ACTIVE);

    // Generate invite token and send email
    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + INVITE_EXPIRY_MS);
    await tenantRepository.saveInviteToken(tenantId, token, expiry);

    const inviteLink = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/setup?token=${token}`;
    await emailService.sendInviteEmail(tenant.adminEmail, inviteLink);

    tenantCache.invalidate(tenantId);

    await auditService.log({
      entityType:    AuditEntityType.TENANT,
      entityId:      tenantId,
      action:        'UPDATE',
      userId:        superAdminId,
      tenantId:      null,
      previousValue: { status: tenant.status },
      newValue:      { status: TenantStatus.ACTIVE },
    });
  }

  async deactivateTenant(tenantId: string, superAdminId: string): Promise<void> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');

    await tenantRepository.updateStatus(tenantId, TenantStatus.INACTIVE);
    tenantCache.invalidate(tenantId); // Force cache invalidation immediately

    await auditService.log({
      entityType:    AuditEntityType.TENANT,
      entityId:      tenantId,
      action:        'UPDATE',
      userId:        superAdminId,
      tenantId:      null,
      previousValue: { status: tenant.status },
      newValue:      { status: TenantStatus.INACTIVE },
    });
  }

  async listTenants(page: number, limit: number): Promise<PaginatedResult<ITenant>> {
    return tenantRepository.findAll(page, limit);
  }

  async resendInvite(tenantId: string, superAdminId: string): Promise<void> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');
    if (tenant.status !== TenantStatus.ACTIVE) throw new ConflictError('Tenant must be ACTIVE to resend invite');

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + INVITE_EXPIRY_MS);
    await tenantRepository.saveInviteToken(tenantId, token, expiry);

    const inviteLink = `${process.env.FRONTEND_URL ?? 'http://localhost:3001'}/setup?token=${token}`;
    await emailService.sendInviteEmail(tenant.adminEmail, inviteLink);

    await auditService.log({
      entityType: AuditEntityType.TENANT,
      entityId:   tenantId,
      action:     'UPDATE',
      userId:     superAdminId,
      tenantId:   null,
      newValue:   { event: 'invite_resent' },
    });
  }

  async completeTenantSetup(token: string, name: string, password: string): Promise<string> {
    const tenant = await tenantRepository.consumeInviteToken(token);
    if (!tenant) throw new UnauthorizedError('Invalid or expired invite token');

    const existing = await userRepository.findByEmail(tenant._id.toString(), tenant.adminEmail);
    if (existing) throw new ConflictError('Hospital admin account already set up. Please log in.');

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    const user = await userRepository.save({
      tenantId:            tenant._id.toString(),
      email:               tenant.adminEmail,
      name,
      passwordHash,
      role:                UserRole.HOSPITAL_ADMIN,
      isActive:            true,
      isFirstLogin:        false,
      failedLoginAttempts: 0,
    });

    await auditService.log({
      entityType: AuditEntityType.USER_ACCOUNT,
      entityId:   user._id.toString(),
      action:     'CREATE',
      userId:     user._id.toString(),
      tenantId:   tenant._id.toString(),
      newValue:   { email: tenant.adminEmail, role: UserRole.HOSPITAL_ADMIN },
    });

    const payload: JWTPayload = {
      userId:       user._id.toString(),
      tenantId:     tenant._id.toString(),
      role:         UserRole.HOSPITAL_ADMIN,
      email:        tenant.adminEmail,
      isFirstLogin: false,
    };

    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtExpiry as jwt.SignOptions['expiresIn'],
    });
  }

  async getBranding(tenantId: string): Promise<BrandingConfig> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');

    const branding = { ...tenant.branding };
    if (branding.logoUrl) {
      branding.logoUrl = await s3Service.getPresignedUrl(branding.logoUrl, 86400);
    }
    return branding;
  }

  async updateBranding(
    tenantId: string,
    data: UpdateBrandingRequest,
    logoBuffer?: Buffer,
    logoMimeType?: string,
    adminId?: string,
  ): Promise<void> {
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant not found');

    const update: Partial<BrandingConfig> = {};

    if (logoBuffer) {
      if (logoBuffer.length > MAX_LOGO_BYTES) {
        throw new ValidationError('Logo file must not exceed 2 MB');
      }
      const ext = logoMimeType === 'image/png' ? 'png' : 'jpg';
      const key = `tenants/${tenantId}/logos/logo.${ext}`;
      await s3Service.uploadFile(key, logoBuffer, logoMimeType ?? 'image/jpeg');
      update.logoUrl = key;
    }

    if (data.displayName)  update.displayName  = data.displayName;
    if (data.primaryColor) update.primaryColor = data.primaryColor;

    await tenantRepository.updateBranding(tenantId, update);

    await auditService.log({
      entityType:    AuditEntityType.TENANT,
      entityId:      tenantId,
      action:        'UPDATE',
      userId:        adminId ?? 'unknown',
      tenantId,
      previousValue: { branding: tenant.branding },
      newValue:      { branding: update },
    });
  }
}

export const tenantService = new TenantService();
