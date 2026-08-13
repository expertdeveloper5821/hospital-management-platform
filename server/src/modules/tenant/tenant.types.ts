export interface OnboardingDocuments {
  registrationCertificate: string; // S3 key
  gstNumber:               string;
  panCard:                 string; // S3 key
  addressLine:            string;
  city:                    string;
  state:                   string;
  pincode:                 string; // 6-digit Indian PIN
}

export interface BrandingConfig {
  logoUrl?:     string; // S3 key
  displayName:  string;
  primaryColor: string; // hex e.g. #1A73E8
}

// Response shape for GET /:tenantId/branding — branding fields plus the
// registered hospital address/contact details already stored on the tenant
// (onboardingDocuments + adminEmail), so letterheads/printouts can render a
// real hospital header without a separate endpoint. Phone number and website
// are intentionally omitted — the tenant schema has no such fields, and
// consumers must not invent them.
export interface HospitalProfileResponse extends BrandingConfig {
  addressLine:  string;
  city:         string;
  state:        string;
  pincode:      string;
  contactEmail: string;
}

export interface CreateTenantRequest {
  name:                string;
  adminEmail:          string;
  onboardingDocuments: OnboardingDocuments;
}

export interface UpdateBrandingRequest {
  displayName?:  string;
  primaryColor?: string;
  // logo is handled as multipart file upload separately
}

export interface CompleteTenantSetupRequest {
  inviteToken:   string;
  adminName:     string;
  password:      string;
}

// Hospital-configurable OPD business rules (Hospital Admin only).
export interface OPDSettingsConfig {
  validityDays: number; // how many days a completed OPD payment remains valid for
}

export interface UpdateOPDSettingsRequest {
  validityDays: number;
}
