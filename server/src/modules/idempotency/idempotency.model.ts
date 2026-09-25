import mongoose, { Schema, Document } from 'mongoose';

export interface IIdempotencyRecord extends Document {
  tenantId:       string;
  idempotencyKey: string;
  routeKey:       string;
  requestHash:    string;
  responseStatus: number;
  responseBody:   unknown;
  createdAt:      Date;
}

// Replayed sync requests only need to be deduplicated for as long as an
// offline device could plausibly retry them — 7 days comfortably covers even
// a long-offline front-desk device without keeping this collection forever.
const IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const IdempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    tenantId:       { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    routeKey:       { type: String, required: true },
    requestHash:    { type: String, required: true },
    responseStatus: { type: Number, required: true },
    responseBody:   { type: Schema.Types.Mixed, required: true },
    createdAt:      { type: Date, default: Date.now },
  },
  { collection: 'idempotency_records' },
);

// tenantId first (NFR-01)
IdempotencyRecordSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
IdempotencyRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: IDEMPOTENCY_TTL_SECONDS });

export const IdempotencyRecordModel = mongoose.model<IIdempotencyRecord>(
  'IdempotencyRecord',
  IdempotencyRecordSchema,
);
