import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/payment.api', () => ({
  useListPaymentsQuery:            () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreateManualPaymentMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useVerifyRazorpayPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCancelRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useLazyGetReceiptUrlQuery:       () => [jest.fn(), { isFetching: false }],
  useGetPaymentSummaryQuery:       () => ({ data: undefined, isFetching: false }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useLazySearchPatientsQuery: () => [jest.fn(), { data: undefined, isFetching: false }],
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import PaymentsPage from '@/app/(dashboard)/payments/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentsPage — role access gating', () => {
  test('ADMIN can access the Payments page and sees the Record Payment action', () => {
    mockRole = 'ADMIN';
    render(<PaymentsPage />);
    expect(screen.queryByText(/you do not have access to the payments module/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /payments/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN can still access the Payments page (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<PaymentsPage />);
    expect(screen.queryByText(/you do not have access to the payments module/i)).not.toBeInTheDocument();
  });

  test('DOCTOR still has no Payments page access (unchanged)', () => {
    mockRole = 'DOCTOR';
    render(<PaymentsPage />);
    expect(screen.getByText(/you do not have access to the payments module/i)).toBeInTheDocument();
  });
});
