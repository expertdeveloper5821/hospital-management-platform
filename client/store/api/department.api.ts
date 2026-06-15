import { baseApi } from './base.api';
import type {
  ApiSuccess,
  DepartmentResponse,
  CreateDepartmentRequest,
  UpdateDepartmentRequest,
} from '../types';

export const departmentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listDepartments: build.query<DepartmentResponse[], void>({
      query: () => '/api/departments',
      transformResponse: (raw: ApiSuccess<DepartmentResponse[]>) => raw.data,
      providesTags: ['Department'],
    }),

    getDepartmentById: build.query<DepartmentResponse, string>({
      query: (departmentId) => `/api/departments/${departmentId}`,
      transformResponse: (raw: ApiSuccess<DepartmentResponse>) => raw.data,
      providesTags: ['Department'],
    }),

    createDepartment: build.mutation<DepartmentResponse, CreateDepartmentRequest>({
      query: (body) => ({ url: '/api/departments', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<DepartmentResponse>) => raw.data,
      invalidatesTags: ['Department'],
    }),

    updateDepartment: build.mutation<DepartmentResponse, { departmentId: string } & UpdateDepartmentRequest>({
      query: ({ departmentId, ...body }) => ({ url: `/api/departments/${departmentId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<DepartmentResponse>) => raw.data,
      invalidatesTags: ['Department'],
    }),

    deleteDepartment: build.mutation<{ message: string }, string>({
      query: (departmentId) => ({ url: `/api/departments/${departmentId}`, method: 'DELETE' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Department'],
    }),

    updateDepartmentDoctors: build.mutation<{ message: string }, {
      departmentId: string;
      add?:         string[];
      remove?:      string[];
    }>({
      query: ({ departmentId, ...body }) => ({
        url:    `/api/departments/${departmentId}/doctors`,
        method: 'PATCH',
        body,
      }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Department', 'User'],
    }),

  }),
});

export const {
  useListDepartmentsQuery,
  useGetDepartmentByIdQuery,
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useDeleteDepartmentMutation,
  useUpdateDepartmentDoctorsMutation,
} = departmentApi;
