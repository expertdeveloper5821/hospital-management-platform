import mongoose, { Schema, Document } from 'mongoose';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose } from '../../shared/utils/field-encryption';

export const CHARGE_CATEGORIES = [
  'CONSULTATION',
  'PROCEDURE',
  'LAB_TEST',
  'MEDICATION',
  'ROOM',
  'NURSING',
  'PACKAGE',
  'OTHER',
] as const;

export type ChargeCategory = typeof CHARGE_CATEGORIES[number];
export type ChargeStatus   = 'UNPAID' | 'PAID' | 'CANCELLED';

export interface ICharge extends Document {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference: string | null;
  // Only populated when category === 'LAB_TEST' — the Pathology/Radiology test
  // type selected from the Lab module's dynamic list on the Add Charge form.
  testTypeId:         string | null;
  testTypeName:       string | null;
  addedBy:            string;
  status:             ChargeStatus;
  paidBy:             string | null;
  paidAt:             Date | null;
  cancelledBy:        string | null;
  cancelledAt:        Date | null;
  createdAt:          Date;
  updatedAt:          Date;
}

const ChargeSchema = new Schema<ICharge>(
  {
    chargeId:           { type: String, required: true },
    tenantId:           { type: String, required: true },
    patientId:          { type: String, required: true },
    category:           { type: String, required: true, enum: CHARGE_CATEGORIES },
    // No `maxlength` here — the field is encrypted at rest (see below) and the
    // "enc:v1:" ciphertext envelope is longer than the plaintext. The real
    // length limit (1–500 chars) lives in the controller's Zod schema, which
    // runs on plaintext before it ever reaches the model.
    description:        { type: String, required: true },
    amount:             { type: Number, required: true, min: 0.01 },
    encounterReference: { type: String, default: null },
    testTypeId:         { type: String, default: null },
    testTypeName:       { type: String, default: null },
    addedBy:            { type: String, required: true },
    status:             { type: String, required: true, enum: ['UNPAID', 'PAID', 'CANCELLED'], default: 'UNPAID' },
    paidBy:             { type: String, default: null },
    paidAt:             { type: Date,   default: null },
    cancelledBy:        { type: String, default: null },
    cancelledAt:        { type: Date,   default: null },
  },
  { timestamps: true, collection: 'charges' },
);

ChargeSchema.index({ tenantId: 1, chargeId: 1 }, { unique: true });
ChargeSchema.index({ tenantId: 1, patientId: 1, status: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, category: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, addedBy: 1, createdAt: -1 });

// ─── Free-text billing description encryption at rest (AES-256-GCM) ──────────
// `description` is the free-text line-item label on a charge — it can embed a
// procedure/test/package name and encounter context. It is encrypted
// transparently at the model layer via the shared plugin (same mechanism and
// `PAYMENT` key as Payment.description/.transactionId). Every write path (save,
// create/insertMany, updateOne/updateMany, findOneAndUpdate, replaceOne,
// findOneAndReplace, $setOnInsert upserts, and Model.bulkWrite) persists
// ciphertext; every read path returns plaintext, so the service, bill totals,
// bill PDF, discharge summary and the frontend are all unchanged. Legacy
// plaintext rows are passed through untouched on read.
//
// Safe because `description` is never filtered, sorted, searched, indexed or
// aggregated — verified across charges.repository.ts (only patientId / category
// / addedBy / createdAt are query keys) and every consumer. `markPaid` builds
// the auto-created Payment's description from the decrypted model read, so that
// downstream value is unaffected.
const ENCRYPTED_CHARGE_FIELDS = {
  fields:  ['description'],
  purpose: EncryptionKeyPurpose.PAYMENT,
};
ChargeSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_CHARGE_FIELDS);

export const ChargeModel = mongoose.model<ICharge>('Charge', ChargeSchema);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(ChargeModel, ENCRYPTED_CHARGE_FIELDS);
