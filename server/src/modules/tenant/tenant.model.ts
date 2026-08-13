import mongoose, { Schema, Document } from 'mongoose';
import { TenantStatus } from '../../shared/types/common.types';
import { BrandingConfig, OnboardingDocuments, OPDSettingsConfig } from './tenant.types';
import { DEFAULT_OPD_VALIDITY_DAYS } from './tenant.constants';

export interface ITenant extends Document {
  name:                string;
  adminEmail:          string;
  status:              TenantStatus;
  onboardingDocuments: OnboardingDocuments;
  branding:            BrandingConfig;
  opdSettings:         OPDSettingsConfig;
  inviteToken:         string | null;
  inviteTokenExpiry:   Date | null;
  createdAt:           Date;
  updatedAt:           Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name:       { type: String, required: true, trim: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true, unique: true },
    status:     { type: String, required: true, enum: Object.values(TenantStatus), default: TenantStatus.PENDING_VERIFICATION },
    onboardingDocuments: {
      registrationCertificate: { type: String, required: true },
      gstNumber:               { type: String, required: true },
      panCard:                 { type: String, required: true },
      addressLine:            { type: String, required: true, trim: true },
      city:                    { type: String, required: true, trim: true },
      state:                   { type: String, required: true, trim: true },
      pincode:                 { type: String, required: true, trim: true },
    },
    branding: {
      logoUrl:      { type: String, default: null },
      displayName:  { type: String, default: '' },
      primaryColor: { type: String, default: '#1A73E8' },
    },
    // Hospital-configurable OPD business rules. `validityDays` is how long a
    // completed OPD payment covers further OPD visits for the same patient
    // before a new payment is required — see OPDService.getPaymentValidity.
    opdSettings: {
      validityDays: { type: Number, default: DEFAULT_OPD_VALIDITY_DAYS, min: 1, max: 365 },
    },
    inviteToken:       { type: String, default: null },
    inviteTokenExpiry: { type: Date,   default: null },
  },
  { timestamps: true, collection: 'tenants' },
);

TenantSchema.index({ status: 1 });

export const TenantModel = mongoose.model<ITenant>('Tenant', TenantSchema);
