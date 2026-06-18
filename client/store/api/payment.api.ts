import { baseApi } from './base.api';

// The backend Zod schema requires full ISO datetime strings (z.string().datetime({ offset: true })).
// HTML date inputs produce plain YYYY-MM-DD strings, so we convert here before sending.
function toStartOfDay(date: string) { return new Date(date + 'T00:00:00').toISOString(); }
function toEndOfDay(date: string)   { return new Date(date + 'T23:59:59.999').toISOString(); }

import type {
  ApiSuccess,
  PaymentResponse,
  PaymentListResult,
  PaymentSummaryResponse,
  CreateManualPaymentRequest,
  CreateRazorpayOrderRequest,
  RazorpayOrderResponse,
} from '../types';

export const paymentApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    listPayments: build.query<
      PaymentListResult,
      { patientId?: string; dateFrom?: string; dateTo?: string; paymentMethod?: string; page?: number; limit?: number }
    >({
      query: ({ patientId, dateFrom, dateTo, paymentMethod, page = 1, limit = 20 } = {}) => {
        const params = new URLSearchParams();
        if (patientId)      params.set('patientId',      patientId);
        if (dateFrom)       params.set('dateFrom',       toStartOfDay(dateFrom));
        if (dateTo)         params.set('dateTo',         toEndOfDay(dateTo));
        if (paymentMethod)  params.set('paymentMethod',  paymentMethod);
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
      invalidatesTags: ['Payment'],
    }),

    createRazorpayOrder: build.mutation<RazorpayOrderResponse, CreateRazorpayOrderRequest>({
      query: (body) => ({ url: '/api/payments/razorpay-order', method: 'POST', body }),
      transformResponse: (raw: ApiSuccess<RazorpayOrderResponse>) => raw.data,
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
      providesTags: ['Payment'],
    }),
  }),
});

export const {
  useListPaymentsQuery,
  useCreateManualPaymentMutation,
  useCreateRazorpayOrderMutation,
  useLazyGetReceiptUrlQuery,
  useGetPaymentSummaryQuery,
} = paymentApi;
