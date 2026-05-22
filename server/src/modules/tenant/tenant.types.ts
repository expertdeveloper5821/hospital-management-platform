export interface OnboardingDocuments {
  registrationCertificate: string; // S3 key
  gstNumber:               string;
  panCard:                 string; // S3 key
  addressProof:            string; // S3 key
}

export interface BrandingConfig {
  logoUrl?:     string; // S3 key
  displayName:  string;
  primaryColor: string; // hex e.g. #1A73E8
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
