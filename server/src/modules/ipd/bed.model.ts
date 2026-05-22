import mongoose, { Schema, Document } from 'mongoose';

export interface IBed extends Document {
  tenantId:           string;
  wardId:             string;
  bedNumber:          string;
  isOccupied:         boolean;
  currentAdmissionId: string | null;
  createdAt:          Date;
  updatedAt:          Date;
}

const BedSchema = new Schema<IBed>(
  {
    tenantId:           { type: String, required: true, index: true },
    wardId:             { type: String, required: true },
    bedNumber:          { type: String, required: true, trim: true },
    isOccupied:         { type: Boolean, default: false },
    currentAdmissionId: { type: String, default: null },
  },
  { timestamps: true, collection: 'beds' },
);

// tenantId first on all compound indexes (NFR-01)
BedSchema.index({ tenantId: 1, wardId: 1, bedNumber: 1 }, { unique: true });
BedSchema.index({ tenantId: 1, wardId: 1, isOccupied: 1 });

export const BedModel = mongoose.model<IBed>('Bed', BedSchema);
