import crypto from 'crypto';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../shared/config/env';
import { userRepository } from './user.repository';
import { IUser } from './user.model';
import { emailService } from '../../shared/services/email.service';
import { auditService } from '../../shared/services/audit.service';
import { s3Service } from '../../shared/services/s3.service';
import { addToDenylist } from '../../shared/middleware/token-denylist';
import { JWTPayload, UserRole, AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '../../shared/middleware/error-handler';
import { CreateUserRequest, ListUsersFilters, UpdateProfileRequest, UpdateMyProfileRequest, ChangeMyPasswordRequest } from './user.types';
import { opdRepository } from '../opd/opd.repository';
import { ipdRepository } from '../ipd/ipd.repository';
import { getFrontendBaseUrl } from '../../shared/utils/frontend-url';

// Roles that must never be created or assigned through tenant user-management.
// SUPER_ADMIN would escalate privileges outside tenant scope; HOSPITAL_ADMIN is
// provisioned only through tenant onboarding.
const NON_ASSIGNABLE_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN];

export class UserService {
  async createUser(tenantId: string, data: CreateUserRequest, createdBy: string): Promise<IUser> {
    // SUPER_ADMIN / HOSPITAL_ADMIN cannot be created via tenant user-management —
    // prevents privilege escalation and enforces admin-onboarding-only.
    if (NON_ASSIGNABLE_ROLES.includes(data.role)) {
      throw new ForbiddenError(`The ${data.role} role cannot be assigned to a user.`);
    }

    // Check for duplicate email within tenant
    const existing = await userRepository.findByEmail(tenantId, data.email);
    if (existing) throw new ConflictError('A user with this email already exists in this tenant');

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex'); // 16-char hex
    const passwordHash = await bcrypt.hash(tempPassword, config.bcryptRounds);

    const user = await userRepository.save({
      tenantId,
      email:        data.email,
      name:         data.name,
      passwordHash,
      role:         data.role,
      departmentIds: data.departmentIds ?? [],
      isActive:     true,
      isFirstLogin: true,
    });

    // Send welcome email — fails the operation if SMTP is unavailable (Answer C2=A).
    const loginUrl = `${getFrontendBaseUrl()}/login`;
    await emailService.sendWelcomeEmail(data.email, tempPassword, loginUrl, tenantId);

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

  async reactivateUser(tenantId: string, userId: string, requestedBy: string): Promise<void> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');
    if (user.isActive) throw new ConflictError('User must be inactive to reactivate');

    // No role/permission/data changes — reactivation only restores isActive so
    // the user regains login access and their existing role's permissions.
    await userRepository.setActive(tenantId, userId, true);

    await auditService.log({
      entityType:    AuditEntityType.USER_ACCOUNT,
      entityId:      userId,
      action:        'UPDATE',
      userId:        requestedBy,
      tenantId,
      previousValue: { isActive: false },
      newValue:      { isActive: true },
    });
  }

  /**
   * Doctor role-change restriction — resolve the doctor's active patient load
   * across OPD (OPEN / IN_PROGRESS visits) and IPD (ADMITTED admissions).
   * Returns null for non-doctors: the restriction never applies to them, and
   * no encounter query is issued at all. A patient active via both OPD and IPD
   * is counted once in `total` (distinct patientId union) while `breakdown`
   * keeps the per-source counts for the UI.
   *
   * NOTE: imports OPD/IPD repositories only — never their services — so the
   * dependency graph stays acyclic (opd.service.ts imports userRepository).
   */
  private async resolveDoctorActiveLoad(
    tenantId: string,
    user: IUser,
  ): Promise<{ total: number; opd: number; ipd: number } | null> {
    if (user.role !== UserRole.DOCTOR) return null;

    const [opdPatientIds, ipdPatientIds] = await Promise.all([
      opdRepository.countActivePatientsByDoctor(tenantId, user._id.toString()),
      ipdRepository.countActivePatientsByDoctor(tenantId, user._id.toString()),
    ]);

    return {
      total: new Set([...opdPatientIds, ...ipdPatientIds]).size,
      opd:   opdPatientIds.length,
      ipd:   ipdPatientIds.length,
    };
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    newRole: UserRole,
    requestedBy: string,
  ): Promise<void> {
    // A user cannot change their own role.
    if (userId === requestedBy) {
      throw new ForbiddenError('You cannot change your own role.');
    }
    // SUPER_ADMIN / HOSPITAL_ADMIN cannot be assigned to any user (privilege
    // escalation / onboarding-only).
    if (NON_ASSIGNABLE_ROLES.includes(newRole)) {
      throw new ForbiddenError(`The ${newRole} role cannot be assigned to a user.`);
    }

    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    // Last-admin guard when demoting an admin (FR-04.7). newRole can no longer be
    // HOSPITAL_ADMIN (blocked above), so any role change on an admin is a demotion.
    if (user.role === UserRole.HOSPITAL_ADMIN) {
      const activeAdminCount = await userRepository.countActiveAdmins(tenantId);
      if (activeAdminCount <= 1) {
        throw new ConflictError(
          'Cannot change role of the last active Hospital Admin. Assign another admin first.',
        );
      }
    }

    // Doctor role-change restriction: a doctor with active (non-terminal)
    // assigned encounters cannot leave the DOCTOR role — their workload must
    // be reassigned first. Applies even to inactive doctors (fail-closed: the
    // encounters are real workload regardless of login state). Changing INTO
    // DOCTOR is never blocked (a non-doctor has no doctor-encounters by
    // definition; the helper returns null for them).
    //
    // Historical data integrity: this is the ONLY mutation updateUserRole
    // makes, and it touches User.role alone. Completed visits'/discharged
    // admissions' doctorIds / assignedDoctorIds are never rewritten, users are
    // never hard-deleted (deactivation only flips isActive, and read-time name
    // resolution via findNamesByIds matches on _id for any role), and doctor
    // names are never denormalized onto encounter documents — so past records
    // and their audit trail stay intact after any legitimate role change.
    const activeLoad = await this.resolveDoctorActiveLoad(tenantId, user);
    if (activeLoad && activeLoad.total > 0) {
      throw new ConflictError(
        `Cannot change role: ${user.name} still has ${activeLoad.total} active patient(s). ` +
        'Reassign them first, then retry.',
        {
          code:           'DOCTOR_ACTIVE_PATIENTS',
          activePatients: activeLoad.total,
          breakdown:      { opd: activeLoad.opd, ipd: activeLoad.ipd },
          userId,
          currentRole:    user.role,
          requestedRole:  newRole,
        },
      );
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

  async updateMyOwnProfile(
    tenantId: string,
    userId: string,
    data: UpdateMyProfileRequest,
    requestedBy: string,
  ): Promise<IUser> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    const previous: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    if (data.name !== undefined && data.name !== user.name) { previous.name = user.name; next.name = data.name; }
    if (data.phone !== undefined && data.phone !== user.phone) { previous.phone = user.phone; next.phone = data.phone; }

    const updated = await userRepository.updateMyProfile(tenantId, userId, data);
    if (!updated) throw new NotFoundError('User not found');

    if (Object.keys(next).length > 0) {
      await auditService.log({
        entityType:    AuditEntityType.USER_ACCOUNT,
        entityId:      userId,
        action:        'UPDATE',
        userId:        requestedBy,
        tenantId,
        previousValue: previous,
        newValue:      next,
      });
    }

    return updated;
  }

  async uploadProfileImage(
    tenantId: string,
    userId: string,
    buffer: Buffer,
    mimeType: string,
    ext: string,
    requestedBy: string,
  ): Promise<IUser> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    // profileImageUrl stores the S3 key (not a presigned URL); presigned URLs are
    // generated at query time so they never expire in the DB.
    const oldKey = user.profileImageUrl ?? null;

    const key = `profile-images/${tenantId}/${userId}.${ext}`;
    await s3Service.uploadFile(key, buffer, mimeType);

    // Delete the old object only if the key actually changed (different extension)
    if (oldKey && oldKey !== key) {
      await s3Service.deleteFile(oldKey).catch(() => {/* orphan cleanup — non-fatal */});
    }

    // Persist the key, not the URL
    const updated = await userRepository.updateMyProfile(tenantId, userId, { profileImageUrl: key });
    if (!updated) throw new NotFoundError('User not found');

    await auditService.log({
      entityType: AuditEntityType.USER_ACCOUNT,
      entityId:   userId,
      action:     'UPDATE',
      userId:     requestedBy,
      tenantId,
      newValue:   { field: 'profileImageUrl', changed: true },
    });

    return updated;
  }

  async changeMyPassword(
    tenantId: string,
    userId: string,
    data: ChangeMyPasswordRequest,
    currentToken: string,
  ): Promise<void> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    const isValid = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!isValid) throw new UnauthorizedError('Current password is incorrect');

    const isSame = await bcrypt.compare(data.newPassword, user.passwordHash);
    if (isSame) throw new ValidationError('New password must be different from the current password');

    const newHash = await bcrypt.hash(data.newPassword, config.bcryptRounds);
    await userRepository.updatePassword(tenantId, userId, newHash);

    // Invalidate current session token
    try {
      const decoded = jwt.verify(currentToken, config.jwtSecret) as JWTPayload;
      const expiryMs = ((decoded.exp ?? 0) * 1000) - Date.now();
      if (expiryMs > 0) addToDenylist(currentToken, expiryMs);
    } catch { /* already invalid — no-op */ }

    await auditService.log({
      entityType: AuditEntityType.USER_ACCOUNT,
      entityId:   userId,
      action:     'UPDATE',
      userId,
      tenantId,
      newValue:   { field: 'password', changed: true },
    });
  }

  async updateUserProfile(
    tenantId: string,
    userId: string,
    data: UpdateProfileRequest,
    requestedBy: string,
  ): Promise<IUser> {
    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    if (data.email && data.email.toLowerCase() !== user.email) {
      const conflict = await userRepository.findByEmail(tenantId, data.email);
      if (conflict) throw new ConflictError('A user with this email already exists in this tenant');
    }

    const updated = await userRepository.updateProfile(tenantId, userId, data);
    if (!updated) throw new NotFoundError('User not found');

    await auditService.log({
      entityType:    AuditEntityType.USER_ACCOUNT,
      entityId:      userId,
      action:        'UPDATE',
      userId:        requestedBy,
      tenantId,
      previousValue: { name: user.name, email: user.email },
      newValue:      data as Record<string, unknown>,
    });

    return updated;
  }
}

export const userService = new UserService();
