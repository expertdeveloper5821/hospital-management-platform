import mongoose, { Schema, Document } from 'mongoose';
import { TenantStatus } from '../../shared/types/common.types';
import { BrandingConfig, OnboardingDocuments } from './tenant.types';

export interface ITenant extends Document {
  name:                string;
  adminEmail:          string;
  status:              TenantStatus;
  onboardingDocuments: OnboardingDocuments;
  branding:            BrandingConfig;
  inviteToken:         string | null;
  inviteTokenExpiry:   Date | null;
  createdAt:           Date;
  updatedAt:           Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name:       { type: String, required: true, trim: true },
    adminEmail: { type: String, required: true, lowercase: true, trim: true },
    status:     { type: String, required: true, enum: Object.values(TenantStatus), default: TenantStatus.PENDING_VERIFICATION },
    onboardingDocuments: {
      registrationCertificate: { type: String, required: true },
      gstNumber:               { type: String, required: true },
      panCard:                 { type: String, required: true },
      addressProof:            { type: String, required: true },
    },
    branding: {
      logoUrl:      { type: String, default: null },
      displayName:  { type: String, default: '' },
      primaryColor: { type: String, default: '#1A73E8' },
    },
    inviteToken:       { type: String, default: null },
    inviteTokenExpiry: { type: Date,   default: null },
  },
  { timestamps: true, collection: 'tenants' },
);

TenantSchema.index({ status: 1 });

export const TenantModel = mongoose.model<ITenant>('Tenant', TenantSchema);
