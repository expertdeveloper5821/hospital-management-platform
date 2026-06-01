import { AuditLogEntry, PaginatedResult } from '../types/common.types';
import { auditService as moduleAuditService } from '../../modules/audit/audit.service';
import { IAuditLog } from '../../modules/audit/audit.model';
import { AuditQueryFilters } from '../../modules/audit/audit.types';

// Thin facade — all call-sites use this singleton; implementation lives in the audit module.
class AuditService {
  async log(entry: AuditLogEntry): Promise<void> {
    return moduleAuditService.log(entry);
  }

  async queryLogs(
    tenantId: string | null,
    filters:  AuditQueryFilters,
  ): Promise<PaginatedResult<IAuditLog>> {
    return moduleAuditService.queryLogs(tenantId, filters);
  }
}

export const auditService = new AuditService();
