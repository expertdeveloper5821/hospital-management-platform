import mongoose, { Schema, Document } from 'mongoose';

export interface IWard extends Document {
  tenantId:         string;
  name:             string;
  floor:            string | null;
  assignedNurseIds: string[];
  createdAt:        Date;
  updatedAt:        Date;
}

const WardSchema = new Schema<IWard>(
  {
    tenantId:         { type: String,   required: true, index: true },
    name:             { type: String,   required: true, trim: true },
    floor:            { type: String,   default: null,  trim: true },
    assignedNurseIds: { type: [String], default: [] },
  },
  { timestamps: true, collection: 'wards' },
);

WardSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const WardModel = mongoose.model<IWard>('Ward', WardSchema);
