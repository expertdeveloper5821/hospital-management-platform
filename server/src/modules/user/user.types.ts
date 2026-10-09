import { UserRole } from '../../shared/types/common.types';

export interface CreateUserRequest {
  email:        string;
  name:         string;
  role:         UserRole;
  departmentIds?: string[];
  /** Uttarakhand Medical Council Registration No. — required when role is DOCTOR. */
  ukmcNo?:      string;
}

export interface UpdateRoleRequest {
  role: UserRole;
}

export interface UpdateProfileRequest {
  name?:  string;
  email?: string;
  role?:  UserRole;
  /** Uppercase alphanumeric; null clears it. Forced to null when role is not DOCTOR. */
  ukmcNo?: string | null;
  departmentIds?: string[];
}

export interface UpdateMyProfileRequest {
  name?:           string;
  phone?:          string | null;
  profileImageUrl?: string | null;
}

export interface ChangeMyPasswordRequest {
  currentPassword: string;
  newPassword:     string;
}

export interface UserResponse {
  userId:       string;
  email:        string;
  name:         string;
  role:         UserRole;
  ukmcNo:       string | null;
  departmentIds: string[];
  isActive:     boolean;
  isFirstLogin: boolean;
  tenantId:     string;
  createdAt:    Date;
}

export type SortByField   = 'name' | 'createdAt' | 'role';
export type SortOrderDir = 'asc' | 'desc';

export interface ListUsersFilters {
  role?:      UserRole;
  isActive?:  boolean;
  search?:    string;
  sortBy?:    SortByField;
  sortOrder?: SortOrderDir;
}
