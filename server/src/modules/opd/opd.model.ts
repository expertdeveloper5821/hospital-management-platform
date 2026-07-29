import mongoose, { Schema, Document } from 'mongoose';
import { OPDVisitStatus } from './opd.types';

export interface IOPDVisit extends Document {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string;
  doctorIds:      string[];
  departmentId:   string | null;
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  createdAt:      Date;
  updatedAt:      Date;
}

const OPDVisitSchema = new Schema<IOPDVisit>(
  {
    visitId:        { type: String, required: true, unique: true },
    tenantId:       { type: String, required: true, index: true },
    patientId:      { type: String, required: true },
    fullName:       { type: String, required: false },
    doctorIds:      { type: [String], default: [] },
    departmentId:   { type: String, default: null },
    visitDate:      { type: Date,   required: true },
    queueNumber:    { type: Number, required: true },
    status:         { type: String, required: true, enum: Object.values(OPDVisitStatus), default: OPDVisitStatus.OPEN },
    diagnosis:      { type: String, default: null },
    prescription:   { type: String, default: null },
    notes:          { type: String, default: null },
  },
  { timestamps: true, collection: 'opd_visits' },
);

// NFR-01: tenantId first on all compound indexes
OPDVisitSchema.index({ tenantId: 1, visitId: 1 }, { unique: true });
OPDVisitSchema.index({ tenantId: 1, patientId: 1, visitDate: -1 }); // patient history
OPDVisitSchema.index({ tenantId: 1, visitDate: 1, status: 1 });      // queue queries
OPDVisitSchema.index({ tenantId: 1, visitDate: 1, doctorIds: 1 });   // doctor's queue
OPDVisitSchema.index({ tenantId: 1, departmentId: 1, visitDate: -1 }); // department queue

// Duplicate-appointment guard: for a given patient + calendar date, the same
// doctor cannot appear on two non-cancelled visits (multikey unique index — one
// entry per doctorIds element, so it also blocks concurrent/racing requests that
// slip past the service-layer check). Visits with no doctor assigned (empty
// array) produce no index entries and are therefore not constrained by this.
OPDVisitSchema.index(
  { tenantId: 1, patientId: 1, visitDate: 1, doctorIds: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $ne: OPDVisitStatus.CANCELLED } },
    name: 'uniq_active_patient_doctor_date',
  },
);

export const OPDVisitModel = mongoose.model<IOPDVisit>('OPDVisit', OPDVisitSchema);
