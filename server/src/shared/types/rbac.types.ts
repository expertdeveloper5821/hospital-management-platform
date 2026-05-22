import { UserRole } from './common.types';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RolePermission {
  role:     UserRole;
  resource: string;
  methods:  HttpMethod[];
}
