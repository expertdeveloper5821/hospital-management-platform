import mongoose, { Schema, Document } from 'mongoose';

export interface IStaffIdCard extends Document {
  tenantId:  string;
  userId:    string;
  s3Key:     string;
  issuedAt:  Date;
  expiresAt: Date;
  // SHA-256 hex of the QR verification token. The raw token is never stored;
  // it exists only inside the issued PDF. Null on cards issued before QR
  // verification existed (those cards carry no QR and never verify).
  verificationTokenHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const StaffIdCardSchema = new Schema<IStaffIdCard>(
  {
    tenantId:  { type: String, required: true },
    userId:    { type: String, required: true },
    s3Key:     { type: String, required: true },
    issuedAt:  { type: Date,   required: true },
    expiresAt: { type: Date,   required: true },
    // select: false — never loaded unless a query explicitly asks for it.
    verificationTokenHash: { type: String, default: null, select: false },
  },
  { timestamps: true, collection: 'staff_id_cards' },
);

StaffIdCardSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
// Global (not tenant-prefixed) on purpose: the public verification lookup is
// token-only. Partial so legacy rows with a null hash don't collide.
StaffIdCardSchema.index(
  { verificationTokenHash: 1 },
  { unique: true, partialFilterExpression: { verificationTokenHash: { $type: 'string' } } },
);

export const StaffIdCardModel = mongoose.model<IStaffIdCard>('StaffIdCard', StaffIdCardSchema);
