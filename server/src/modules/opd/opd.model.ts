import mongoose, { Schema, Document } from 'mongoose';
import { OPDVisitStatus } from './opd.types';

export interface IOPDVisit extends Document {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  doctorId:       string | null;
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  chiefComplaint: string;
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
    doctorId:       { type: String, default: null },
    visitDate:      { type: Date,   required: true },
    queueNumber:    { type: Number, required: true },
    status:         { type: String, required: true, enum: Object.values(OPDVisitStatus), default: OPDVisitStatus.OPEN },
    chiefComplaint: { type: String, required: true, trim: true },
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
OPDVisitSchema.index({ tenantId: 1, visitDate: 1, doctorId: 1 });    // doctor's queue

export const OPDVisitModel = mongoose.model<IOPDVisit>('OPDVisit', OPDVisitSchema);
