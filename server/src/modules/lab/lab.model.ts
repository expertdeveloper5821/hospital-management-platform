import mongoose, { Schema, Document } from 'mongoose';
import { LabRequestStatus } from './lab.types';

// ─── PathologyRequest ─────────────────────────────────────────────────────────
export interface IPathologyRequest extends Document {
  requestId:   string;
  patientId:   string;
  name?:       string;
  tenantId:    string;
  requestedBy: string;
  testType:    string;
  status:      LabRequestStatus;
  notes:       string | null;
  reportS3Key: string | null;
  requestedAt: Date;
  createdAt:   Date;
  updatedAt:   Date;
}

const pathologyRequestSchema = new Schema<IPathologyRequest>(
  {
    requestId:   { type: String, required: true, unique: true },
    patientId:   { type: String, required: true },
    tenantId:    { type: String, required: true },
    requestedBy: { type: String, required: true },
    testType:    { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type:     String,
      enum:     Object.values(LabRequestStatus),
      default:  LabRequestStatus.PENDING,
      required: true,
    },
    notes:       { type: String, default: null, trim: true, maxlength: 2000 },
    reportS3Key: { type: String, default: null },
    requestedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'pathology_requests',
  },
);

// tenantId first (NFR-01)
pathologyRequestSchema.index({ tenantId: 1, status: 1 });
pathologyRequestSchema.index({ tenantId: 1, patientId: 1 });

export const PathologyRequestModel = mongoose.model<IPathologyRequest>(
  'PathologyRequest',
  pathologyRequestSchema,
);

// ─── RadiologyRequest ─────────────────────────────────────────────────────────
export interface IRadiologyRequest extends Document {
  requestId:   string;
  patientId:   string;
  tenantId:    string;
  requestedBy: string;
  imagingType: string;
  status:      LabRequestStatus;
  notes:       string | null;
  reportS3Key: string | null;
  requestedAt: Date;
  createdAt:   Date;
  updatedAt:   Date;
}

const radiologyRequestSchema = new Schema<IRadiologyRequest>(
  {
    requestId:   { type: String, required: true, unique: true },
    patientId:   { type: String, required: true },
    tenantId:    { type: String, required: true },
    requestedBy: { type: String, required: true },
    imagingType: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type:     String,
      enum:     Object.values(LabRequestStatus),
      default:  LabRequestStatus.PENDING,
      required: true,
    },
    notes:       { type: String, default: null, trim: true, maxlength: 2000 },
    reportS3Key: { type: String, default: null },
    requestedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'radiology_requests',
  },
);

radiologyRequestSchema.index({ tenantId: 1, status: 1 });
radiologyRequestSchema.index({ tenantId: 1, patientId: 1 });

export const RadiologyRequestModel = mongoose.model<IRadiologyRequest>(
  'RadiologyRequest',
  radiologyRequestSchema,
);
