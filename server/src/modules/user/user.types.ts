import { UserRole } from '../../shared/types/common.types';

export interface CreateUserRequest {
  email:    string;
  name:     string;
  role:     UserRole;
}

export interface UpdateRoleRequest {
  role: UserRole;
}

export interface UpdateProfileRequest {
  name?:  string;
  email?: string;
}

export interface UserResponse {
  userId:      string;
  email:       string;
  name:        string;
  role:        UserRole;
  isActive:    boolean;
  isFirstLogin: boolean;
  tenantId:    string;
  createdAt:   Date;
}

export interface ListUsersFilters {
  role?:     UserRole;
  isActive?: boolean;
}
