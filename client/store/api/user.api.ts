import { baseApi } from './base.api';
import type { ApiSuccess, UserResponse, UserRole, PaginatedResult } from '../types';

// The server returns raw Mongoose docs: _id instead of userId, no name field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseUser(u: any): UserResponse {
  return {
    userId:       u.userId ?? u._id ?? '',
    email:        u.email  ?? '',
    name:         typeof u.name === 'string' ? u.name : '',
    role:         u.role,
    isActive:     u.isActive     ?? true,
    isFirstLogin: u.isFirstLogin ?? false,
    tenantId:     u.tenantId     ?? '',
    createdAt:    u.createdAt    ?? '',
  };
}

interface CreateUserRequest {
  email: string;
  name:  string;
  role:  UserRole;
}

export interface MyProfileResponse {
  userId:          string;
  email:           string;
  name:            string;
  phone:           string | null;
  profileImageUrl: string | null;
  role:            UserRole;
  isActive:        boolean;
}

export const userApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    getMyProfile: build.query<MyProfileResponse, void>({
      query: () => '/api/users/me',
      transformResponse: (raw: ApiSuccess<MyProfileResponse>) => raw.data,
      providesTags: ['User'],
    }),

    updateMyProfile: build.mutation<MyProfileResponse, { name?: string; phone?: string | null }>({
      query: (body) => ({ url: '/api/users/me/profile', method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<MyProfileResponse>) => raw.data,
      invalidatesTags: ['User'],
    }),

    uploadProfileImage: build.mutation<{ profileImageUrl: string }, FormData>({
      query: (body) => ({
        url:    '/api/users/me/profile-image',
        method: 'POST',
        body,
        // Do not set Content-Type — browser/fetch sets multipart boundary automatically
        formData: true,
      }),
      transformResponse: (raw: ApiSuccess<{ profileImageUrl: string }>) => raw.data,
      invalidatesTags: ['User'],
    }),

    changeMyPassword: build.mutation<{ message: string }, { currentPassword: string; newPassword: string }>({
      query: (body) => ({ url: '/api/users/me/password', method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
    }),

    listUsers: build.query<PaginatedResult<UserResponse>, { role?: UserRole; isActive?: boolean; page?: number; limit?: number }>({
      query: ({ page = 1, limit = 20, role, isActive } = {}) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (role)             params.set('role', role);
        if (isActive != null) params.set('isActive', String(isActive));
        return `/api/users?${params}`;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformResponse: (raw: any) => ({
        ...(raw.data as PaginatedResult<UserResponse>),
        data: (raw.data.data as unknown[]).map(normaliseUser),
      }),
      providesTags: ['User'],
    }),

    getUserById: build.query<UserResponse, string>({
      query: (userId) => `/api/users/${userId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformResponse: (raw: any) => normaliseUser(raw.data),
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
  useGetMyProfileQuery,
  useUpdateMyProfileMutation,
  useUploadProfileImageMutation,
  useChangeMyPasswordMutation,
  useListUsersQuery,
  useGetUserByIdQuery,
  useCreateUserMutation,
  useUpdateUserRoleMutation,
  useDeactivateUserMutation,
} = userApi;
