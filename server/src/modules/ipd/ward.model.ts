import mongoose, { Schema, Document } from 'mongoose';

export interface IWard extends Document {
  tenantId:         string;
  name:             string;
  floor:            string | null;
  assignedNurseIds: string[];
  // Soft delete (Hospital Admin only — IPDService.deleteWard). A deleted ward

  // admissions, discharge summaries and nurse history scoping still resolve it.
  isDeleted:        boolean;
  deletedAt:        Date | null;
  deletedBy:        string | null;
  // Write-conflict guard, never read: every transaction that places an
  // admission or a bed in this ward ($inc) and the ward soft-delete both write
  // this document, so MongoDB serialises them (see ipd.repository.ts).
  lockVersion:      number;
  createdAt:        Date;
  updatedAt:        Date;
}

const WardSchema = new Schema<IWard>(
  {
    tenantId:         { type: String,   required: true, index: true },
    name:             { type: String,   required: true, trim: true },
    floor:            { type: String,   default: null,  trim: true },
    assignedNurseIds: { type: [String], default: [] },
    isDeleted:        { type: Boolean,  default: false },
    deletedAt:        { type: Date,     default: null },
    deletedBy:        { type: String,   default: null },
    lockVersion:      { type: Number,   default: 0 },
  },
  { timestamps: true, collection: 'wards' },
);

// Name is unique among non-deleted wards only, so a deleted ward's name can be
// reused. Production (autoIndex disabled) needs `npm run migrate:ward-bed-soft-delete`,
// which also drops the old non-partial `tenantId_1_name_1` index.
WardSchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'uniq_active_ward_name' },
);

export const WardModel = mongoose.model<IWard>('Ward', WardSchema);
