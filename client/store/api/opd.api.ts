import { baseApi } from './base.api';
import { type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { RootState } from '../index';
import type {
  ApiSuccess,
  OPDVisitResponse,
  OPDPatientHistory,
  CreateOPDVisitRequest,
  UpdateOPDVisitRequest,
  CompleteOPDVisitRequest,
  OPDPaymentValidityResponse,
  DoctorNurseAssignmentsResponse,
  AvailableOpdNurseResponse,
} from '../types';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

export const opdApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    getOPDQueue: build.query<OPDVisitResponse[], { date?: string; doctorId?: string; search?: string }>({
      query: ({ date, doctorId, search } = {}) => {
        const params = new URLSearchParams();
        if (date)     params.set('date',     date);
        if (doctorId) params.set('doctorId', doctorId);
        if (search)   params.set('search',   search);
        const qs = params.toString();
        return `/api/opd/visits${qs ? `?${qs}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<OPDVisitResponse[]>) => raw.data,
      providesTags: ['OPD'],
    }),

    getOPDVisitById: build.query<OPDVisitResponse, string>({
      query: (visitId) => `/api/opd/visits/${visitId}`,
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      providesTags: ['OPD'],
    }),

    createOPDVisit: build.mutation<OPDVisitResponse, CreateOPDVisitRequest>({
      query: (body) => ({ url: '/api/opd/visits', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    updateOPDVisit: build.mutation<OPDVisitResponse, { visitId: string } & UpdateOPDVisitRequest>({
      query: ({ visitId, ...body }) => ({ url: `/api/opd/visits/${visitId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    startOPDConsultation: build.mutation<OPDVisitResponse, string>({
      query: (visitId) => ({ url: `/api/opd/visits/${visitId}/start`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    completeOPDVisit: build.mutation<OPDVisitResponse, { visitId: string } & CompleteOPDVisitRequest>({
      query: ({ visitId, ...body }) => ({ url: `/api/opd/visits/${visitId}/complete`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    cancelOPDVisit: build.mutation<OPDVisitResponse, string>({
      query: (visitId) => ({ url: `/api/opd/visits/${visitId}/cancel`, method: 'PATCH' }),
      transformResponse: (raw: ApiSuccess<OPDVisitResponse>) => raw.data,
      invalidatesTags: ['OPD'],
    }),

    getOPDPatientHistory: build.query<OPDPatientHistory, {
      patientId:  string;
      page?:      number;
      limit?:     number;
      startDate?: string;
      endDate?:   string;
      status?:    'OPEN' | 'COMPLETED';
      search?:    string;
    }>({
      query: ({ patientId, page = 1, limit = 10, startDate, endDate, status, search }) => {
        const params = new URLSearchParams({ page: String(page), limit: String(limit) });
        if (startDate) params.set('startDate', startDate);
        if (endDate)   params.set('endDate',   endDate);
        if (status)    params.set('status',    status);
        if (search)    params.set('search',    search);
        return `/api/opd/patients/${patientId}/history?${params}`;
      },
      transformResponse: (raw: ApiSuccess<OPDPatientHistory>) => raw.data,
      providesTags: ['OPD'],
    }),

    // GET /api/opd/patients/:patientId/payment-validity — consulted by the New
    // OPD Visit form right after a patient is selected, and re-consulted as
    // doctors are added/removed (validity is doctor-specific, not just
    // patient-specific); backend is the sole authority on whether a new OPD
    // payment is required.
    getOPDPaymentValidity: build.query<OPDPaymentValidityResponse, { patientId: string; doctorIds?: string[] }>({
      query: ({ patientId, doctorIds }) => {
        const params = new URLSearchParams();
        if (doctorIds && doctorIds.length) params.set('doctorIds', doctorIds.join(','));
        const qs = params.toString();
        return `/api/opd/patients/${patientId}/payment-validity${qs ? `?${qs}` : ''}`;
      },
      transformResponse: (raw: ApiSuccess<OPDPaymentValidityResponse>) => raw.data,
      providesTags: ['OPD', 'Payment'],
    }),

    // GET /api/opd/nurses/available — nurses eligible for OPD duty (excludes
    // anyone currently on an IPD ward roster). Tagged with 'User' so creating a
    // nurse via the Users page (createUser invalidates 'User') refreshes this
    // list without a manual re-fetch.
    getAvailableOpdNurses: build.query<AvailableOpdNurseResponse[], void>({
      query: () => '/api/opd/nurses/available',
      transformResponse: (raw: ApiSuccess<AvailableOpdNurseResponse[]>) => raw.data,
      providesTags: ['OPD', 'User'],
    }),

    // GET /api/opd/doctors/:doctorId/nurse-assignment — every nurse currently
    // mapped to the doctor for OPD duty. Consulted by the New OPD Visit form
    // whenever the selected doctor changes.
    getDoctorNurseAssignments: build.query<DoctorNurseAssignmentsResponse, string>({
      query: (doctorId) => `/api/opd/doctors/${doctorId}/nurse-assignment`,
      transformResponse: (raw: ApiSuccess<DoctorNurseAssignmentsResponse>) => raw.data,
      providesTags: ['OPD'],
    }),

    // GET /api/opd/visits/:visitId/parcha-pdf — the uploaded PDF parcha
    // template merged with this visit's data, server-side. Only meaningful
    // when the hospital's parcha template is a PDF (branding.parchaTemplateUrl
    // ends in .pdf); responds 404 otherwise, which the print page treats as
    // "fall back to the existing image/default layout". Returns a blob object
    // URL for an <iframe>, not JSON — same queryFn pattern as
    // downloadDischargeSummary (ipd.api.ts).
    getOPDParchaPdf: build.mutation<string, string>({
      queryFn: async (visitId, { getState }) => {
        const token = (getState() as RootState).auth.token;
        try {
          const res = await fetch(`${BASE_URL}/api/opd/visits/${visitId}/parcha-pdf`, {
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
  }),
});

export const {
  useGetOPDQueueQuery,
  useGetOPDVisitByIdQuery,
  useCreateOPDVisitMutation,
  useUpdateOPDVisitMutation,
  useStartOPDConsultationMutation,
  useCompleteOPDVisitMutation,
  useCancelOPDVisitMutation,
  useGetOPDPatientHistoryQuery,
  useGetOPDPaymentValidityQuery,
  useGetAvailableOpdNursesQuery,
  useGetDoctorNurseAssignmentsQuery,
  useGetOPDParchaPdfMutation,
} = opdApi;
