import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Gender, BloodGroup } from './patient.types';

export interface IPatient extends Document {
  patientId:              string;
  tenantId:               string;
  fullName:               string;
  dateOfBirth:            Date;
  gender:                 Gender;
  mobileNumber:           string;
  address:                string;
  aadhaarNumber:          string | null;
  emergencyContactName:   string | null;
  emergencyContactMobile: string | null;
  bloodGroup:             BloodGroup | null;
  isDeleted:              boolean;
  deletedAt:              Date | null;
  createdAt:              Date;
  updatedAt:              Date;
}

const PatientSchema = new Schema<IPatient>(
  {
    patientId: {
      type:     String,
      required: true,
      unique:   true,
      default:  () => `PAT-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
    },
    tenantId:               { type: String, required: true, index: true },
    fullName:               { type: String, required: true, trim: true },
    dateOfBirth:            { type: Date,   required: true },
    gender:                 { type: String, required: true, enum: Object.values(Gender) },
    mobileNumber:           { type: String, required: true, trim: true },
    address:                { type: String, required: true, trim: true },
    aadhaarNumber:          { type: String, default: null },
    emergencyContactName:   { type: String, default: null },
    emergencyContactMobile: { type: String, default: null },
    bloodGroup:             { type: String, default: null },
    isDeleted:              { type: Boolean, default: false },
    deletedAt:              { type: Date,    default: null },
  },
  { timestamps: true, collection: 'patients' },
);

// tenantId first on all compound indexes (NFR-01)
PatientSchema.index({ tenantId: 1, mobileNumber: 1 }); // duplicate detection
PatientSchema.index({ tenantId: 1, patientId: 1 }, { unique: true }); // scoped lookup
PatientSchema.index({ tenantId: 1, fullName: 1 }); // name search
PatientSchema.index({ tenantId: 1, isDeleted: 1 }); // soft-delete filter

export const PatientModel = mongoose.model<IPatient>('Patient', PatientSchema);
