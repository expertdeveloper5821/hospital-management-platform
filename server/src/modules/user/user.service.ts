import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import config from '../../shared/config/env';
import { userRepository } from './user.repository';
import { IUser } from './user.model';
import { emailService } from '../../shared/services/email.service';
import { auditService } from '../../shared/services/audit.service';
import { UserRole, AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { ConflictError, NotFoundError } from '../../shared/middleware/error-handler';
import { CreateUserRequest, ListUsersFilters } from './user.types';

export class UserService {
  async createUser(tenantId: string, data: CreateUserRequest, createdBy: string): Promise<IUser> {
    // Check for duplicate email within tenant
    const existing = await userRepository.findByEmail(tenantId, data.email);
    if (existing) throw new ConflictError('A user with this email already exists in this tenant');

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex'); // 16-char hex
    const passwordHash = await bcrypt.hash(tempPassword, config.bcryptRounds);

    const user = await userRepository.save({
      tenantId,
      email:        data.email,
      passwordHash,
      role:         data.role,
      isActive:     true,
      isFirstLogin: true,
    });

    // Send welcome email — fails the operation if SMTP is unavailable (Answer C2=A)
    await emailService.sendWelcomeEmail(data.email, tempPassword);

    await auditService.log({
      entityType: AuditEntityType.USER_ACCOUNT,
      entityId:   user._id.toString(),
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { email: data.email, role: data.role },
    });

    return user;
  }

  async deactivateUser(tenantId: string, userId: string, requestedBy: string): Promise<void> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    // Last-admin guard (FR-04.7/8)
    if (user.role === UserRole.HOSPITAL_ADMIN) {
      const activeAdminCount = await userRepository.countActiveAdmins(tenantId);
      if (activeAdminCount <= 1) {
        throw new ConflictError(
          'Cannot deactivate the last active Hospital Admin. Assign another admin first.',
        );
      }
    }

    await userRepository.setActive(tenantId, userId, false);

    await auditService.log({
      entityType:    AuditEntityType.USER_ACCOUNT,
      entityId:      userId,
      action:        'UPDATE',
      userId:        requestedBy,
      tenantId,
      previousValue: { isActive: true },
      newValue:      { isActive: false },
    });
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    newRole: UserRole,
    requestedBy: string,
  ): Promise<void> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    // Last-admin guard when demoting an admin (FR-04.7)
    if (user.role === UserRole.HOSPITAL_ADMIN && newRole !== UserRole.HOSPITAL_ADMIN) {
      const activeAdminCount = await userRepository.countActiveAdmins(tenantId);
      if (activeAdminCount <= 1) {
        throw new ConflictError(
          'Cannot change role of the last active Hospital Admin. Assign another admin first.',
        );
      }
    }

    await userRepository.updateRole(tenantId, userId, newRole);

    await auditService.log({
      entityType:    AuditEntityType.USER_ACCOUNT,
      entityId:      userId,
      action:        'UPDATE',
      userId:        requestedBy,
      tenantId,
      previousValue: { role: user.role },
      newValue:      { role: newRole },
    });
  }

  async listUsers(
    tenantId: string,
    filters: ListUsersFilters,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<IUser>> {
    return userRepository.findAll(tenantId, filters, page, limit);
  }

  async getUserById(tenantId: string, userId: string): Promise<IUser> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }
}

export const userService = new UserService();
