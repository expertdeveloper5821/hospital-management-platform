import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { RootState } from '../index';

console.log("url:", process.env.NEXT_PUBLIC_API_URL);
export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001',
    prepareHeaders(headers, { getState }) {
      const token = (getState() as RootState).auth.token;
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return headers;
    },
  }),
  tagTypes: [
    'Auth',
    'Tenant',
    'User',
    'Patient',
    'OPD',
    'IPD',
    'Lab',
    'Inventory',
    'Payment',
    'Notification',
    'Audit',
  ],
  endpoints: () => ({}),
});
