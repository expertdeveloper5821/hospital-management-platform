import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from '@reduxjs/toolkit/query/react';
import type { RootState } from '../index';
import { toastError, toastSuccess } from '@/lib/toast';

type BackendSuccess = {
  status?: string;
  data?: unknown;
  message?: string;
};

type BackendError = {
  message?: string;
  error?: string;
};

const endpointSuccessMessages: Record<string, string> = {
  login: 'Signed in successfully.',
  superAdminLogin: 'Signed in successfully.',
  changePassword: 'Password updated successfully.',
  forgotPassword: 'Password reset link sent.',
  resetPassword: 'Password reset successfully.',
  completeSetup: 'Setup completed successfully.',
  logout: 'Signed out successfully.',
};

const quietSuccessEndpoints = new Set([
  'createRazorpayOrder',
  'markNotificationRead',
]);

function extractErrorMessage(error: FetchBaseQueryError) {
  const data = error.data as BackendError | string | undefined;
  if (typeof data === 'string') return data;
  return data?.message ?? data?.error ?? 'Something went wrong. Please try again.';
}

function getSuccessMessage(endpoint: string, data: BackendSuccess) {
  if (endpointSuccessMessages[endpoint]) return endpointSuccessMessages[endpoint];

  const messageFromBody =
    data.message ??
    (typeof data.data === 'object' && data.data !== null && 'message' in data.data
      ? String((data.data as { message?: unknown }).message)
      : undefined);

  return messageFromBody || 'Saved successfully.';
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001',
  prepareHeaders(headers, { getState }) {
    const token = (getState() as RootState).auth.token;
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return headers;
  },
});

const baseQueryWithToasts: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (api.type !== 'mutation') return result;

  if ('error' in result && result.error) {
    toastError('Request failed', extractErrorMessage(result.error));
    return result;
  }

  const data = result.data as BackendSuccess | undefined;
  if (data?.status === 'success' && !quietSuccessEndpoints.has(api.endpoint)) {
    toastSuccess(getSuccessMessage(api.endpoint, data));
  }

  return result;
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithToasts,
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
    'Dashboard',
    'PlatformSettings',
    'Package',
    'PackageAssignment',
    'Charge',
    'Bill',
    'StaffDocument',
    'StaffIdCard',
    'Department',
  ],
  endpoints: () => ({}),
});
