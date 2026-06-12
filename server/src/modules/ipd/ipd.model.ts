import mongoose, { Schema, Document } from 'mongoose';
import { AdmissionStatus, ProgressNote } from './ipd.types';

// ─── IPDAdmission Document Interface ─────────────────────────────────────────
export interface IIPDAdmission extends Document {
  admissionId:      string;
  patientId:        string;
  wardId:           string;
  bedId:            string;
  bedNumber:        string;
  wardName:         string;
  assignedDoctorId: string;
  departmentId:     string | null;
  status:           AdmissionStatus;
  admissionDate:    Date;
  dischargeDate:    Date | null;
  progressNotes:    ProgressNote[];
  tenantId:         string;
  createdAt:        Date;
  updatedAt:        Date;
}

// ─── ProgressNote Subdocument Schema ─────────────────────────────────────────
const progressNoteSchema = new Schema<ProgressNote>(
  {
    noteId:    { type: String, required: true },
    doctorId:  { type: String, required: true },
    note:      { type: String, required: true, trim: true, maxlength: 5000 },
    timestamp: { type: Date,   required: true, default: () => new Date() },
  },
  { _id: false },
);

// ─── IPDAdmission Schema ──────────────────────────────────────────────────────
const ipdAdmissionSchema = new Schema<IIPDAdmission>(
  {
    admissionId:      { type: String, required: true, unique: true },
    patientId:        { type: String, required: true },
    wardId:           { type: String, required: true },
    bedId:            { type: String, required: true },
    bedNumber:        { type: String, required: true },
    wardName:         { type: String, required: true },
    assignedDoctorId: { type: String, required: true },
    departmentId:     { type: String, default: null },
    status: {
      type:     String,
      enum:     Object.values(AdmissionStatus),
      default:  AdmissionStatus.ADMITTED,
      required: true,
    },
    admissionDate:  { type: Date,   required: true, default: () => new Date() },
    dischargeDate:  { type: Date,   default: null },
    progressNotes:  { type: [progressNoteSchema], default: [] },
    tenantId:       { type: String, required: true },
  },
  {
    timestamps:  true,
    collection:  'ipd_admissions',
  },
);

// tenantId first on all compound indexes (NFR-01)
ipdAdmissionSchema.index({ tenantId: 1, status: 1 });
ipdAdmissionSchema.index({ tenantId: 1, wardId: 1 });
ipdAdmissionSchema.index({ tenantId: 1, bedId: 1, status: 1 });
ipdAdmissionSchema.index({ tenantId: 1, patientId: 1 });
ipdAdmissionSchema.index({ tenantId: 1, departmentId: 1, status: 1 });

export const IPDAdmissionModel = mongoose.model<IIPDAdmission>(
  'IPDAdmission',
  ipdAdmissionSchema,
);
