import mongoose, { Schema, Document } from 'mongoose';
import { PaymentMethod, PaymentStatus } from './payment.types';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose } from '../../shared/utils/field-encryption';

export interface IPayment extends Document {
  paymentId:          string;
  tenantId:           string;
  patientId:          string;
  fullName:           string;
  amount:             number;
  paymentMethod:      PaymentMethod;
  description:        string;
  status:             PaymentStatus;
  receiptS3Key:       string | null;
  razorpayOrderId:    string | null;
  razorpayPaymentId:  string | null;
  // Direct link to the record this payment was collected for (e.g. a specific
  // OPD visit) — lets consumers look up "the payment for visit X" exactly,
  // instead of guessing from patientId + calendar date (ambiguous whenever a
  // patient has more than one payment on the same day).
  referenceType:      string | null;
  referenceId:        string | null;
  // Optional UPI/Card reference number the payer's app/terminal shows —
  // recorded as-is for reconciliation; never required to complete a payment.
  transactionId:      string | null;
  createdBy:          string;
  createdAt:          Date;
  updatedAt:          Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    paymentId:         { type: String, required: true, unique: true },
    tenantId:          { type: String, required: true, index: true },
    patientId:         { type: String, required: true },
    fullName:          { type: String, required: false },
    amount:            { type: Number, required: true, min: 0.01 },
    paymentMethod:     { type: String, required: true, enum: Object.values(PaymentMethod) },
    description:       { type: String, required: true, trim: true },
    status:            { type: String, required: true, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING },
    receiptS3Key:      { type: String, default: null },
    razorpayOrderId:   { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    referenceType:     { type: String, default: null },
    referenceId:       { type: String, default: null },
    transactionId:     { type: String, default: null },
    createdBy:         { type: String, required: true },
  },
  { timestamps: true, collection: 'payments' },
);

// tenantId first on all compound indexes (NFR-01)
PaymentSchema.index({ tenantId: 1, patientId: 1 });
PaymentSchema.index({ tenantId: 1, paymentMethod: 1 });
PaymentSchema.index({ tenantId: 1, createdAt: 1 });
PaymentSchema.index({ tenantId: 1, referenceType: 1, referenceId: 1 });
PaymentSchema.index({ razorpayOrderId: 1 }, { sparse: true });

// ─── Sensitive free-text / reference encryption at rest (AES-256-GCM) ────────
// `description` (free text — may embed visit/procedure/charge context) and
// `transactionId` (external UPI/Card reference number) are encrypted
// transparently at the model layer via the shared plugin. Every write path
// (save, create/insertMany, updateOne/updateMany, findOneAndUpdate, replaceOne,
// findOneAndReplace, $setOnInsert upserts, and Model.bulkWrite) persists
// ciphertext; every read path returns plaintext, so the service, controller,
// PDF generators and the frontend are unchanged. Legacy plaintext rows are
// passed through untouched on read.
//
// Safe because neither field is used in any filter, sort, search, index,
// aggregation, or `$lookup` join — verified across payment.repository.ts,
// dashboard.repository.ts, the discharge-summary billing section and the
// frontend. Every other Payment field (amount, status, paymentMethod,
// createdAt, referenceType, referenceId, patientId, razorpayOrderId) is a
// query/aggregation key and stays plaintext.
const ENCRYPTED_PAYMENT_FIELDS = {
  fields:  ['description', 'transactionId'],
  purpose: EncryptionKeyPurpose.PAYMENT,
};
PaymentSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_PAYMENT_FIELDS);

export const PaymentModel = mongoose.model<IPayment>('Payment', PaymentSchema);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(PaymentModel, ENCRYPTED_PAYMENT_FIELDS);
