import { baseApi } from './base.api';
import { type FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type { RootState } from '../index';

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

// The backend Zod schema requires full ISO datetime strings (z.string().datetime({ offset: true })).
// HTML date inputs produce plain YYYY-MM-DD strings, so we convert here before sending.
function toStartOfDay(date: string) { return new Date(date + 'T00:00:00').toISOString(); }
function toEndOfDay(date: string)   { return new Date(date + 'T23:59:59.999').toISOString(); }

import type {
  ApiSuccess,
  PaymentResponse,
  PaymentListResult,
  PaymentSummaryResponse,
  DepartmentRevenueResponse,
  CreateManualPaymentRequest,
  CreateRazorpayOrderRequest,
  RazorpayOrderResponse,
  PaymentExportRequest,
} from '../types';

export const paymentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listPayments: build.query<
      PaymentListResult,
      { patientId?: string; dateFrom?: string; dateTo?: string; paymentMethod?: string; status?: string; referenceType?: string; referenceId?: string; page?: number; limit?: number }
    >({
      query: ({ patientId, dateFrom, dateTo, paymentMethod, status, referenceType, referenceId, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId)      params.set('patientId',      patientId);
        if (dateFrom)       params.set('dateFrom',       toStartOfDay(dateFrom));
        if (dateTo)         params.set('dateTo',         toEndOfDay(dateTo));
        if (paymentMethod)  params.set('paymentMethod',  paymentMethod);
        if (status)         params.set('status',         status);
        if (referenceType)  params.set('referenceType',  referenceType);
        if (referenceId)    params.set('referenceId',    referenceId);
        params.set('page',  String(page));
        params.set('limit', String(limit));
        return `/api/payments?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<PaymentListResult>) => raw.data,
      providesTags: ['Payment'],
    }),

    createManualPayment: build.mutation<PaymentResponse, CreateManualPaymentRequest>({
      query: (body) => ({ url: '/api/payments/manual', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Payment', 'Revenue'],
    }),

    createRazorpayOrder: build.mutation<RazorpayOrderResponse, CreateRazorpayOrderRequest>({
      query: (body) => ({ url: '/api/payments/razorpay-order', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<RazorpayOrderResponse>) => raw.data,
    }),

    // Confirm a successful Razorpay checkout (signature verified server-side).
    verifyRazorpayPayment: build.mutation<PaymentResponse, { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }>({
      query: (body) => ({ url: '/api/payments/razorpay/verify', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Payment', 'Revenue'],
    }),

    // Mark an abandoned Razorpay checkout as CANCELLED (user dismissed the modal).
    cancelRazorpayOrder: build.mutation<PaymentResponse, { razorpayOrderId: string }>({
      query: (body) => ({ url: '/api/payments/razorpay/cancel', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<PaymentResponse>) => raw.data,
      invalidatesTags: ['Payment', 'Revenue'],
    }),

    getReceiptUrl: build.query<string, string>({
      query: (paymentId) => `/api/payments/${paymentId}/receipt`,
      transformResponse: (raw: ApiSuccess<{ receiptUrl: string }>) => raw.data.receiptUrl,
    }),

    getPaymentSummary: build.query<
      PaymentSummaryResponse,
      { dateFrom?: string; dateTo?: string }
    >({
      query: ({ dateFrom, dateTo } = {}) => {
        const params = new URLSearchParams();
        if (dateFrom) params.set('dateFrom', toStartOfDay(dateFrom));
        if (dateTo)   params.set('dateTo',   toEndOfDay(dateTo));
        return `/api/payments/summary?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<PaymentSummaryResponse>) => raw.data,
      // Finance summaries are role-scoped reads (§5.2.1): 'Revenue' separates
      // them from raw payment rows so payment mutations can invalidate both
      // without also refetching every other summary consumer.
      providesTags: ['Payment', 'Revenue'],
    }),

    // Revenue broken down by department — same filter set as the payments
    // list (dateFrom/dateTo/method/status), so it can mirror whatever the
    // Payments page table is currently filtered to.
    getDepartmentRevenue: build.query<
      DepartmentRevenueResponse,
      { dateFrom?: string; dateTo?: string; paymentMethod?: string; status?: string }
    >({
      query: ({ dateFrom, dateTo, paymentMethod, status } = {}) => {
        const params = new URLSearchParams();
        if (dateFrom)      params.set('dateFrom',      toStartOfDay(dateFrom));
        if (dateTo)        params.set('dateTo',        toEndOfDay(dateTo));
        if (paymentMethod) params.set('paymentMethod', paymentMethod);
        if (status)        params.set('status',        status);
        return `/api/payments/summary/by-department?${params.toString()}`;
      },
      transformResponse: (raw: ApiSuccess<DepartmentRevenueResponse>) => raw.data,
      providesTags: ['Payment', 'Revenue'],
    }),

    // Payment Export — downloads the collection-report CSV. Dates are sent as
    // plain YYYY-MM-DD hospital (IST) calendar days; the server resolves the
    // range, so the browser's own timezone never shifts it. Uses queryFn
    // because the endpoint returns a raw file, not JSON.
    exportPayments: build.mutation<{ url: string; filename: string }, PaymentExportRequest>({
      queryFn: async ({ period, date, dateFrom, dateTo }, { getState }) => {
        const token = (getState() as RootState).auth.token;
        const params = new URLSearchParams({ period });
        if (date)     params.set('date',     date);
        if (dateFrom) params.set('dateFrom', dateFrom);
        if (dateTo)   params.set('dateTo',   dateTo);
        try {
          const res = await fetch(`${BASE_URL}/api/payments/export?${params.toString()}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache:   'no-store',
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const err: FetchBaseQueryError = {
              status: res.status,
              data:   { message: body?.message ?? 'Failed to export payments' },
            };
            return { error: err };
          }
          const match    = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
          const filename = match?.[1] ?? `payments-${period.toLowerCase()}.csv`;
          const blob     = await res.blob();
          return { data: { url: URL.createObjectURL(blob), filename } };
        } catch {
          const err: FetchBaseQueryError = { status: 'FETCH_ERROR', error: 'Network error' };
          return { error: err };
        }
      },
    }),
  }),
});

export const {
  useListPaymentsQuery,
  useCreateManualPaymentMutation,
  useCreateRazorpayOrderMutation,
  useVerifyRazorpayPaymentMutation,
  useCancelRazorpayOrderMutation,
  useLazyGetReceiptUrlQuery,
  useGetPaymentSummaryQuery,
  useGetDepartmentRevenueQuery,
  useExportPaymentsMutation,
} = paymentApi;
