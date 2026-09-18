import mongoose, { Schema, Document } from 'mongoose';
import { OPDVisitStatus } from './opd.types';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose } from '../../shared/utils/field-encryption';

// Structured (not free-text) vitals recorded from the OPD Edit form — see
// OPDVitals in opd.types.ts for the field/unit contract. Kept as its own
// sub-schema (no _id) rather than five top-level fields so the whole group
// reads and updates as one unit. Encrypted at rest (see
// ENCRYPTED_CLINICAL_FIELDS.objectFields below) — the TS shape here is the
// decrypted, application-facing shape; every read path hands callers back a
// real `number | null` / `string | null`, never ciphertext.
export interface IOPDVitals {
  weight:          number | null; // kg
  height:          number | null; // cm
  bloodPressure:   string | null; // "<systolic>/<diastolic>" mmHg
  sugar:           number | null; // mg/dL
  bodyTemperature: number | null; // °F
}

const OPDVitalsSchema = new Schema<IOPDVitals>(
  {
    // Mixed, not Number: ciphertext can't live in a Number path (CastError),
    // and String would make a hydrated document's compiled setter silently
    // re-cast the decrypted number back into a string on read — see the
    // comment above decryptNumberFieldsOn in encrypted-fields.plugin.ts.
    // Range validation happens at the Zod layer (opd.controller.ts) before a
    // value ever reaches Mongoose.
    weight:          { type: Schema.Types.Mixed, default: null },
    height:          { type: Schema.Types.Mixed, default: null },
    bloodPressure:   { type: String, default: null },
    sugar:           { type: Schema.Types.Mixed, default: null },
    bodyTemperature: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

export interface IOPDVisit extends Document {
  visitId:        string;
  tenantId:       string;
  patientId:      string;
  fullName?:      string;
  doctorIds:      string[];
  nurseIds:       string[];
  departmentId:   string | null;
  visitDate:      Date;
  queueNumber:    number;
  status:         OPDVisitStatus;
  diagnosis:      string | null;
  prescription:   string | null;
  notes:          string | null;
  vitals:         IOPDVitals;
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
    nurseIds:       { type: [String], default: [] },
    departmentId:   { type: String, default: null },
    visitDate:      { type: Date,   required: true },
    queueNumber:    { type: Number, required: true },
    status:         { type: String, required: true, enum: Object.values(OPDVisitStatus), default: OPDVisitStatus.OPEN },
    diagnosis:      { type: String, default: null },
    prescription:   { type: String, default: null },
    notes:          { type: String, default: null },
    // Every sub-field defaults to null via OPDVitalsSchema, so a visit with
    // no vitals recorded yet still reads back as a fully-shaped object
    // (never undefined) — the response contract OPDVisitResponse.vitals
    // relies on. Encrypted at rest alongside diagnosis/prescription/notes —
    // see ENCRYPTED_CLINICAL_FIELDS.objectFields below.
    vitals:         { type: OPDVitalsSchema, default: () => ({}) },
  },
  { timestamps: true, collection: 'opd_visits' },
);

// NFR-01: tenantId first on all compound indexes
OPDVisitSchema.index({ tenantId: 1, visitId: 1 }, { unique: true });
OPDVisitSchema.index({ tenantId: 1, patientId: 1, visitDate: -1 }); // patient history
OPDVisitSchema.index({ tenantId: 1, visitDate: 1, status: 1 });      // queue queries
OPDVisitSchema.index({ tenantId: 1, visitDate: 1, doctorIds: 1 });   // doctor's queue
OPDVisitSchema.index({ tenantId: 1, nurseIds: 1 });                  // nurse-scoped OPD visibility
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

// ─── Clinical free-text encryption at rest (AES-256-GCM) ─────────────────────
// diagnosis, prescription and notes are the free-text clinical fields on a
// visit (notes is sanitized rich-text HTML — see opd.controller.ts). vitals'
// bloodPressure/weight/height/sugar/bodyTemperature are structured clinical
// readings, encrypted the same way via objectFields (see
// EncryptedObjectFieldSpec in encrypted-fields.plugin.ts). All of them are
// encrypted transparently at the model layer, so every write path persists
// ciphertext to MongoDB and every read path hands callers back the plaintext —
// the service, controller, PDF generator and frontend are all unchanged and
// never see a key. The key lives only in server config
// (MEDICAL_DATA_ENCRYPTION_KEY, see AppConfig.security).
//
// Consequence for queries: none of these fields can be matched in the database
// any more (ciphertext, random IV per write). OPDRepository.findByPatient's
// diagnosis search filters after decryption instead of via $regex. No
// repository query filters, sorts, or aggregates on vitals.* today.
const ENCRYPTED_CLINICAL_FIELDS = {
  fields:  ['diagnosis', 'prescription', 'notes'],
  purpose: EncryptionKeyPurpose.MEDICAL,
  objectFields: [
    {
      path:         'vitals',
      stringFields: ['bloodPressure'],
      numberFields: ['weight', 'height', 'sugar', 'bodyTemperature'],
    },
  ],
};
OPDVisitSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_CLINICAL_FIELDS);

export const OPDVisitModel = mongoose.model<IOPDVisit>('OPDVisit', OPDVisitSchema);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(OPDVisitModel, ENCRYPTED_CLINICAL_FIELDS);
