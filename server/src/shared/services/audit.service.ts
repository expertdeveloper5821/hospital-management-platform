import { AuditLogEntry } from '../types/common.types';
import { auditService as moduleAuditService } from '../../modules/audit/audit.service';

// Thin facade — all call-sites use this singleton; implementation lives in the audit module.
class AuditService {
  async log(entry: AuditLogEntry): Promise<void> {
    return moduleAuditService.log(entry);
  }
}

export const auditService = new AuditService();
