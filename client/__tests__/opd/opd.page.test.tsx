import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetOPDPaymentValidity = jest.fn();
const mockSearchPatients        = jest.fn();

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDQueueQuery: () => ({ data: [], isFetching: false, refetch: jest.fn() }),
  useCreateOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useCompleteOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  useCancelOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  // Mirrors RTK Query's real `skip` behaviour (data is undefined until a
  // patient is actually selected) so the component's "reset on patient
  // change" and "sync to validity result" effects interact the same way
  // they would against the real hook.
  useGetOPDPaymentValidityQuery: (args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
    mockGetOPDPaymentValidity(args, options),
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useListPaymentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: (...args: unknown[]) => mockSearchPatients(...args),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: [] }),
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
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.getByRole('button', { name: /new visit/i })).toBeInTheDocument();
  });

  test('DOCTOR does not see the New Visit button', () => {
    mockRole = 'DOCTOR';
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.queryByRole('button', { name: /new visit/i })).not.toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN sees the New Visit button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.getByRole('button', { name: /new visit/i })).toBeInTheDocument();
  });

  test('NURSE does not see the New Visit button', () => {
    mockRole = 'NURSE';
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.queryByRole('button', { name: /new visit/i })).not.toBeInTheDocument();
  });
});

describe('OPDPage — New Visit OPD payment validity check', () => {
  const PATIENT = { patientId: 'PAT-1', fullName: 'Ravi Kumar', mobileNumber: '9876543210' };

  async function openModalAndSelectPatient(user: ReturnType<typeof userEvent.setup>) {
    mockSearchPatients.mockReturnValue({ data: { data: [PATIENT] }, isFetching: false });
    render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
    await user.type(screen.getByPlaceholderText(/search patient by name or mobile/i), 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByText('Ravi Kumar'));
  }

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
  });

  test('VALID — shows a no-charge banner and hides the Free/Paid toggle', async () => {
    const user = userEvent.setup();
    const validityData = {
      patientId: 'PAT-1', paymentRequired: false, reason: 'VALID',
      latestPaymentId: 'pay-1', latestPaymentDate: '2026-08-01T00:00:00.000Z',
      validUntil: '2026-08-16T00:00:00.000Z', validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    await openModalAndSelectPatient(user);

    expect(await screen.findByText(/no new payment is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/registration type/i)).not.toBeInTheDocument();
  });

  test('EXPIRED — shows a renewal-required banner and forces the Paid fields (no Free option)', async () => {
    const user = userEvent.setup();
    const validityData = {
      patientId: 'PAT-1', paymentRequired: true, reason: 'EXPIRED',
      latestPaymentId: 'pay-1', latestPaymentDate: '2026-07-01T00:00:00.000Z',
      validUntil: '2026-07-16T00:00:00.000Z', validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    await openModalAndSelectPatient(user);

    expect(await screen.findByText(/a new opd payment is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/registration type/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByText(/payment mode/i)).toBeInTheDocument();
  });

  test('DIFFERENT_DOCTOR — shows a new-doctor banner and forces the Paid fields (no Free option)', async () => {
    const user = userEvent.setup();
    const validityData = {
      patientId: 'PAT-1', paymentRequired: true, reason: 'DIFFERENT_DOCTOR',
      latestPaymentId: null, latestPaymentDate: null, validUntil: null, validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    await openModalAndSelectPatient(user);

    expect(await screen.findByText(/does not cover the selected doctor/i)).toBeInTheDocument();
    expect(screen.queryByText(/registration type/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
    expect(screen.getByText(/payment mode/i)).toBeInTheDocument();
  });

  test('NO_PAYMENT — falls back to the existing manual Free/Paid toggle', async () => {
    const user = userEvent.setup();
    const validityData = {
      patientId: 'PAT-1', paymentRequired: true, reason: 'NO_PAYMENT',
      latestPaymentId: null, latestPaymentDate: null, validUntil: null, validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    await openModalAndSelectPatient(user);

    expect(await screen.findByText(/registration type/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^free$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^paid$/i })).toBeInTheDocument();
  });
});

describe('OPDPage — New Visit OPD Payment Transaction ID field', () => {
  const PATIENT = { patientId: 'PAT-1', fullName: 'Ravi Kumar', mobileNumber: '9876543210' };

  async function openModalSelectPatientAndPay(user: ReturnType<typeof userEvent.setup>) {
    mockSearchPatients.mockReturnValue({ data: { data: [PATIENT] }, isFetching: false });
    const validityData = {
      patientId: 'PAT-1', paymentRequired: true, reason: 'NO_PAYMENT',
      latestPaymentId: null, latestPaymentDate: null, validUntil: null, validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
    await user.type(screen.getByPlaceholderText(/search patient by name or mobile/i), 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /^paid$/i }));
  }

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
  });

  test('hidden by default and for Cash — no Transaction ID field shown', async () => {
    const user = userEvent.setup();
    await openModalSelectPatientAndPay(user);

    expect(screen.queryByLabelText(/transaction id/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cash$/i }));
    expect(screen.queryByLabelText(/transaction id/i)).not.toBeInTheDocument();
  });

  test('shown for UPI, marked optional', async () => {
    const user = userEvent.setup();
    await openModalSelectPatientAndPay(user);

    await user.click(screen.getByRole('button', { name: /^upi$/i }));

    const field = await screen.findByLabelText(/transaction id/i);
    expect(field).toBeInTheDocument();
    expect(field).toHaveAttribute('placeholder', expect.any(String));
    expect(field).not.toBeRequired();
    expect(screen.getByText(/transaction id \(optional\)/i)).toBeInTheDocument();
  });

  test('shown for Card, marked optional', async () => {
    const user = userEvent.setup();
    await openModalSelectPatientAndPay(user);

    await user.click(screen.getByRole('button', { name: /^card$/i }));

    const field = await screen.findByLabelText(/transaction id/i);
    expect(field).toBeInTheDocument();
    expect(field).not.toBeRequired();
  });

  test('switching from UPI back to Cash hides and clears the field', async () => {
    const user = userEvent.setup();
    await openModalSelectPatientAndPay(user);

    await user.click(screen.getByRole('button', { name: /^upi$/i }));
    const field = await screen.findByLabelText(/transaction id/i);
    await user.type(field, 'UPI-REF-123');
    expect(field).toHaveValue('UPI-REF-123');

    await user.click(screen.getByRole('button', { name: /^cash$/i }));
    expect(screen.queryByLabelText(/transaction id/i)).not.toBeInTheDocument();

    // Switching back to UPI shows an empty field again (value was cleared, not just hidden).
    await user.click(screen.getByRole('button', { name: /^upi$/i }));
    expect(await screen.findByLabelText(/transaction id/i)).toHaveValue('');
  });
});
