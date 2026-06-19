import mongoose, { Schema, Document } from 'mongoose';

export type PackageStatus = 'ACTIVE' | 'INACTIVE';

export interface IPackage extends Document {
  packageId:        string;
  tenantId:         string;
  name:             string;
  description:      string | null;
  price:            number;
  includedServices: string[];
  status:           PackageStatus;
  isDeleted:        boolean;
  createdAt:        Date;
  updatedAt:        Date;
}

const PackageSchema = new Schema<IPackage>(
  {
    packageId:        { type: String, required: true },
    tenantId:         { type: String, required: true },
    name:             { type: String, required: true, trim: true, maxlength: 200 },
    description:      { type: String, default: null, maxlength: 500 },
    price:            { type: Number, required: true, min: 0 },
    includedServices: [{ type: String }],
    status:           { type: String, required: true, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted:        { type: Boolean, default: false },
  },
  { timestamps: true, collection: 'packages' },
);

PackageSchema.index({ tenantId: 1, packageId: 1 }, { unique: true });
PackageSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
PackageSchema.index({ tenantId: 1, name: 1 });

export const PackageModel = mongoose.model<IPackage>('Package', PackageSchema);
