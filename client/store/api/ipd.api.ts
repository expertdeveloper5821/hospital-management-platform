import { baseApi } from './base.api';
import type {
  ApiSuccess,
  PaginatedResult,
  WardResponse,
  BedResponse,
  AdmissionResponse,
  WardOccupancySummary,
  CreateAdmissionRequest,
  AddProgressNoteRequest,
  ListAdmissionsQuery,
} from '../types';

export const ipdApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // ── Wards ─────────────────────────────────────────────────────────────────

    listWards: build.query<WardResponse[], void>({
      query: () => '/api/ipd/wards',
      transformResponse: (raw: ApiSuccess<WardResponse[]>) => raw.data,
      providesTags: ['IPD'],
    }),

    createWard: build.mutation<WardResponse, { name: string; floor?: string }>({
      query: (body) => ({ url: '/api/ipd/wards', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<WardResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    // ── Beds ──────────────────────────────────────────────────────────────────

    listBeds: build.query<BedResponse[], string>({
      query: (wardId) => {
        if (!wardId) throw new Error('wardId is required');
        return `/api/ipd/wards/${wardId}/beds`;
      },
      transformResponse: (raw: ApiSuccess<BedResponse[]>) => raw.data,
      providesTags: ['IPD'],
    }),

    addBeds: build.mutation<BedResponse[], { wardId: string; bedNumbers: string[] }>({
      query: ({ wardId, bedNumbers }) => ({
        url:    `/api/ipd/wards/${wardId}/beds`,
        method: 'POST',
        body:   { bedNumbers },
      }),
      transformResponse: (raw: ApiSuccess<BedResponse[]>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    // ── Admissions ────────────────────────────────────────────────────────────

    getAdmissionById: build.query<AdmissionResponse, string>({
      query: (admissionId) => `/api/ipd/admissions/${admissionId}`,
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      providesTags: ['IPD'],
    }),

    listAdmissions: build.query<PaginatedResult<AdmissionResponse>, ListAdmissionsQuery>({
      query: (params) => ({
        url:    '/api/ipd/admissions',
        params: { status: 'ADMITTED', ...params },
      }),
      transformResponse: (raw: ApiSuccess<PaginatedResult<AdmissionResponse>>) => raw.data,
      providesTags: ['IPD'],
    }),

    createAdmission: build.mutation<AdmissionResponse, CreateAdmissionRequest>({
      query: (body) => ({ url: '/api/ipd/admissions', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    addProgressNote: build.mutation<AdmissionResponse, { admissionId: string } & AddProgressNoteRequest>({
      query: ({ admissionId, note }) => {
        if (!admissionId) throw new Error('admissionId is required');
        return {
          url:    `/api/ipd/admissions/${admissionId}/progress-notes`,
          method: 'POST',
          body:   { note },
        };
      },
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    updateAdmission: build.mutation<AdmissionResponse, {
      admissionId:      string;
      assignedDoctorId?: string;
      wardId?:           string;
      bedId?:            string;
    }>({
      query: ({ admissionId, ...body }) => {
        if (!admissionId) throw new Error('admissionId is required');
        return {
          url:    `/api/ipd/admissions/${admissionId}`,
          method: 'PATCH',
          body,
        };
      },
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    dischargePatient: build.mutation<AdmissionResponse, string>({
      query: (admissionId) => {
        // Defensive guard: an empty admissionId would produce the URL
        // /api/ipd/admissions//discharge (double-slash) which hits the 404 handler.
        if (!admissionId) {
          throw new Error('admissionId is required for discharge');
        }
        return {
          url:    `/api/ipd/admissions/${admissionId}/discharge`,
          method: 'PATCH',
        };
      },
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    // ── Patient IPD history ───────────────────────────────────────────────────

    getIPDPatientHistory: build.query<PaginatedResult<AdmissionResponse>, {
      patientId: string;
      page?:     number;
      limit?:    number;
      status?:   'ADMITTED' | 'DISCHARGED';
    }>({
      query: ({ patientId, page = 1, limit = 10, status }) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (status) params.set('status', status);
        return `/api/ipd/patients/${patientId}/history?${params}`;
      },
      transformResponse: (raw: ApiSuccess<PaginatedResult<AdmissionResponse>>) => raw.data,
      providesTags: ['IPD'],
    }),

    // ── Occupancy ─────────────────────────────────────────────────────────────

    getBedOccupancySummary: build.query<WardOccupancySummary[], void>({
      query: () => '/api/ipd/bed-occupancy',
      transformResponse: (raw: ApiSuccess<WardOccupancySummary[]>) => raw.data,
      providesTags: ['IPD'],
    }),

    getOccupancySummary: build.query<WardOccupancySummary[], void>({
      query: () => '/api/ipd/occupancy',
      transformResponse: (raw: ApiSuccess<WardOccupancySummary[]>) => raw.data,
      providesTags: ['IPD'],
    }),
  }),
});

export const {
  useGetAdmissionByIdQuery,
  useListWardsQuery,
  useCreateWardMutation,
  useListBedsQuery,
  useAddBedsMutation,
  useListAdmissionsQuery,
  useCreateAdmissionMutation,
  useUpdateAdmissionMutation,
  useAddProgressNoteMutation,
  useDischargePatientMutation,
  useGetIPDPatientHistoryQuery,
  useGetBedOccupancySummaryQuery,
  useGetOccupancySummaryQuery,
} = ipdApi;
