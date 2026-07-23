import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDQueueQuery: () => ({ data: [], isFetching: false, refetch: jest.fn() }),
  useCreateOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useCompleteOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useCancelOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useListPaymentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: undefined }),
}));

let mockRole = 'RECEPTIONIST';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import OPDPage from '@/app/(dashboard)/opd/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OPDPage — New Visit role gating', () => {
  test('RECEPTIONIST sees the New Visit button', () => {
    mockRole = 'RECEPTIONIST';
    render(<OPDPage />);
    expect(screen.getByRole('button', { name: /new visit/i })).toBeInTheDocument();
  });

  test('DOCTOR does not see the New Visit button', () => {
    mockRole = 'DOCTOR';
    render(<OPDPage />);
    expect(screen.queryByRole('button', { name: /new visit/i })).not.toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN sees the New Visit button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<OPDPage />);
    expect(screen.getByRole('button', { name: /new visit/i })).toBeInTheDocument();
  });

  test('NURSE does not see the New Visit button', () => {
    mockRole = 'NURSE';
    render(<OPDPage />);
    expect(screen.queryByRole('button', { name: /new visit/i })).not.toBeInTheDocument();
  });
});
