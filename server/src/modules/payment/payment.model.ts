import mongoose, { Schema, Document } from 'mongoose';
import { PaymentMethod, PaymentStatus } from './payment.types';

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
    createdBy:         { type: String, required: true },
  },
  { timestamps: true, collection: 'payments' },
);

// tenantId first on all compound indexes (NFR-01)
PaymentSchema.index({ tenantId: 1, patientId: 1 });
PaymentSchema.index({ tenantId: 1, paymentMethod: 1 });
PaymentSchema.index({ tenantId: 1, createdAt: 1 });
PaymentSchema.index({ razorpayOrderId: 1 }, { sparse: true });

export const PaymentModel = mongoose.model<IPayment>('Payment', PaymentSchema);
