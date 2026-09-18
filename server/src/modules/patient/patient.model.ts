import mongoose, { Schema, Document } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Gender, BloodGroup } from './patient.types';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose, isEncryptedField } from '../../shared/utils/field-encryption';

export interface IPatient extends Document {
  patientId:              string;
  tenantId:               string;
  fullName:               string;
  // Stored (and returned) as an ISO-8601 string — the field is encrypted at
  // rest (see below) and ciphertext cannot live in a Date-typed path.
  dateOfBirth:            string;
  gender:                 Gender;
  mobileNumber:           string;
  address:                string;
  addressLine1:           string | null;
  addressLine2:           string | null;
  city:                   string | null;
  state:                  string | null;
  country:                string | null;
  pincode:                string | null;
  aadhaarNumber:          string | null;
  emergencyContactName:   string | null;
  emergencyContactMobile: string | null;
  bloodGroup:                BloodGroup | null;
  departmentId:              string | null;
  registrationFee:           number | null;
  registrationPaymentMethod: string | null;
  isDeleted:                 boolean;
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
    // String, not Date — the value is encrypted at rest. The setter normalises
    // any incoming Date (or date string) to ISO-8601 so callers that still pass
    // `new Date(...)` keep working and the JSON shape is unchanged. An
    // already-encrypted value (e.g. a migration writing through the model) is
    // left untouched.
    dateOfBirth: {
      type:     String,
      required: true,
      set: (v: unknown): unknown => {
        if (v instanceof Date) return Number.isNaN(v.getTime()) ? v : v.toISOString();
        if (typeof v === 'string' && v.length > 0 && !isEncryptedField(v)) {
          const t = Date.parse(v);
          return Number.isNaN(t) ? v : new Date(t).toISOString();
        }
        return v;
      },
    },
    gender:                 { type: String, required: true, enum: Object.values(Gender) },
    mobileNumber:           { type: String, required: true, trim: true },
    address:                { type: String, required: true, trim: true },
    addressLine1:           { type: String, default: null, trim: true },
    addressLine2:           { type: String, default: null, trim: true },
    city:                   { type: String, default: null, trim: true },
    state:                  { type: String, default: null, trim: true },
    country:                { type: String, default: null, trim: true },
    pincode:                { type: String, default: null, trim: true },
    aadhaarNumber:          { type: String, default: null },
    emergencyContactName:   { type: String, default: null },
    emergencyContactMobile: { type: String, default: null },
    bloodGroup:                { type: String, default: null },
    departmentId:              { type: String, default: null },
    registrationFee:           { type: Number, default: null },
    registrationPaymentMethod: { type: String, default: null },
    isDeleted:                 { type: Boolean, default: false },
    deletedAt:              { type: Date,    default: null },
  },
  { timestamps: true, collection: 'patients' },
);

// tenantId first on all compound indexes (NFR-01)
PatientSchema.index({ tenantId: 1, mobileNumber: 1 }); // duplicate detection
PatientSchema.index({ tenantId: 1, patientId: 1 }, { unique: true }); // scoped lookup
PatientSchema.index({ tenantId: 1, fullName: 1 }); // name search
PatientSchema.index({ tenantId: 1, isDeleted: 1 }); // soft-delete filter
PatientSchema.index({ tenantId: 1, departmentId: 1, isDeleted: 1 }); // department-scoped queries

// ─── Sensitive PII encryption at rest (AES-256-GCM) ──────────────────────────
// Aadhaar, date of birth, blood group, the emergency-contact pair and every
// address component are encrypted transparently at the model layer via the
// shared encrypted-fields plugin — the same mechanism (and `AADHAAR` key) used
// elsewhere. Every write path (save,
// create/insertMany, updateOne/updateMany, findOneAndUpdate, replaceOne,
// findOneAndReplace, $setOnInsert upserts, and Model.bulkWrite) persists
// ciphertext; every read path hands callers back the plaintext. No
// repository/service/controller changes are needed. Legacy plaintext rows are
// passed through untouched on read (dateOfBirth values still stored as a BSON
// Date are normalised to an ISO-8601 string so the API shape is unchanged).
//
// Consequence: none of these fields can be matched/sorted in the database any
// more (ciphertext, random IV per write). No repository query does so today.
// `bloodGroup`'s schema path has no `enum` constraint (validation lives in the
// controller's Zod schema), so a ciphertext value persists without tripping it.
const ENCRYPTED_PII_FIELDS = {
  fields: [
    'aadhaarNumber', 'dateOfBirth', 'bloodGroup',
    'emergencyContactName', 'emergencyContactMobile',
    'address', 'addressLine1', 'addressLine2', 'city', 'state', 'country', 'pincode',
  ],
  purpose:    EncryptionKeyPurpose.AADHAAR,
  dateFields: ['dateOfBirth'],
};
PatientSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_PII_FIELDS);

export const PatientModel = mongoose.model<IPatient>('Patient', PatientSchema);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(PatientModel, ENCRYPTED_PII_FIELDS);
