import mongoose, { Schema, Document } from 'mongoose';

// Persistent doctor→nurse mapping(s) for OPD duty — the "already assigned
// nurses" a doctor defaults to across visits, independent of any single
// visit's own nurseIds. A doctor can have multiple nurses (one row per
// (tenantId, doctorId, nurseId) pair); the unique index is on all three
// fields so upserting a doctor-nurse pair is idempotent — repeating the same
// pair never creates a duplicate row — while still allowing many different
// nurses to be mapped to the same doctor.
export interface IOpdNurseAssignment extends Document {
  tenantId:  string;
  doctorId:  string;
  nurseId:   string;
  createdAt: Date;
  updatedAt: Date;
}

const OpdNurseAssignmentSchema = new Schema<IOpdNurseAssignment>(
  {
    tenantId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true },
    nurseId:  { type: String, required: true },
  },
  { timestamps: true, collection: 'opd_nurse_assignments' },
);

// Lists every nurse mapped to a doctor.
OpdNurseAssignmentSchema.index({ tenantId: 1, doctorId: 1 });
// Prevents a duplicate row for the same doctor-nurse pair.
OpdNurseAssignmentSchema.index({ tenantId: 1, doctorId: 1, nurseId: 1 }, { unique: true });

export const OpdNurseAssignmentModel = mongoose.model<IOpdNurseAssignment>(
  'OpdNurseAssignment',
  OpdNurseAssignmentSchema,
);
