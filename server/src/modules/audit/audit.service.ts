import mongoose from 'mongoose';
import { AuditLogEntry, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { auditRepository } from './audit.repository';
import { IAuditLog } from './audit.model';
import { AuditQueryFilters } from './audit.types';
import { UserModel } from '../user/user.model';

export class AuditService {
  // U6-C-03: Full log() — writes to MongoDB. Never throws (FR-14.5).
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await auditRepository.save(entry);
    } catch (err) {
      // U6-C-05: Audit failure must never block primary operations
      console.error(JSON.stringify({
        level:      'error',
        event:      'audit_write_failed',
        entityType: entry.entityType,
        entityId:   entry.entityId,
        action:     entry.action,
        userId:     entry.userId,
        tenantId:   entry.tenantId,
        message:    (err as Error).message,
        timestamp:  new Date().toISOString(),
      }));
      // Alert Super Admin via best-effort notification (imported lazily to avoid circular deps)
      this.alertSuperAdminOnFailure(entry, err as Error).catch(() => { /* non-blocking */ });
    }
  }

  private async alertSuperAdminOnFailure(entry: AuditLogEntry, err: Error): Promise<void> {
    try {
      const { notificationService } = await import('../notification/notification.service');
      await notificationService.sendToRole(
        UserRole.SUPER_ADMIN,
        entry.tenantId ?? 'system',
        'Audit Log Write Failure',
        `Failed to write audit log: ${entry.action} on ${entry.entityType}/${entry.entityId}. Error: ${err.message}`,
        entry.entityType,
        entry.entityId,
      );
    } catch {
      // Ignore — alert failure must never cascade
    }
  }

  // U6-C-03: queryLogs — paginated, multi-filter query with user name/role resolution
  async queryLogs(
    tenantId: string | null,
    filters: AuditQueryFilters,
  ): Promise<PaginatedResult<IAuditLog & { userName?: string; userRole?: string }>> {
    const result = await auditRepository.query(tenantId, filters);

    // Resolve unique userIds → names/roles in one query (userId in audit = user _id string).
    // "Who made the change" is always this resolved-from-userId identity —
    // userId itself is stamped server-side from the authenticated session at
    // write time (see e.g. OPDController's updateVisit/completeVisit, which
    // pass req.user!.userId, never anything from the request body), so it can
    // never be spoofed via a client-supplied field, and a later offline sync
    // replaying the same request can never reattribute it to whoever happens
    // to trigger that sync — the entry's userId was fixed at write time.
    const userIds      = [...new Set(result.data.map((l) => l.userId).filter(Boolean))];
    const validUserIds = userIds.filter((id) => mongoose.isValidObjectId(id));
    const users        = validUserIds.length > 0
      ? await UserModel.find({ _id: { $in: validUserIds } }, { name: 1, email: 1, role: 1 }).lean()
      : [];
    const nameMap = new Map(users.map((u) => [u._id.toString(), u.name || u.email]));
    const roleMap = new Map(users.map((u) => [u._id.toString(), u.role as string | undefined]));

    return {
      ...result,
      data: result.data.map((log) => ({
        ...log,
        userName: nameMap.get(log.userId),
        userRole: roleMap.get(log.userId),
      })) as (IAuditLog & { userName?: string; userRole?: string })[],
    };
  }
}

export const auditService = new AuditService();
