import { v4 as uuidv4 } from 'uuid';
import { AuditLogModel, IAuditLog } from './audit.model';
import { AuditLogEntry, PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { AuditQueryFilters } from './audit.types';

export class AuditRepository {
  async save(entry: AuditLogEntry): Promise<IAuditLog> {
    assertDbConnected();
    return AuditLogModel.create({
      auditId:       uuidv4(),
      entityType:    entry.entityType,
      entityId:      entry.entityId,
      action:        entry.action,
      userId:        entry.userId,
      tenantId:      entry.tenantId,
      previousValue: entry.previousValue,
      newValue:      entry.newValue,
      timestamp:     entry.timestamp ?? new Date(),
    });
  }

  async query(
    tenantId: string | null,
    filters: AuditQueryFilters,
  ): Promise<PaginatedResult<IAuditLog>> {
    assertDbConnected();
    const { entityType, entityId, userId, dateFrom, dateTo, page = 1, limit = 50 } = filters;

    const match: Record<string, unknown> = {};
    if (tenantId !== null)    match['tenantId']   = tenantId;
    if (entityType)           match['entityType'] = entityType;
    if (entityId)             match['entityId']   = entityId;
    if (userId)               match['userId']     = userId;
    if (dateFrom || dateTo) {
      match['timestamp'] = {
        ...(dateFrom ? { $gte: dateFrom } : {}),
        ...(dateTo   ? { $lte: dateTo }   : {}),
      };
    }

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      AuditLogModel.find(match).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      AuditLogModel.countDocuments(match),
    ]);
    return {
      data:       data as IAuditLog[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

export const auditRepository = new AuditRepository();
