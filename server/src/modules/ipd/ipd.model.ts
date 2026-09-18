import mongoose, { Schema, Document } from 'mongoose';
import { AdmissionStatus, ProgressNote } from './ipd.types';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose } from '../../shared/utils/field-encryption';

// Structured (not free-text) vitals recorded from the IPD Edit form — mirrors
// OPDVisit's IOPDVitals (opd.model.ts) field-for-field: same units, same
// "every sub-field independently nullable" contract. Kept as its own
// sub-schema (no _id) so the whole group reads and updates as one unit.
// Encrypted at rest (see ENCRYPTED_IPD_FIELDS.objectFields below) — the TS
// shape here is the decrypted, application-facing shape; every read path
// hands callers back a real `number | null` / `string | null`, never
// ciphertext.
export interface IIPDVitals {
  weight:          number | null; // kg
  height:          number | null; // cm
  bloodPressure:   string | null; // "<systolic>/<diastolic>" mmHg
  sugar:           number | null; // mg/dL
  bodyTemperature: number | null; // °F
}

const IPDVitalsSchema = new Schema<IIPDVitals>(
  {
    // Mixed, not Number: ciphertext can't live in a Number path (CastError),
    // and String would make a hydrated document's compiled setter silently
    // re-cast the decrypted number back into a string on read — see the
    // comment above decryptNumberFieldsOn in encrypted-fields.plugin.ts.
    // Range validation happens at the Zod layer (ipd.controller.ts) before a
    // value ever reaches Mongoose.
    weight:          { type: Schema.Types.Mixed, default: null },
    height:          { type: Schema.Types.Mixed, default: null },
    bloodPressure:   { type: String, default: null },
    sugar:           { type: Schema.Types.Mixed, default: null },
    bodyTemperature: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

// ─── IPDAdmission Document Interface ─────────────────────────────────────────
export interface IIPDAdmission extends Document {
  admissionId:      string;
  patientId:        string;
  wardId:           string;
  bedId:            string;
  bedNumber:        string;
  wardName:         string;
  assignedDoctorIds: string[];
  departmentId:     string | null;
  status:           AdmissionStatus;
  admissionDate:    Date;
  dischargeDate:    Date | null;
  progressNotes:    ProgressNote[];
  vitals:           IIPDVitals;
  tenantId:         string;
  createdAt:        Date;
  updatedAt:        Date;
}

// ─── ProgressNote Subdocument Schema ─────────────────────────────────────────
const progressNoteSchema = new Schema<ProgressNote>(
  {
    noteId:    { type: String, required: true },
    doctorId:  { type: String, required: true },
    // No `maxlength` here — `note` is encrypted at rest (see below) and the
    // "enc:v1:" ciphertext envelope is longer than the plaintext. The real
    // length limit lives in ipd.types.ts' AddProgressNoteSchema (30000 raw /
    // 5000 tag-stripped chars), which runs on plaintext before it reaches the
    // model.
    note:      { type: String, required: true, trim: true },
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
    assignedDoctorIds: { type: [String], default: [] },
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
    // Every sub-field defaults to null via IPDVitalsSchema, so an admission
    // with no vitals recorded yet still reads back as a fully-shaped object
    // (never undefined) — same contract as OPDVisit.vitals. Encrypted at rest
    // alongside progressNotes[].note — see ENCRYPTED_IPD_FIELDS.objectFields
    // below.
    vitals:         { type: IPDVitalsSchema, default: () => ({}) },
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

// ─── Progress-note / vitals encryption at rest (AES-256-GCM) ─────────────────
// Each progressNotes[] element's `note` is sanitized rich-text clinical
// free-text. It is encrypted transparently at the model layer via the shared
// plugin's array-subdocument support (same mechanism and `MEDICAL` key as
// OPDVisit.diagnosis/.prescription/.notes and PathologyRequest/RadiologyRequest
// .notes). Every write path — `$push` (appendProgressNote), whole-array `$set`,
// save/create/insertMany/updateOne/updateMany/findOneAndUpdate/replaceOne, and
// Model.bulkWrite — persists ciphertext; every read path hands callers back the
// plaintext, so the service, controller and the discharge-summary PDF are all
// unchanged and never see a key. `noteId`, `doctorId` and `timestamp` stay
// plaintext — they are resolved/sorted/looked up and never carry PHI.
//
// vitals' bloodPressure/weight/height/sugar/bodyTemperature are structured
// clinical readings, encrypted the same way via objectFields (single nested
// subdocument — see EncryptedObjectFieldSpec).
//
// Safe because no `note`/vitals.* value is ever used in a filter, sort, index,
// aggregation or `distinct()` — verified across ipd.repository.ts (only
// admissionId / tenantId / patientId / bedId / wardId / status / departmentId /
// assignedDoctorIds are query keys) and every consumer. Legacy plaintext
// elements are passed through untouched on read.
const ENCRYPTED_IPD_FIELDS = {
  fields:      [] as string[],
  arrayFields: [{ path: 'progressNotes', fields: ['note'] }],
  objectFields: [
    {
      path:         'vitals',
      stringFields: ['bloodPressure'],
      numberFields: ['weight', 'height', 'sugar', 'bodyTemperature'],
    },
  ],
  purpose:     EncryptionKeyPurpose.MEDICAL,
};
ipdAdmissionSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_IPD_FIELDS);

export const IPDAdmissionModel = mongoose.model<IIPDAdmission>(
  'IPDAdmission',
  ipdAdmissionSchema,
);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext progress notes either.
wrapModelBulkWrite(IPDAdmissionModel, ENCRYPTED_IPD_FIELDS);
