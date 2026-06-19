import { baseApi } from './base.api';
import type {
  ApiSuccess,
  PackageResponse,
  PackageListResult,
  PackageStatus,
  CreatePackageRequest,
  UpdatePackageRequest,
  AssignmentResponse,
  AssignPackageRequest,
} from '../types';

export const packagesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listPackages: build.query<PackageListResult, { status?: PackageStatus; page?: number; limit?: number } | void>({
      query: (args) => {
        const params = new URLSearchParams();
        if (args?.status) params.set('status', args.status);
        if (args?.page)   params.set('page',   String(args.page));
        if (args?.limit)  params.set('limit',  String(args.limit));
        const qs = params.toString();
        return `/api/packages${qs ? `?${qs}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<PackageListResult>) => raw.data,
      providesTags: ['Package'],
    }),

    getPackage: build.query<PackageResponse, string>({
      query: (packageId) => `/api/packages/${packageId}`,
      transformResponse: (raw: ApiSuccess<PackageResponse>) => raw.data,
      providesTags: ['Package'],
    }),

    createPackage: build.mutation<PackageResponse, CreatePackageRequest>({
      query: (body) => ({ url: '/api/packages', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PackageResponse>) => raw.data,
      invalidatesTags: ['Package'],
    }),

    updatePackage: build.mutation<PackageResponse, { packageId: string } & UpdatePackageRequest>({
      query: ({ packageId, ...body }) => ({ url: `/api/packages/${packageId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<PackageResponse>) => raw.data,
      invalidatesTags: ['Package'],
    }),

    assignPackage: build.mutation<AssignmentResponse, AssignPackageRequest>({
      query: ({ packageId, ...body }) => ({ url: `/api/packages/${packageId}/assignments`, method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<AssignmentResponse>) => raw.data,
      invalidatesTags: ['PackageAssignment'],
    }),

    cancelAssignment: build.mutation<AssignmentResponse, { packageId: string; assignmentId: string }>({
      query: ({ packageId, assignmentId }) => ({
        url:    `/api/packages/${packageId}/assignments/${assignmentId}/cancel`,
        method: 'PATCH',
      }),
      transformResponse: (raw: ApiSuccess<AssignmentResponse>) => raw.data,
      invalidatesTags: ['PackageAssignment'],
    }),

    listPatientAssignments: build.query<AssignmentResponse[], string>({
      query: (patientId) => `/api/patients/${patientId}/assignments`,
      transformResponse: (raw: ApiSuccess<AssignmentResponse[]>) => raw.data,
      providesTags: ['PackageAssignment'],
    }),
  }),
});

export const {
  useListPackagesQuery,
  useGetPackageQuery,
  useCreatePackageMutation,
  useUpdatePackageMutation,
  useAssignPackageMutation,
  useCancelAssignmentMutation,
  useListPatientAssignmentsQuery,
} = packagesApi;
