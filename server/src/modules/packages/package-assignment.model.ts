import mongoose, { Schema, Document } from 'mongoose';

export type AssignmentStatus = 'ACTIVE' | 'CANCELLED';

export interface IPackageAssignment extends Document {
  assignmentId: string;
  tenantId:     string;
  packageId:    string;
  patientId:    string;
  assignedDate: Date;
  status:       AssignmentStatus;
  assignedBy:   string;
  cancelledAt:  Date | null;
  cancelledBy:  string | null;
  createdAt:    Date;
  updatedAt:    Date;
}

const PackageAssignmentSchema = new Schema<IPackageAssignment>(
  {
    assignmentId: { type: String, required: true },
    tenantId:     { type: String, required: true },
    packageId:    { type: String, required: true },
    patientId:    { type: String, required: true },
    assignedDate: { type: Date,   required: true },
    status:       { type: String, required: true, enum: ['ACTIVE', 'CANCELLED'], default: 'ACTIVE' },
    assignedBy:   { type: String, required: true },
    cancelledAt:  { type: Date,   default: null },
    cancelledBy:  { type: String, default: null },
  },
  { timestamps: true, collection: 'package_assignments' },
);

PackageAssignmentSchema.index({ tenantId: 1, assignmentId: 1 }, { unique: true });
PackageAssignmentSchema.index({ tenantId: 1, patientId: 1, assignedDate: -1 });
PackageAssignmentSchema.index({ tenantId: 1, patientId: 1, packageId: 1, status: 1 });

export const PackageAssignmentModel = mongoose.model<IPackageAssignment>('PackageAssignment', PackageAssignmentSchema);
