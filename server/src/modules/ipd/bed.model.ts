import mongoose, { Schema, Document } from 'mongoose';

export interface IBed extends Document {
  tenantId:           string;
  wardId:             string;
  bedNumber:          string;
  isOccupied:         boolean;
  currentAdmissionId: string | null;
  // Soft delete — set by IPDService.deleteBed, or for every bed of a ward by
  // IPDService.deleteWard. Admissions keep their own bedId/bedNumber copy.
  isDeleted:          boolean;
  deletedAt:          Date | null;
  deletedBy:          string | null;
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
    isDeleted:          { type: Boolean, default: false },
    deletedAt:          { type: Date,    default: null },
    deletedBy:          { type: String,  default: null },
  },
  { timestamps: true, collection: 'beds' },
);

// tenantId first on all compound indexes (NFR-01)
// Bed number is unique per ward among non-deleted beds only (see
// `npm run migrate:ward-bed-soft-delete` for production).
BedSchema.index(
  { tenantId: 1, wardId: 1, bedNumber: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'uniq_active_bed_number_per_ward' },
);
BedSchema.index({ tenantId: 1, wardId: 1, isOccupied: 1 });

export const BedModel = mongoose.model<IBed>('Bed', BedSchema);
