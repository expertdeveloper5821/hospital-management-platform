import { AuditLogEntry, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { auditRepository } from './audit.repository';
import { IAuditLog } from './audit.model';
import { AuditQueryFilters } from './audit.types';

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

  // U6-C-03: queryLogs — paginated, multi-filter query
  async queryLogs(
    tenantId: string | null,
    filters: AuditQueryFilters,
  ): Promise<PaginatedResult<IAuditLog>> {
    return auditRepository.query(tenantId, filters);
  }
}

export const auditService = new AuditService();
