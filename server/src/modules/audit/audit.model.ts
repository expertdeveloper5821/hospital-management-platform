import mongoose, { Schema, Document } from 'mongoose';
import { AuditEntityType, AuditAction } from '../../shared/types/common.types';

export interface IAuditLog extends Document {
  auditId:        string;
  entityType:     AuditEntityType;
  entityId:       string;
  action:         AuditAction;
  userId:         string;
  tenantId:       string | null;
  previousValue?: Record<string, unknown>;
  newValue?:      Record<string, unknown>;
  timestamp:      Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    auditId:       { type: String, required: true, unique: true },
    entityType:    { type: String, required: true },
    entityId:      { type: String, required: true },
    action:        { type: String, required: true },
    userId:        { type: String, required: true },
    tenantId:      { type: String, default: null },
    previousValue: { type: Schema.Types.Mixed },
    newValue:      { type: Schema.Types.Mixed },
    timestamp:     { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: false,
    collection: 'audit_logs',
  },
);

// 365-day TTL — append-only, auto-expiry (U6-C-01)
auditLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Query performance indexes — tenantId first (NFR-01)
auditLogSchema.index({ tenantId: 1, entityType: 1, timestamp: -1 });
auditLogSchema.index({ tenantId: 1, entityId: 1,   timestamp: -1 });
auditLogSchema.index({ tenantId: 1, userId: 1,     timestamp: -1 });

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
