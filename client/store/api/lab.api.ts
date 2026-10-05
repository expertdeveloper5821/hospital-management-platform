import { baseApi } from './base.api';
import { type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { RootState } from '../index';
import type {
  ApiSuccess,
  PathologyRequestResponse,
  RadiologyRequestResponse,
  CreatePathologyRequest,
  CreateRadiologyRequest,
  EditPathologyRequest,
  EditRadiologyRequest,
  LabListResult,
  LabTestTypeResponse,
  CollectLabPaymentRequest,
  PaymentResponse,
  SubmitPathologyTestReportRequest,
} from '../types';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

// List filters. date / visitDate / admissionDate are YYYY-MM-DD (date matches
// the encounter's own date: OPD visit date or IPD admission date); they and wardName /
// bedNumber match the OPD visit / IPD admission each request is linked to.
interface LabListParams {
  patientId?:     string;
  status?:        string;
  search?:        string;
  date?:          string;
  visitDate?:     string;
  admissionDate?: string;
  wardName?:      string;
  bedNumber?:     string;
  page?:          number;
  limit?:         number;
}

export const labApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // ─── Pathology ────────────────────────────────────────────────────────────

    listPathologyRequests: build.query<
      LabListResult<PathologyRequestResponse>,
      LabListParams
    >({
      query: ({ patientId, status, search, date, visitDate, admissionDate, wardName, bedNumber, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId)     params.set('patientId',     patientId);
        if (status)        params.set('status',        status);
        if (search)        params.set('search',        search);
        if (date)          params.set('date',          date);
        if (visitDate)     params.set('visitDate',     visitDate);
        if (admissionDate) params.set('admissionDate', admissionDate);
        if (wardName)      params.set('wardName',      wardName);
        if (bedNumber)     params.set('bedNumber',     bedNumber);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/lab/pathology?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<LabListResult<PathologyRequestResponse>>) => raw.data,
      providesTags: ['Lab'],
    }),

    getPathologyRequest: build.query<PathologyRequestResponse, string>({
      query: (requestId) => `/api/lab/pathology/${requestId}`,
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      providesTags: ['Lab'],
    }),

    createPathologyRequest: build.mutation<PathologyRequestResponse, CreatePathologyRequest>({
      query: (body) => ({ url: '/api/lab/pathology', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    uploadPathologyReport: build.mutation<
      PathologyRequestResponse,
      { requestId: string; file: File }
    >({
      query: ({ requestId, file }) => {
        const formData = new FormData();
        formData.append('report', file);
        return { url: `/api/lab/pathology/${requestId}/report`, method: 'PATCH', body: formData };
      },
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    // ─── Structured Pathology test reports (online-only) ─────────────────────

    // Submits — or amends — one test's structured results (lab staff only).
    submitPathologyTestReport: build.mutation<
      PathologyRequestResponse,
      { requestId: string; testIndex: number } & SubmitPathologyTestReportRequest
    >({
      query: ({ requestId, testIndex, ...body }) => ({
        url: `/api/lab/pathology/${requestId}/reports/${testIndex}`, method: 'PUT', body,
      }),
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    // One test's report PDF as a blob object URL (the endpoint returns a raw
    // PDF, not JSON) — same queryFn pattern as ipd.api's downloadDischargeSummary.
    getPathologyTestReportPdf: build.mutation<string, { requestId: string; testIndex: number }>({
      queryFn: async ({ requestId, testIndex }, { getState }) => {
        const token = (getState() as RootState).auth.token;
        try {
          const res = await fetch(`${BASE_URL}/api/lab/pathology/${requestId}/reports/${testIndex}/pdf`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) {
            const err: FetchBaseQueryError = { status: res.status, data: 'Failed to load the report PDF' };
            return { error: err };
          }
          const blob = await res.blob();
          return { data: URL.createObjectURL(blob) };
        } catch {
          const err: FetchBaseQueryError = { status: 'FETCH_ERROR', error: 'Network error' };
          return { error: err };
        }
      },
    }),

    // ─── Radiology ────────────────────────────────────────────────────────────

    listRadiologyRequests: build.query<
      LabListResult<RadiologyRequestResponse>,
      LabListParams
    >({
      query: ({ patientId, status, search, date, visitDate, admissionDate, wardName, bedNumber, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId)     params.set('patientId',     patientId);
        if (status)        params.set('status',        status);
        if (search)        params.set('search',        search);
        if (date)          params.set('date',          date);
        if (visitDate)     params.set('visitDate',     visitDate);
        if (admissionDate) params.set('admissionDate', admissionDate);
        if (wardName)      params.set('wardName',      wardName);
        if (bedNumber)     params.set('bedNumber',     bedNumber);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/lab/radiology?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<LabListResult<RadiologyRequestResponse>>) => raw.data,
      providesTags: ['Lab'],
    }),

    getRadiologyRequest: build.query<RadiologyRequestResponse, string>({
      query: (requestId) => `/api/lab/radiology/${requestId}`,
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      providesTags: ['Lab'],
    }),

    createRadiologyRequest: build.mutation<RadiologyRequestResponse, CreateRadiologyRequest>({
      query: (body) => ({ url: '/api/lab/radiology', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    uploadRadiologyReport: build.mutation<
      RadiologyRequestResponse,
      { requestId: string; file: File }
    >({
      query: ({ requestId, file }) => {
        const formData = new FormData();
        formData.append('report', file);
        return { url: `/api/lab/radiology/${requestId}/report`, method: 'PATCH', body: formData };
      },
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    // ─── Edit & Delete ────────────────────────────────────────────────────────

    editPathologyRequest: build.mutation<
      PathologyRequestResponse,
      { requestId: string } & EditPathologyRequest
    >({
      query: ({ requestId, ...body }) => ({ url: `/api/lab/pathology/${requestId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<PathologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    deletePathologyRequest: build.mutation<{ message: string }, string>({
      query: (requestId) => ({ url: `/api/lab/pathology/${requestId}`, method: 'DELETE' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    editRadiologyRequest: build.mutation<
      RadiologyRequestResponse,
      { requestId: string } & EditRadiologyRequest
    >({
      query: ({ requestId, ...body }) => ({ url: `/api/lab/radiology/${requestId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<RadiologyRequestResponse>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    deleteRadiologyRequest: build.mutation<{ message: string }, string>({
      query: (requestId) => ({ url: `/api/lab/radiology/${requestId}`, method: 'DELETE' }),
      transformResponse: (raw: ApiSuccess<{ message: string }>) => raw.data,
      invalidatesTags: ['Lab'],
    }),

    // ─── Payment collection (online-only — no offline outbox policy) ─────────

    collectPathologyPayment: build.mutation<
      PaymentResponse,
      { requestId: string } & CollectLabPaymentRequest
    >({
      query: ({ requestId, ...body }) => ({ url: `/api/lab/pathology/${requestId}/payment`, method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Lab', 'Payment'],
    }),

    collectRadiologyPayment: build.mutation<
      PaymentResponse,
      { requestId: string } & CollectLabPaymentRequest
    >({
      query: ({ requestId, ...body }) => ({ url: `/api/lab/radiology/${requestId}/payment`, method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Lab', 'Payment'],
    }),

    // ─── Test types ───────────────────────────────────────────────────────────
    // Feeds the Billing → Add Charge form's Test Type dropdown when category is LAB_TEST.
    listLabTestTypes: build.query<LabTestTypeResponse[], void>({
      query: () => '/api/lab/test-types',
      transformResponse: (raw: ApiSuccess<LabTestTypeResponse[]>) => raw.data,
      providesTags: ['Lab'],
    }),
  }),
});

export const {
  useListPathologyRequestsQuery,
  useGetPathologyRequestQuery,
  useCreatePathologyRequestMutation,
  useUploadPathologyReportMutation,
  useEditPathologyRequestMutation,
  useDeletePathologyRequestMutation,
  useListRadiologyRequestsQuery,
  useGetRadiologyRequestQuery,
  useCreateRadiologyRequestMutation,
  useUploadRadiologyReportMutation,
  useEditRadiologyRequestMutation,
  useDeleteRadiologyRequestMutation,
  useListLabTestTypesQuery,
  useCollectPathologyPaymentMutation,
  useCollectRadiologyPaymentMutation,
  useSubmitPathologyTestReportMutation,
  useGetPathologyTestReportPdfMutation,
} = labApi;
