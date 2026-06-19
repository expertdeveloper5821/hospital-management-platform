import mongoose, { Schema, Document } from 'mongoose';

export interface IStaffIdCard extends Document {
  tenantId:  string;
  userId:    string;
  s3Key:     string;
  issuedAt:  Date;
  expiresAt: Date;
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
  },
  { timestamps: true, collection: 'staff_id_cards' },
);

StaffIdCardSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export const StaffIdCardModel = mongoose.model<IStaffIdCard>('StaffIdCard', StaffIdCardSchema);
