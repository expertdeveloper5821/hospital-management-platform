import mongoose, { Schema, Document } from 'mongoose';

// Marks the two system departments seeded for every tenant (see
// DepartmentService.ensureVitalsDepartments). An OPD visit / IPD admission
// whose departmentId points at one of them records that department's vitals
// set; every other department (and none) uses the Non-Pediatric layout.
// Keyed by this marker rather than the department name, so a rename keeps
// the vitals behaviour.
export const VITALS_PROFILES = ['PEDIATRIC', 'NON_PEDIATRIC'] as const;
export type VitalsProfile = typeof VITALS_PROFILES[number];

export interface IDepartment extends Document {
  departmentId:  string;
  tenantId:      string;
  name:          string;
  description:   string | null;
  headDoctorId:  string | null;
  vitalsProfile: VitalsProfile | null;
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
    vitalsProfile: { type: String, enum: [...VITALS_PROFILES, null], default: null },
    isDeleted:    { type: Boolean, default: false },
    deletedAt:    { type: Date, default: null },
  },
  { timestamps: true, collection: 'departments' },
);

// tenantId first (NFR-01)
DepartmentSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
DepartmentSchema.index({ tenantId: 1, isDeleted: 1 });
// One department per vitals profile per tenant — soft-deleted rows keep their
// slot, so a department the hospital deleted is never silently re-seeded.
DepartmentSchema.index({ tenantId: 1, vitalsProfile: 1 }, { unique: true, partialFilterExpression: { vitalsProfile: { $type: 'string' } } });

export const DepartmentModel = mongoose.model<IDepartment>('Department', DepartmentSchema);
