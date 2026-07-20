import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: [], isLoading: false }),
  useListBedsQuery: () => ({ data: [] }),
  useListAdmissionsQuery: () => ({ data: { data: [], total: 0, totalPages: 1 }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useAddProgressNoteMutation: () => [jest.fn(), { isLoading: false }],
  useDischargePatientMutation: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useListPaymentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
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

import IPDPage from '@/app/(dashboard)/ipd/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('IPDPage — New Admission role gating', () => {
  test('RECEPTIONIST sees the New Admission button', () => {
    mockRole = 'RECEPTIONIST';
    render(<IPDPage />);
    expect(screen.getByRole('button', { name: /new admission/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN sees the New Admission button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<IPDPage />);
    expect(screen.getByRole('button', { name: /new admission/i })).toBeInTheDocument();
  });

  test('ADMIN does not see the New Admission button', () => {
    mockRole = 'ADMIN';
    render(<IPDPage />);
    expect(screen.queryByRole('button', { name: /new admission/i })).not.toBeInTheDocument();
  });

  test('NURSE does not see the New Admission button', () => {
    mockRole = 'NURSE';
    render(<IPDPage />);
    expect(screen.queryByRole('button', { name: /new admission/i })).not.toBeInTheDocument();
  });
});
