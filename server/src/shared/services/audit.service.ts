import { AuditLogEntry } from '../types/common.types';

// Full AuditService implementation (MongoDB write, 365-day TTL, failure alerting)
// is deferred to Unit 6. This stub writes to console.log only.

class AuditService {
  /**
   * Log an audit entry.
   * AUDIT-01: Async to match Unit 6 signature — no call-site changes needed.
   * AUDIT-04/05: Never throws — audit failures must never block primary operations (FR-14.5).
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      const record = {
        ...entry,
        timestamp: entry.timestamp ?? new Date(),
        // previousValue and newValue omitted from stub log to avoid PII exposure
        previousValue: undefined,
        newValue:      undefined,
      };

      console.log(JSON.stringify({
        level:      'info',
        event:      'audit_stub',
        entityType: record.entityType,
        entityId:   record.entityId,
        action:     record.action,
        userId:     record.userId,
        tenantId:   record.tenantId,
        timestamp:  record.timestamp,
      }));
    } catch (err) {
      // AUDIT-05: Swallow all errors — audit must never block primary operation
      console.error(JSON.stringify({
        level:   'error',
        event:   'audit_stub_error',
        message: (err as Error).message,
      }));
    }
  }
}

export const auditService = new AuditService();
