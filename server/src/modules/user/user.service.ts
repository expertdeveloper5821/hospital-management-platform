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
import { labRepository } from '../lab/lab.repository';
import { paymentRepository } from '../payment/payment.repository';
import { PaymentReferenceType } from '../payment/payment.types';
import { attendanceRepository } from '../attendance/attendance.repository';
import { notificationService } from '../notification/notification.service';
import { pushToUser } from '../../shared/services/websocket.service';
import { getFrontendBaseUrl } from '../../shared/utils/frontend-url';

// Roles that must never be created or assigned through tenant user-management.
// SUPER_ADMIN would escalate privileges outside tenant scope; HOSPITAL_ADMIN is
// provisioned only through tenant onboarding.
const NON_ASSIGNABLE_ROLES: readonly UserRole[] = [UserRole.SUPER_ADMIN, UserRole.HOSPITAL_ADMIN];

/**
 * Canonical stored form of a UKMC registration number: trimmed, uppercased,
 * separator runs (spaces / hyphens) collapsed to a single space. Mirrors the
 * client-side normalisation and the controller's ukmcNoSchema transform.
 */
function normaliseUkmcNo(value: string): string {
  return value.trim().toUpperCase().replace(/\s+|-{2,}/g, ' ');
}

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

    // UKMC No. is a doctor-only attribute and mandatory for DOCTOR.
    if (data.role === UserRole.DOCTOR && (!data.ukmcNo || !data.ukmcNo.trim().replace(/\s+|-{2,}/g, ' '))) {
      throw new ValidationError('UKMC No. is required when the user\u2019s role is DOCTOR', {
        code: 'UKMC_REQUIRED',
      });
    }

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
      // UKMC No. is a doctor-only attribute: store it for DOCTOR (normalise
      // empty/zwhitespace-passthrough to null), clear it for everyone else.
      // Canonical form: trimmed, uppercased, separator runs collapsed to a
      // single space (mirrors the controller's ukmcNoSchema transform).
      ukmcNo:       data.role === UserRole.DOCTOR && data.ukmcNo?.trim()
        ? normaliseUkmcNo(data.ukmcNo)
        : null,
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
        await this.logRoleChangeConflict(tenantId, userId, user.role, null, requestedBy, 'LAST_ADMIN_CONFLICT');
        throw new ConflictError(
          'Cannot deactivate the last active Hospital Admin. Assign another admin first.',
          { code: 'LAST_ADMIN_CONFLICT', userId, currentRole: user.role },
        );
      }
    }

    // Ward-roster origin guard (§4.2.1 of the role-permission API governance
    // reference): a nurse still on any live ward's roster is on IPD duty —
    // remove them from the roster first, then deactivate. Only active
    // (non-deleted) wards count; a deleted ward's roster is historical.
    if (user.role === UserRole.NURSE) {
      const activeWardIds = await ipdRepository.findWardIdsByNurse(tenantId, userId, { activeOnly: true });
      if (activeWardIds.length > 0) {
        await this.logRoleChangeConflict(tenantId, userId, user.role, null, requestedBy, 'WARD_ROSTER_CONFLICT');
        throw new ConflictError(
          `Cannot deactivate: ${user.name} is still on the roster of ${activeWardIds.length} active ward(s). ` +
          'Remove them from the ward roster first, then retry.',
          { code: 'WARD_ROSTER_CONFLICT', activeWards: activeWardIds.length, userId },
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

  /**
   * §4.4 (role-permission API governance): every rejected role-change or
   * deactivation attempt is audited with the stable conflict code, the
   * previous and requested roles, the target user, the tenant and the caller
   * — identity fields (names, emails) stay out of audit values. Roles are
   * non-sensitive; counts and ids are the only payload. `currentRole` and
   * `requestedRole` are null when the guard fires before the target user is
   * loaded, or when the rejected operation is a deactivation (no role
   * requested).
   */
  private async logRoleChangeConflict(
    tenantId:      string,
    targetUserId:  string,
    currentRole:   UserRole | null,
    requestedRole: UserRole | null,
    requestedBy:   string,
    conflictCode:  string,
  ): Promise<void> {
    await auditService.log({
      entityType:    AuditEntityType.USER_ACCOUNT,
      entityId:      targetUserId,
      action:        'ROLE_CHANGE_BLOCKED',
      userId:        requestedBy,
      tenantId,
      previousValue: { role: currentRole },
      newValue:      { requestedRole, conflictCode },
    });
  }

  /**
   * Role-specific pre-flight guards (§4.2 of the role-permission API
   * governance reference): a user carrying live work in their current role
   * cannot leave it until that work is handed over or finalized — the same
   * principle as DOCTOR_ACTIVE_PATIENTS above. Every rejection is a 409 with
   * a stable code and a data-driven payload (ids and counts only — no
   * PHI/PII). Guards fire on the CURRENT role only; changing INTO any of
   * these roles is never blocked (a fresh holder has no active work in it by
   * definition).
   *
   * RECEPTIONIST is deliberately absent: §4.2.4's pending-registration /
   * pending-OPD-visit signals live in the client-side offline outbox
   * (client/lib/offline), which the backend cannot observe, and neither
   * Patient nor OPDVisit records who created them. Ground rule §1.3(2)
   * ("Forbidden is a state, not a guess") forbids blocking on a guessed
   * proxy, so no server-side check exists for it today.
   */
  private async assertNoRoleSpecificActiveWork(
    tenantId:    string,
    user:        IUser,
    newRole:     UserRole,
    requestedBy: string,
  ): Promise<void> {
    const userId       = user._id.toString();
    const conflictBase = { userId, currentRole: user.role, requestedRole: newRole };

    switch (user.role) {
      case UserRole.NURSE: {
        // Active duty = personally assigned OPD queue rows (visit.nurseIds) +
        // in-treatment patients on wards whose roster still lists the nurse
        // (Ward.assignedNurseIds is the source of truth for IPD duty).
        const [activeOpdVisits, activeWardIds] = await Promise.all([
          opdRepository.countActiveVisitsByNurse(tenantId, userId),
          ipdRepository.findWardIdsByNurse(tenantId, userId, { activeOnly: true }),
        ]);
        const activeIpdAdmissions = await ipdRepository.countActiveAdmissionsByWards(tenantId, activeWardIds);
        if (activeOpdVisits + activeIpdAdmissions > 0) {
          await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, 'NURSE_ACTIVE_ENTRIES');
          throw new ConflictError(
            `Cannot change role: ${user.name} still has ${activeOpdVisits} active OPD visit(s) and ` +
            `${activeIpdAdmissions} active IPD admission(s). Take them off duty first, then retry.`,
            {
              code:          'NURSE_ACTIVE_ENTRIES',
              activeEntries: activeOpdVisits + activeIpdAdmissions,
              breakdown:     { opd: activeOpdVisits, ipd: activeIpdAdmissions },
              ...conflictBase,
            },
          );
        }
        return;
      }

      case UserRole.PATHOLOGIST:
      case UserRole.RADIOLOGIST: {
        // Active authored work = PENDING/IN_PROGRESS lab requests of this
        // user's own request type (requestedBy). An open request may also
        // still be unpaid — surfaced as a flag so the UI can point at
        // collection (§4.2.2's response shape).
        const isPathology = user.role === UserRole.PATHOLOGIST;
        const requestIds = isPathology
          ? await labRepository.findActivePathologyIdsByRequester(tenantId, userId)
          : await labRepository.findActiveRadiologyIdsByRequester(tenantId, userId);
        if (requestIds.length > 0) {
          const referenceType = isPathology
            ? PaymentReferenceType.PATHOLOGY_REQUEST
            : PaymentReferenceType.RADIOLOGY_REQUEST;
          const completed = await paymentRepository.findCompletedByReferences(tenantId, referenceType, requestIds);
          const paidReferenceIds = new Set(
            completed.map((p) => p.referenceId).filter((id): id is string => id !== null),
          );
          const unpaidPayment = requestIds.some((id) => !paidReferenceIds.has(id));
          const code = isPathology ? 'PATHOLOGY_ACTIVE_REQUEST' : 'RADIOLOGY_ACTIVE_REQUEST';
          await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, code);
          throw new ConflictError(
            `Cannot change role: ${user.name} still has ${requestIds.length} active ` +
            `${isPathology ? 'pathology' : 'radiology'} request(s). Finalize or hand them over first, then retry.`,
            { code, activeRequests: requestIds.length, unpaidPayment, ...conflictBase },
          );
        }
        return;
      }

      case UserRole.MANAGER:
      case UserRole.FINANCE_MANAGER: {
        // Open (PENDING) payments this user recorded are unfinished finance
        // work (§4.2.3): settle or cancel them before the role moves.
        // COMPLETED is the settled state; FAILED/CANCELLED are terminal and
        // never block.
        const openPayments = await paymentRepository.countOpenPaymentsByCreator(tenantId, userId);
        if (openPayments > 0) {
          const code = user.role === UserRole.MANAGER ? 'FINANCE_UNRECONCILED' : 'OPEN_PAYMENT_LEASE';
          await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, code);
          throw new ConflictError(
            `Cannot change role: ${user.name} still has ${openPayments} open payment(s) awaiting reconciliation. ` +
            'Reconcile them first, then retry.',
            { code, openPayments, ...conflictBase },
          );
        }
        return;
      }

      case UserRole.STAFF: {
        // An unfinalized attendance shift (checked in, never checked out) must
        // be closed — by check-out or admin correction — before the role
        // moves. Any day's dangling check-in counts, not just today's.
        const openSession = await attendanceRepository.findOpenSession(tenantId, userId);
        if (openSession) {
          await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, 'STAFF_ACTIVE_SESSION');
          throw new ConflictError(
            `Cannot change role: ${user.name} has an open attendance session. Finalize it first, then retry.`,
            { code: 'STAFF_ACTIVE_SESSION', attendanceId: openSession.attendanceId, ...conflictBase },
          );
        }
        return;
      }

      default:
        return;
    }
  }

  async updateUserRole(
    tenantId: string,
    userId: string,
    newRole: UserRole,
    requestedBy: string,
  ): Promise<void> {
    // A user cannot change their own role.
    if (userId === requestedBy) {
      await this.logRoleChangeConflict(tenantId, userId, null, newRole, requestedBy, 'SELF_ROLE_CHANGE');
      throw new ForbiddenError('You cannot change your own role.');
    }
    // SUPER_ADMIN / HOSPITAL_ADMIN cannot be assigned to any user (privilege
    // escalation / onboarding-only).
    if (NON_ASSIGNABLE_ROLES.includes(newRole)) {
      await this.logRoleChangeConflict(tenantId, userId, null, newRole, requestedBy, 'ROLE_NOT_ASSIGNABLE');
      throw new ForbiddenError(`The ${newRole} role cannot be assigned to a user.`);
    }

    const user = await userRepository.findById(tenantId, userId);
    if (!user) throw new NotFoundError('User not found');

    // Inactive users fail closed (§4.1 #6 of the governance reference): a
    // role change on a deactivated account would silently hand the new
    // role's permissions to whoever reactivates it later — force the explicit
    // activation step first so the audit trail shows an intentional
    // reactivation followed by the role move. (This is why an inactive doctor
    // with active encounters surfaces USER_INACTIVE rather than
    // DOCTOR_ACTIVE_PATIENTS — both are fail-closed; reactivate first, then
    // the workload guard still applies.)
    if (!user.isActive) {
      await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, 'USER_INACTIVE');
      throw new ConflictError(
        'Cannot change the role of an inactive user. Reactivate them first, then retry.',
        { code: 'USER_INACTIVE', userId, currentRole: user.role, requestedRole: newRole },
      );
    }

    // Last-admin guard when demoting an admin (FR-04.7). newRole can no longer be
    // HOSPITAL_ADMIN (blocked above), so any role change on an admin is a demotion.
    if (user.role === UserRole.HOSPITAL_ADMIN) {
      const activeAdminCount = await userRepository.countActiveAdmins(tenantId);
      if (activeAdminCount <= 1) {
        await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, 'LAST_ADMIN_CONFLICT');
        throw new ConflictError(
          'Cannot change role of the last active Hospital Admin. Assign another admin first.',
          { code: 'LAST_ADMIN_CONFLICT', userId, currentRole: user.role, requestedRole: newRole },
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
      await this.logRoleChangeConflict(tenantId, userId, user.role, newRole, requestedBy, 'DOCTOR_ACTIVE_PATIENTS');
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

    // Role-specific active-work guards (§4.2) — nurse duty, lab requests,
    // open payments, attendance sessions. See the helper for the per-role
    // rules and the deliberate RECEPTIONIST omission.
    await this.assertNoRoleSpecificActiveWork(tenantId, user, newRole, requestedBy);

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

    // Re-auth signal (§4.4 / §5.3): the user's existing JWT keeps carrying
    // the OLD role until it expires, so any live session for this user must
    // end now — the frontend clears auth state + the RTK Query cache and
    // forces /login?relogin=1&rolesChanged=1 when the 'role_changed' frame
    // arrives (client/lib/websocket-client.ts). pushToUser is a no-op when
    // the user is offline; the persisted notification covers that case on
    // next login. Best-effort: a notification failure never rolls back the
    // role change.
    try {
      await notificationService.sendNotification(
        userId,
        tenantId,
        'Your role was changed',
        `Your account role was changed to ${newRole} by an administrator. Please sign in again.`,
        'USER_ACCOUNT',
        userId,
      );
    } catch { /* best-effort — non-fatal */ }
    pushToUser(userId, {
      type: 'role_changed',
      data: { relogin: true, rolesChanged: true, previousRole: user.role, newRole },
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

    // A user cannot change their own role (mirror of updateUserRole's guard,
    // checked here because the combined PATCH may include a role change).
    if (data.role !== undefined && data.role !== user.role) {
      if (userId === requestedBy) {
        await this.logRoleChangeConflict(tenantId, userId, user.role, data.role, requestedBy, 'SELF_ROLE_CHANGE');
        throw new ForbiddenError('You cannot change your own role.');
      }
      if (NON_ASSIGNABLE_ROLES.includes(data.role)) {
        await this.logRoleChangeConflict(tenantId, userId, user.role, data.role, requestedBy, 'ROLE_NOT_ASSIGNABLE');
        throw new ForbiddenError(`The ${data.role} role cannot be assigned to a user.`);
      }
      if (!user.isActive) {
        await this.logRoleChangeConflict(tenantId, userId, user.role, data.role, requestedBy, 'USER_INACTIVE');
        throw new ConflictError(
          'Cannot change the role of an inactive user. Reactivate them first, then retry.',
          { code: 'USER_INACTIVE', userId, currentRole: user.role, requestedRole: data.role },
        );
      }
    }

    // Resolve the role AFTER any role change in this same request so the
    // ukmcNo consistency rule applies to the final shape.
    const resolvedRole = data.role ?? user.role;

    if (data.role !== undefined && data.role !== user.role) {
      // updateUserRole carries the full conflict-guard suite (last-admin,
      // doctor active patients, nurse duty, etc.), the audit entry with the
      // role-change conflict bookkeeping, and the re-login websocket signal.
      await this.updateUserRole(tenantId, userId, data.role, requestedBy);
    }

    if (data.email && data.email.toLowerCase() !== user.email) {
      const conflict = await userRepository.findByEmail(tenantId, data.email);
      if (conflict) throw new ConflictError('A user with this email already exists in this tenant');
    }

    // ukmcNo↔role consistency: a DOCTOR must have a UKMC No.; any non-doctor
    // gets the field cleared regardless of what was sent. When the role is
    // unchanged and no ukmcNo was sent, no candidate is required and the
    // stored value is left alone.
    const update: UpdateProfileRequest = { ...data, name: data.name ?? undefined, email: data.email ?? undefined };
    delete (update as { role?: UserRole }).role; // role already applied via updateUserRole
    if (resolvedRole === UserRole.DOCTOR) {
      // Candidate value: what was sent wins; otherwise the stored value when
      // the role is unchanged, or nothing when the role is newly DOCTOR.
      const candidate = update.ukmcNo !== undefined
        ? update.ukmcNo
        : (data.role !== undefined && data.role !== user.role ? null : user.ukmcNo);
      if (!candidate || (typeof candidate === 'string' && !candidate.trim().replace(/\s+|-{2,}/g, ' '))) {
        throw new ValidationError('UKMC No. is required when the user\u2019s role is DOCTOR', {
          code: 'UKMC_REQUIRED',
        });
      }
      // Canonical form: trimmed, uppercased, separator runs collapsed (same
      // normalisation as createUser).
      update.ukmcNo = normaliseUkmcNo(candidate as string);
    } else {
      update.ukmcNo = null;
    }

    const updated = await userRepository.updateProfile(tenantId, userId, update);
    if (!updated) throw new NotFoundError('User not found');

    const changedProfile =
      (update.name !== undefined && update.name !== user.name) ||
      (update.email !== undefined && update.email.toLowerCase() !== user.email) ||
      (update.ukmcNo !== undefined && update.ukmcNo !== user.ukmcNo) ||
      update.departmentIds !== undefined;
    if (changedProfile) {
      await auditService.log({
        entityType:    AuditEntityType.USER_ACCOUNT,
        entityId:      userId,
        action:        'UPDATE',
        userId:        requestedBy,
        tenantId,
        previousValue: { name: user.name, email: user.email, ukmcNo: user.ukmcNo },
        newValue:      data as Record<string, unknown>,
      });
    }

    return updated;
  }
}

export const userService = new UserService();
