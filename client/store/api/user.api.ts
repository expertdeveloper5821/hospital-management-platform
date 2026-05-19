import { baseApi } from './base.api';
import type { ApiSuccess, UserResponse, UserRole, PaginatedResult } from '../types';

interface CreateUserRequest {
  email: string;
  name:  string;
  role:  UserRole;
}

export const userApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listUsers: build.query<PaginatedResult<UserResponse>, { role?: UserRole; isActive?: boolean; page?: number; limit?: number }>({
      query: ({ page = 1, limit = 20, role, isActive } = {}) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (role)             params.set('role', role);
        if (isActive != null) params.set('isActive', String(isActive));
        return `/api/users?${params}`;
      },
      transformResponse: (raw: ApiSuccess<PaginatedResult<UserResponse>>) => raw.data,
      providesTags: ['User'],
    }),

    getUserById: build.query<UserResponse, string>({
      query: (userId) => `/api/users/${userId}`,
      transformResponse: (raw: ApiSuccess<UserResponse>) => raw.data,
      providesTags: ['User'],
    }),

    createUser: build.mutation<UserResponse, CreateUserRequest>({
      query: (body) => ({ url: '/api/users', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<UserResponse>) => raw.data,
      invalidatesTags: ['User'],
    }),

    updateUserRole: build.mutation<{ message: string }, { userId: string; role: UserRole }>({
      query: ({ userId, role }) => ({ url: `/api/users/${userId}/role`, method: 'PATCH', body: { role } }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['User'],
    }),

    deactivateUser: build.mutation<{ message: string }, string>({
      query: (userId) => ({ url: `/api/users/${userId}/deactivate`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['User'],
    }),
  }),
});

export const {
  useListUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserRoleMutation,
  useDeactivateUserMutation,
} = userApi;
