import mongoose, { Schema, Document } from 'mongoose';

// One row per tenant holding the last UHID sequence number issued to that
// hospital. Incremented atomically with `$inc` (see
// PatientRepository.nextUhidSequence) so concurrent registrations can never
// receive the same number.
export interface IPatientUhidCounter extends Document {
  tenantId:  string;
  seq:       number;
  createdAt: Date;
  updatedAt: Date;
}

const PatientUhidCounterSchema = new Schema<IPatientUhidCounter>(
  {
    tenantId: { type: String, required: true, unique: true },
    seq:      { type: Number, required: true, default: 0 },
  },
  { timestamps: true, collection: 'patient_uhid_counters' },
);

export const PatientUhidCounterModel = mongoose.model<IPatientUhidCounter>(
  'PatientUhidCounter',
  PatientUhidCounterSchema,
);
