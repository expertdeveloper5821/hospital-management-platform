import { baseApi } from './base.api';
import { type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { RootState } from '../index';
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

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

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

    assignNursesToWard: build.mutation<WardResponse, { wardId: string; nurseIds: string[] }>({
      query: ({ wardId, nurseIds }) => ({
        url:    `/api/ipd/wards/${wardId}/nurses`,
        method: 'PATCH',
        body:   { nurseIds },
      }),
      transformResponse: (raw: ApiSuccess<WardResponse>) => raw.data,
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

    // Downloads the Discharge Summary PDF (only available once DISCHARGED);
    // returns a blob object URL for the <a> tag. Uses queryFn because the
    // endpoint returns a raw PDF, not JSON — same pattern as downloadMedicalCard.
    downloadDischargeSummary: build.mutation<string, string>({
      queryFn: async (admissionId, { getState }) => {
        const token = (getState() as RootState).auth.token;
        try {
          const res = await fetch(`${BASE_URL}/api/ipd/admissions/${admissionId}/discharge-summary`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            const err: FetchBaseQueryError = { status: res.status, data: 'Failed to download discharge summary' };
            return { error: err };
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          return { data: url };
        } catch {
          const err: FetchBaseQueryError = { status: 'FETCH_ERROR', error: 'Network error' };
          return { error: err };
        }
      },
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
  useAssignNursesToWardMutation,
  useListAdmissionsQuery,
  useCreateAdmissionMutation,
  useUpdateAdmissionMutation,
  useAddProgressNoteMutation,
  useDischargePatientMutation,
  useDownloadDischargeSummaryMutation,
  useGetIPDPatientHistoryQuery,
  useGetBedOccupancySummaryQuery,
  useGetOccupancySummaryQuery,
} = ipdApi;
