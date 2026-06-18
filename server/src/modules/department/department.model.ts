import mongoose, { Schema, Document } from 'mongoose';

export interface IDepartment extends Document {
  departmentId:  string;
  tenantId:      string;
  name:          string;
  description:   string | null;
  headDoctorId:  string | null;
  isDeleted:     boolean;
  deletedAt:     Date | null;
  createdAt:     Date;
  updatedAt:     Date;
}

const DepartmentSchema = new Schema<IDepartment>(
  {
    departmentId: { type: String, required: true, unique: true },
    tenantId:     { type: String, required: true, index: true },
    name:         { type: String, required: true, trim: true, maxlength: 200 },
    description:  { type: String, default: null, trim: true, maxlength: 1000 },
    headDoctorId: { type: String, default: null },
    isDeleted:    { type: Boolean, default: false },
    deletedAt:    { type: Date, default: null },
  },
  { timestamps: true, collection: 'departments' },
);

// tenantId first (NFR-01)
DepartmentSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
DepartmentSchema.index({ tenantId: 1, isDeleted: 1 });

export const DepartmentModel = mongoose.model<IDepartment>('Department', DepartmentSchema);
