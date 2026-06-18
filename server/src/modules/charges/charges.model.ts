import mongoose, { Schema, Document } from 'mongoose';

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
export type ChargeStatus   = 'UNPAID' | 'VOIDED';

export interface ICharge extends Document {
  chargeId:           string;
  tenantId:           string;
  patientId:          string;
  category:           ChargeCategory;
  description:        string;
  amount:             number;
  encounterReference: string | null;
  addedBy:            string;
  status:             ChargeStatus;
  voidedBy:           string | null;
  voidedAt:           Date | null;
  createdAt:          Date;
  updatedAt:          Date;
}

const ChargeSchema = new Schema<ICharge>(
  {
    chargeId:           { type: String, required: true },
    tenantId:           { type: String, required: true },
    patientId:          { type: String, required: true },
    category:           { type: String, required: true, enum: CHARGE_CATEGORIES },
    description:        { type: String, required: true, maxlength: 500 },
    amount:             { type: Number, required: true, min: 0.01 },
    encounterReference: { type: String, default: null },
    addedBy:            { type: String, required: true },
    status:             { type: String, required: true, enum: ['UNPAID', 'VOIDED'], default: 'UNPAID' },
    voidedBy:           { type: String, default: null },
    voidedAt:           { type: Date,   default: null },
  },
  { timestamps: true, collection: 'charges' },
);

ChargeSchema.index({ tenantId: 1, chargeId: 1 }, { unique: true });
ChargeSchema.index({ tenantId: 1, patientId: 1, status: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, category: 1, createdAt: -1 });
ChargeSchema.index({ tenantId: 1, addedBy: 1, createdAt: -1 });

export const ChargeModel = mongoose.model<ICharge>('Charge', ChargeSchema);
