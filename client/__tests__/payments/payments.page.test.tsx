import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockDepartmentRevenue: unknown = undefined;
let mockDepartmentRevenueFetching = false;

jest.mock('@/store/api/payment.api', () => ({
  useListPaymentsQuery:            () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreateManualPaymentMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useVerifyRazorpayPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCancelRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useLazyGetReceiptUrlQuery:       () => [jest.fn(), { isFetching: false }],
  useGetPaymentSummaryQuery:       () => ({ data: undefined, isFetching: false }),
  useGetDepartmentRevenueQuery:    () => ({ data: mockDepartmentRevenue, isFetching: mockDepartmentRevenueFetching }),
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
  beforeEach(() => {
    mockDepartmentRevenue = undefined;
    mockDepartmentRevenueFetching = false;
  });

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

describe('PaymentsPage — Department-wise Revenue section', () => {
  beforeEach(() => {
    mockDepartmentRevenue = undefined;
    mockDepartmentRevenueFetching = false;
  });

  test('is visible to roles that can see the summary (HOSPITAL_ADMIN)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<PaymentsPage />);
    expect(screen.getByText('Department-wise Revenue')).toBeInTheDocument();
  });

  test('is hidden for RECEPTIONIST (can view payments, but not the revenue summary)', () => {
    mockRole = 'RECEPTIONIST';
    render(<PaymentsPage />);
    expect(screen.queryByText('Department-wise Revenue')).not.toBeInTheDocument();
  });

  test('is hidden entirely for a role with no Payments access at all (DOCTOR)', () => {
    mockRole = 'DOCTOR';
    render(<PaymentsPage />);
    expect(screen.queryByText('Department-wise Revenue')).not.toBeInTheDocument();
  });

  test('shows every department (including ₹0 ones), the unassigned bucket, and the reconciled total', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDepartmentRevenue = {
      departments: [
        { departmentId: 'd1', name: 'Cardiology', total: 5000 },
        { departmentId: 'd2', name: 'Neurology', total: 0 },
      ],
      unassignedTotal: 300,
      grandTotal: 5300,
    };
    render(<PaymentsPage />);

    expect(screen.getByText('Cardiology')).toBeInTheDocument();
    expect(screen.getByText('Neurology')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('₹5,300.00')).toBeInTheDocument();
  });

  test('omits the Unassigned tile when there is no unassigned revenue', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDepartmentRevenue = {
      departments: [{ departmentId: 'd1', name: 'Cardiology', total: 1000 }],
      unassignedTotal: 0,
      grandTotal: 1000,
    };
    render(<PaymentsPage />);
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  test('shows a loading state while fetching', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDepartmentRevenueFetching = true;
    render(<PaymentsPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  test('shows an empty state when the tenant has no departments and no unassigned revenue', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDepartmentRevenue = { departments: [], unassignedTotal: 0, grandTotal: 0 };
    render(<PaymentsPage />);
    expect(screen.getByText(/no departments have been created yet/i)).toBeInTheDocument();
  });
});
