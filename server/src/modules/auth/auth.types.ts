export interface LoginRequest {
  email:        string;
  password:     string;
  isSuperAdmin?: boolean;
}

export interface LoginResponse {
  token:       string;
  userId:      string;
  role:        string;
  isFirstLogin: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword:     string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token:       string;
  newPassword: string;
}
