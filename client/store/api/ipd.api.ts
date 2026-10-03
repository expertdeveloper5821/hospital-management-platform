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
  IPDVitals,
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

    // Paginated + searchable list for the Wards page. listWards above stays the
    // unpaginated source for every ward dropdown (IPD, OPD, Packages, …).
    listWardsPaginated: build.query<
      PaginatedResult<WardResponse>,
      { search?: string; page?: number; limit?: number }
    >({
      query: ({ search, page = 1, limit = 20 }) => {
        const params = new URLSearchParams();
        if (search) params.set('search', search);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/ipd/wards?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<PaginatedResult<WardResponse>>) => raw.data,
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
      // Receptionist-only patient correction (the backend rejects it from
      // every other role); a Receptionist may send only patientId + vitals.
      patientId?:        string;
      assignedDoctorIds?: string[];
      wardId?:           string;
      bedId?:            string;
      // Partial — only the sub-fields present are merged onto the
      // admission's existing vitals server-side (see
      // IPDService.updateAdmission); omitting a sub-field leaves it
      // untouched, sending `null` explicitly clears it.
      vitals?:           Partial<IPDVitals>;
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
      invalidatesTags: ['IPD'], // vitals are per admission — never written to OPD visits
    }),

    // Receptionist-only permanent delete of a still-ADMITTED admission; the
    // backend releases the bed and cancels the admission's payment(s) in the
    // same transaction, so payment lists must refetch too.
    deleteAdmission: build.mutation<void, string>({
      query: (admissionId) => {
        if (!admissionId) throw new Error('admissionId is required');
        return { url: `/api/ipd/admissions/${admissionId}`, method: 'DELETE' };
      },
      invalidatesTags: ['IPD', 'Payment'],
    }),

    // Hospital Admin, the admission's assigned Doctor(s), or a Nurse on its
    // ward only — the backend refuses anyone else with 403.
    updateAdmissionPrescription: build.mutation<AdmissionResponse, { admissionId: string; prescription: string }>({
      query: ({ admissionId, prescription }) => {
        if (!admissionId) throw new Error('admissionId is required');
        return {
          url:    `/api/ipd/admissions/${admissionId}/prescription`,
          method: 'PATCH',
          body:   { prescription },
        };
      },
      transformResponse: (raw: ApiSuccess<AdmissionResponse>) => raw.data,
      invalidatesTags: ['IPD'],
    }),

    // Final discharge — dischargeSummaryNotes is required and saved on the
    // admission (and printed on the Discharge Summary PDF).
    dischargePatient: build.mutation<AdmissionResponse, { admissionId: string; dischargeSummaryNotes: string }>({
      query: ({ admissionId, dischargeSummaryNotes }) => {
        // Defensive guard: an empty admissionId would produce the URL
        // /api/ipd/admissions//discharge (double-slash) which hits the 404 handler.
        if (!admissionId) {
          throw new Error('admissionId is required for discharge');
        }
        return {
          url:    `/api/ipd/admissions/${admissionId}/discharge`,
          method: 'PATCH',
          body:   { dischargeSummaryNotes },
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

    // GET /api/ipd/admissions/:admissionId/parcha-pdf — the uploaded PDF
    // parcha template merged with this admission's data, server-side. Only
    // meaningful when the hospital's parcha template is a PDF
    // (branding.parchaTemplateUrl ends in .pdf); responds 404 otherwise,
    // which the print page treats as "fall back to the existing image/default
    // layout". Returns a blob object URL for an <iframe> — same queryFn
    // pattern as downloadDischargeSummary above.
    getIPDParchaPdf: build.mutation<string, string>({
      queryFn: async (admissionId, { getState }) => {
        const token = (getState() as RootState).auth.token;
        try {
          const res = await fetch(`${BASE_URL}/api/ipd/admissions/${admissionId}/parcha-pdf`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            const err: FetchBaseQueryError = { status: res.status, data: 'No PDF parcha template available' };
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
  useListWardsPaginatedQuery,
  useCreateWardMutation,
  useListBedsQuery,
  useAddBedsMutation,
  useAssignNursesToWardMutation,
  useListAdmissionsQuery,
  useCreateAdmissionMutation,
  useUpdateAdmissionMutation,
  useDeleteAdmissionMutation,
  useAddProgressNoteMutation,
  useUpdateAdmissionPrescriptionMutation,
  useDischargePatientMutation,
  useDownloadDischargeSummaryMutation,
  useGetIPDParchaPdfMutation,
  useGetIPDPatientHistoryQuery,
  useGetBedOccupancySummaryQuery,
  useGetOccupancySummaryQuery,
} = ipdApi;
