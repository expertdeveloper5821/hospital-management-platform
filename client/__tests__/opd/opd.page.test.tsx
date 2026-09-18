import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetOPDPaymentValidity    = jest.fn();
const mockSearchPatients           = jest.fn();
const mockUsers                    = jest.fn().mockReturnValue({ data: { data: [] }, isFetching: false });
const mockGetAvailableOpdNurses    = jest.fn().mockReturnValue({ data: [] });
const mockGetDoctorNurseAssignments = jest.fn().mockReturnValue({ data: undefined });
const mockCreateVisit              = jest.fn().mockResolvedValue({ visitId: 'OPD-TEST0001', queueNumber: 1, nurseIds: [] });
const mockGetOPDQueue               = jest.fn().mockReturnValue({ data: [], isFetching: false, refetch: jest.fn() });
const mockUpdateVisit               = jest.fn().mockResolvedValue({});
const mockCompleteVisit             = jest.fn().mockResolvedValue({});

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDQueueQuery: () => mockGetOPDQueue(),
  useCreateOPDVisitMutation: () => [
    (body: unknown) => ({ unwrap: () => mockCreateVisit(body) }),
    { isLoading: false },
  ],
  useUpdateOPDVisitMutation: () => [
    (body: unknown) => ({ unwrap: () => mockUpdateVisit(body) }),
    { isLoading: false },
  ],
  useStartOPDConsultationMutation: () => [jest.fn(), { isLoading: false }],
  useCompleteOPDVisitMutation: () => [
    (body: unknown) => ({ unwrap: () => mockCompleteVisit(body) }),
    { isLoading: false },
  ],
  useCancelOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
  // Mirrors RTK Query's real `skip` behaviour (data is undefined until a
  // patient is actually selected) so the component's "reset on patient
  // change" and "sync to validity result" effects interact the same way
  // they would against the real hook.
  useGetOPDPaymentValidityQuery: (args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
    mockGetOPDPaymentValidity(args, options),
  useGetAvailableOpdNursesQuery: () => mockGetAvailableOpdNurses(),
  useGetDoctorNurseAssignmentsQuery: (doctorId: string, options?: { skip?: boolean }) =>
    mockGetDoctorNurseAssignments(doctorId, options),
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useListPaymentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: (...args: unknown[]) => mockSearchPatients(...args),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: (...args: unknown[]) => mockUsers(...args),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: [] }),
}));

let mockRole   = 'RECEPTIONIST';
let mockUserId: string | undefined = undefined;

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: mockUserId } } }),
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

  test('NURSE does not see the New Visit button (view-only access to Doctor Visits)', () => {
    mockRole = 'NURSE';
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.queryByRole('button', { name: /new visit/i })).not.toBeInTheDocument();
  });

  test('MANAGER sees the New Visit button', () => {
    mockRole = 'MANAGER';
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    render(<OPDPage />);
    expect(screen.getByRole('button', { name: /new visit/i })).toBeInTheDocument();
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

describe('OPDPage — Assign Nurse (New Visit, multi-nurse)', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const NURSE_1  = { userId: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' };
  const NURSE_2  = { userId: 'nurse-2', name: 'Nurse PQR', email: 'pqr@h.com' };

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    mockUsers.mockImplementation((args: { role?: string }) =>
      args?.role === 'NURSE'
        ? { data: { data: [NURSE_1, NURSE_2] }, isFetching: false }
        : { data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [NURSE_1, NURSE_2] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockCreateVisit.mockResolvedValue({ visitId: 'OPD-TEST0001', queueNumber: 1, nurseIds: [] });
  });

  async function openModal(user: ReturnType<typeof userEvent.setup>) {
    render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
  }

  // Scope queries to the New Visit form itself — the queue page underneath
  // the modal has its own filter dropdowns, so an unscoped getAllByRole
  // would pick those up too and throw off the combobox ordering below.
  function modalForm(): HTMLElement {
    return screen.getByRole('button', { name: /create visit/i }).closest('form') as HTMLElement;
  }

  // The 3rd combobox on the New Visit form is Assign Nurse's "Add nurse"
  // dropdown (after Department and Assign Doctors' "Add doctor" dropdown) —
  // only present once at least one nurse is available.
  function nurseSelect(): HTMLElement {
    return within(modalForm()).getAllByRole('combobox')[2] as HTMLElement;
  }

  async function selectDoctor(user: ReturnType<typeof userEvent.setup>, doctorId: string) {
    const doctorSelect = within(modalForm()).getAllByRole('combobox')[1];
    await user.selectOptions(doctorSelect, doctorId);
    await user.click(screen.getByRole('button', { name: /add doctor/i }));
  }

  async function addNurse(user: ReturnType<typeof userEvent.setup>, nurseId: string) {
    await user.selectOptions(nurseSelect(), nurseId);
    await user.click(screen.getByRole('button', { name: /add nurse/i }));
  }

  test('renders below Assign Doctors and is clearly marked optional', async () => {
    const user = userEvent.setup();
    await openModal(user);

    expect(screen.getByText('Assign Nurse (Optional)')).toBeInTheDocument();
  });

  test('available nurses (excluding anyone the backend left out, e.g. IPD-assigned) populate the dropdown', async () => {
    const user = userEvent.setup();
    await openModal(user);

    expect(within(nurseSelect()).getByText('Nurse XYZ')).toBeInTheDocument();
    expect(within(nurseSelect()).getByText('Nurse PQR')).toBeInTheDocument();
    // A nurse the backend excluded (e.g. currently on IPD ward duty) never appears.
    expect(within(nurseSelect()).queryByText('Nurse On-Ward')).not.toBeInTheDocument();
  });

  test('shows "No available nurses" instead of a dropdown when the pool is empty', async () => {
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    const user = userEvent.setup();
    await openModal(user);

    expect(screen.getByText(/no available nurses/i)).toBeInTheDocument();
  });

  test('multiple nurses can be added to the same visit as chips, same pattern as Assign Doctors', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await addNurse(user, 'nurse-1');
    await addNurse(user, 'nurse-2');

    expect(screen.getByTitle('Nurse XYZ')).toBeInTheDocument();
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();
  });

  test('a nurse chip can be removed independently of the other', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await addNurse(user, 'nurse-1');
    await addNurse(user, 'nurse-2');

    const chip = screen.getByTitle('Nurse XYZ').closest('span.rounded-full') as HTMLElement;
    await user.click(within(chip).getByRole('button'));

    expect(screen.queryByTitle('Nurse XYZ')).not.toBeInTheDocument();
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();
  });

  test('selecting a doctor looks up that doctor\'s existing OPD nurse assignment(s)', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await selectDoctor(user, 'doc-1');

    await waitFor(() =>
      expect(mockGetDoctorNurseAssignments).toHaveBeenCalledWith('doc-1', { skip: false }));
  });

  test('shows the "already assigned nurses" banner and pre-selects all of them as chips', async () => {
    // A stable object reference across re-renders/calls, mirroring RTK
    // Query's real memoization of unchanged cached data — an effect keyed on
    // this value must not refire just because the mock function ran again.
    const assignments = {
      doctorId: 'doc-1',
      nurses: [
        { nurseId: 'nurse-1', nurseName: 'Nurse XYZ', isAvailable: true },
        { nurseId: 'nurse-2', nurseName: 'Nurse PQR', isAvailable: true },
      ],
    };
    mockGetDoctorNurseAssignments.mockImplementation((doctorId: string) =>
      doctorId ? { data: assignments } : { data: undefined });
    const user = userEvent.setup();
    await openModal(user);

    await selectDoctor(user, 'doc-1');

    expect(await screen.findByText(/already assigned nurses: Nurse XYZ, Nurse PQR/i)).toBeInTheDocument();
    // Pre-selected as removable chips, same as assigned doctors.
    expect(screen.getByTitle('Nurse XYZ')).toBeInTheDocument();
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();
  });

  test('flags a stale suggestion when a mapped nurse is now on an IPD ward, without pre-selecting them', async () => {
    const assignments = {
      doctorId: 'doc-1',
      nurses: [{ nurseId: 'nurse-1', nurseName: 'Nurse XYZ', isAvailable: false }],
    };
    mockGetDoctorNurseAssignments.mockImplementation((doctorId: string) =>
      doctorId ? { data: assignments } : { data: undefined });
    const user = userEvent.setup();
    await openModal(user);

    await selectDoctor(user, 'doc-1');

    expect(await screen.findByText(/currently on ipd ward duty/i)).toBeInTheDocument();
    // Not silently reused as this visit's nurse.
    expect(screen.queryByTitle('Nurse XYZ')).not.toBeInTheDocument();
  });

  test('user can add a nurse beyond the doctor\'s existing assignment', async () => {
    const assignments = {
      doctorId: 'doc-1',
      nurses: [{ nurseId: 'nurse-1', nurseName: 'Nurse XYZ', isAvailable: true }],
    };
    mockGetDoctorNurseAssignments.mockImplementation((doctorId: string) =>
      doctorId ? { data: assignments } : { data: undefined });
    const user = userEvent.setup();
    await openModal(user);

    await selectDoctor(user, 'doc-1');
    await screen.findByTitle('Nurse XYZ'); // pre-selected

    await addNurse(user, 'nurse-2');

    expect(screen.getByTitle('Nurse XYZ')).toBeInTheDocument();
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();
  });

  test('a visit can be created with no nurse selected at all', async () => {
    mockSearchPatients.mockReturnValue({
      data: { data: [{ patientId: 'PAT-1', fullName: 'Ravi Kumar', mobileNumber: '9876543210' }] },
      isFetching: false,
    });
    const user = userEvent.setup();
    await openModal(user);
    await user.type(screen.getByPlaceholderText(/search patient by name or mobile/i), 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /^free$/i }));

    await user.click(screen.getByRole('button', { name: /create visit/i }));

    await waitFor(() => expect(mockCreateVisit).toHaveBeenCalled());
    expect(mockCreateVisit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ nurseIds: undefined }),
    );
  });

  test('a visit created with multiple nurses selected sends all of their ids', async () => {
    mockSearchPatients.mockReturnValue({
      data: { data: [{ patientId: 'PAT-1', fullName: 'Ravi Kumar', mobileNumber: '9876543210' }] },
      isFetching: false,
    });
    const user = userEvent.setup();
    await openModal(user);
    await addNurse(user, 'nurse-1');
    await addNurse(user, 'nurse-2');
    await user.type(screen.getByPlaceholderText(/search patient by name or mobile/i), 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /^free$/i }));

    await user.click(screen.getByRole('button', { name: /create visit/i }));

    await waitFor(() => expect(mockCreateVisit).toHaveBeenCalled());
    expect(mockCreateVisit.mock.calls[0][0]).toEqual(
      expect.objectContaining({ nurseIds: ['nurse-1', 'nurse-2'] }),
    );
  });
});

describe('OPDPage — Visit Details panel shows assigned nurses', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const NURSE_1  = { userId: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' };
  const NURSE_2  = { userId: 'nurse-2', name: 'Nurse PQR', email: 'pqr@h.com' };
  const VISIT = {
    visitId: 'OPD-VIEW0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: ['nurse-1', 'nurse-2'], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    mockUsers.mockImplementation((args: { role?: string }) =>
      args?.role === 'NURSE'
        ? { data: { data: [NURSE_1, NURSE_2] }, isFetching: false }
        : { data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: [VISIT], isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
  });

  test('lists every assigned nurse alongside the doctor and patient in the view panel', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));

    // "Dr. ABC" legitimately appears more than once (queue table cell, the
    // page-level Doctor filter dropdown, and the panel's own Doctor(s) row) —
    // the panel having rendered at all is confirmed by the nurse names text,
    // which only ever appears in the panel.
    expect(await screen.findByText('Nurse XYZ, Nurse PQR')).toBeInTheDocument();
    expect(screen.getAllByText('Dr. ABC').length).toBeGreaterThan(0);
  });

  test('shows "Unassigned" when no nurse is on the visit', async () => {
    mockGetOPDQueue.mockReturnValue({ data: [{ ...VISIT, nurseIds: [] }], isFetching: false, refetch: jest.fn() });
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await waitFor(() => expect(screen.getAllByText('Dr. ABC').length).toBeGreaterThan(0));

    // "Unassigned" appears for both an empty Doctor(s) and Nurse(s) row when
    // applicable — here only Nurse(s) is empty, so exactly one match.
    expect(screen.getAllByText('Unassigned')).toHaveLength(1);
  });
});

describe('OPDPage — New Visit duplicate submission guard', () => {
  const PATIENT = { patientId: 'PAT-1', fullName: 'Ravi Kumar', mobileNumber: '9876543210' };

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    // Reset to a clean, empty queue — a prior describe block's last test may
    // have left mockGetOPDQueue returning rows (e.g. a "Ravi Kumar" row),
    // which would otherwise collide with this test's own same-named patient.
    mockGetOPDQueue.mockReturnValue({ data: [], isFetching: false, refetch: jest.fn() });
    mockUsers.mockReturnValue({ data: { data: [] }, isFetching: false });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockCreateVisit.mockResolvedValue({ visitId: 'OPD-TEST0001', queueNumber: 1, nurseIds: [] });
  });

  // A double-click (or a second Enter/click landing before the first
  // submission finishes) must only ever create one visit. The payment
  // validity re-check that handleSubmit awaits before calling createVisit is
  // a real async gap — refetch here is a genuine Promise (never resolved
  // synchronously), so firing a second click right after the first, with no
  // await in between, lands squarely inside that gap and would slip through
  // if the submit lock were armed any later than immediately on entry.
  test('rapidly clicking Create Visit twice creates only one OPD visit', async () => {
    mockSearchPatients.mockReturnValue({ data: { data: [PATIENT] }, isFetching: false });
    const validityData = {
      patientId: 'PAT-1', paymentRequired: true, reason: 'NO_PAYMENT',
      latestPaymentId: null, latestPaymentDate: null, validUntil: null, validityDays: 15,
    };
    mockGetOPDPaymentValidity.mockImplementation((_args: { patientId: string; doctorIds?: string[] }, options?: { skip?: boolean }) =>
      ({ data: options?.skip ? undefined : validityData, isFetching: false, refetch: jest.fn().mockResolvedValue({ data: validityData }) }));

    const user = userEvent.setup();
    render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
    await user.type(screen.getByPlaceholderText(/search patient by name or mobile/i), 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument());
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /^free$/i }));

    const submitButton = screen.getByRole('button', { name: /create visit/i });
    // Two synchronous fireEvent.click calls, with no await between them, so
    // both dispatch (and both handleSubmit invocations run to their first
    // `await`) before either has a chance to resume — the same timing a fast
    // real double-click produces.
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    await waitFor(() => expect(mockCreateVisit).toHaveBeenCalled());
    expect(mockCreateVisit).toHaveBeenCalledTimes(1);
  });
});

describe('OPDPage — Nurse notes-only Visit edit', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const NURSE_1  = { userId: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' };
  const VISIT = {
    visitId: 'OPD-EDIT0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: ['nurse-1'], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: 'Viral fever', prescription: 'Paracetamol', notes: 'Initial note',
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsers.mockImplementation((args: { role?: string }) =>
      args?.role === 'NURSE'
        ? { data: { data: [NURSE_1] }, isFetching: false }
        : { data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: [VISIT], isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockUpdateVisit.mockResolvedValue({ ...VISIT, notes: 'Updated note' });
  });

  test('an assigned nurse sees Edit Visit, and the edit form exposes only the Notes and Vitals fields', async () => {
    mockRole = 'NURSE';
    mockUserId = 'nurse-1';
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    expect(screen.getByText('Only the notes and vitals fields can be edited.')).toBeInTheDocument();
    // Confirms the (Tiptap-based) Notes editor itself rendered — its own
    // character counter is a more reliable signal in jsdom than trying to
    // resolve the label→contentEditable association through RTL.
    expect(await screen.findByText(/\/ 2000 characters/)).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    // Vitals is editable for a Nurse, unlike diagnosis/prescription.
    expect(screen.getByLabelText(/weight/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/height/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/blood pressure/i)).toBeInTheDocument();
    // Everything else from the full edit form must be absent, not just disabled.
    expect(screen.queryByLabelText(/department/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Assigned Doctors')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/diagnosis/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/prescription/i)).not.toBeInTheDocument();
    // The pre-existing diagnosis/prescription are still visible, just read-only.
    expect(screen.getByText('Viral fever')).toBeInTheDocument();
    expect(screen.getByText('Paracetamol')).toBeInTheDocument();
  });

  test('saving as an assigned nurse sends only the notes and vitals fields to the API', async () => {
    mockRole = 'NURSE';
    mockUserId = 'nurse-1';
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    const sentBody = mockUpdateVisit.mock.calls[0][0] as Record<string, unknown>;
    // The rich-text editor round-trips the initial value as sanitized HTML
    // (e.g. wraps plain text in <p>) — what matters here is that `notes` and
    // `vitals` are the *only* fields sent alongside visitId, not their exact
    // serialization.
    expect(Object.keys(sentBody).sort()).toEqual(['notes', 'visitId', 'vitals'].sort());
    expect(sentBody.visitId).toBe('OPD-EDIT0001');
    expect(sentBody.notes).toContain('Initial note');
  });

  test('a nurse not assigned to this visit does not see an Edit Visit option', async () => {
    mockRole = 'NURSE';
    mockUserId = 'nurse-2'; // not in VISIT.nurseIds
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await waitFor(() => expect(screen.getByText('OPD-EDIT0001')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /edit visit/i })).not.toBeInTheDocument();
  });

  test('existing roles unaffected — a Doctor still gets the full edit form, unrestricted', async () => {
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    expect(screen.queryByText('Only the notes field can be edited.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/department/i)).toBeInTheDocument();
    expect(screen.getByText('Assigned Doctors')).toBeInTheDocument();
    expect(screen.getByLabelText(/diagnosis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prescription/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight/i)).toBeInTheDocument();
  });
});

describe('OPDPage — Diagnosis/Prescription persistence across Edit and Complete', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const VISIT = {
    visitId: 'OPD-COMP0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: [], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    mockUsers.mockReturnValue({ data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: [VISIT], isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
  });

  // Regression test: `form`/`completeForm` used to be seeded from `visit`
  // only once, when the panel first rendered — saving a diagnosis via Edit
  // updated the visit shown in View mode but never flowed into the separate
  // Complete-mode state, so jumping straight to Complete afterwards showed
  // empty fields instead of what was just saved.
  test('a diagnosis/prescription saved via Edit immediately pre-fills the Complete form', async () => {
    mockUpdateVisit.mockImplementation((body: Record<string, unknown>) =>
      Promise.resolve({ ...VISIT, ...body }));

    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.type(screen.getByLabelText(/diagnosis/i), 'Viral fever');
    await user.type(screen.getByLabelText(/prescription/i), 'Paracetamol 500mg');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());

    // Back on the (now updated) view — jump straight to Complete without
    // reopening the panel.
    await user.click(await screen.findByRole('button', { name: /^complete$/i }));

    expect(screen.getByLabelText(/diagnosis/i)).toHaveValue('Viral fever');
    expect(screen.getByLabelText(/prescription/i)).toHaveValue('Paracetamol 500mg');
  });

  // Same staleness bug, other direction: re-entering Edit after a value was
  // already saved must show the saved value, not whatever the very first
  // render of the panel happened to capture.
  test('re-opening Edit after a save still shows the saved diagnosis, not a stale snapshot', async () => {
    mockUpdateVisit.mockImplementation((body: Record<string, unknown>) =>
      Promise.resolve({ ...VISIT, ...body }));

    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
    await user.type(screen.getByLabelText(/diagnosis/i), 'Viral fever');
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());

    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
    expect(screen.getByLabelText(/diagnosis/i)).toHaveValue('Viral fever');
  });
});

describe('OPD Vitals — View/Edit', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const VISIT_WITH_VITALS = {
    visitId: 'OPD-VITALS01', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: [], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    vitals: { weight: 68.5, height: 172, bloodPressure: '120/80', sugar: 95, bodyTemperature: 98.6 },
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    mockUsers.mockReturnValue({ data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: [VISIT_WITH_VITALS], isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
  });

  test('View mode shows previously saved vitals with units', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));

    expect(await screen.findByText('68.5 kg')).toBeInTheDocument();
    expect(screen.getByText('172 cm')).toBeInTheDocument();
    expect(screen.getByText('120/80 mmHg')).toBeInTheDocument();
    expect(screen.getByText('95 mg/dL')).toBeInTheDocument();
    expect(screen.getByText('98.6 °F')).toBeInTheDocument();
  });

  test('Edit mode pre-fills the Vitals inputs from previously saved values', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    expect(screen.getByLabelText(/weight/i)).toHaveValue(68.5);
    expect(screen.getByLabelText(/height/i)).toHaveValue(172);
    expect(screen.getByLabelText(/blood pressure/i)).toHaveValue('120/80');
    expect(screen.getByLabelText(/sugar/i)).toHaveValue(95);
    expect(screen.getByLabelText(/body temperature/i)).toHaveValue(98.6);
  });

  test('saving Vitals sends numeric fields as numbers and blank fields as null', async () => {
    mockUpdateVisit.mockResolvedValue({ ...VISIT_WITH_VITALS });
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight/i), '70.2');
    await user.clear(screen.getByLabelText(/blood pressure/i)); // clear → should send null
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    const sentBody = mockUpdateVisit.mock.calls[0][0] as { vitals: Record<string, unknown> };
    expect(sentBody.vitals).toEqual({
      weight: 70.2, height: 172, bloodPressure: null, sugar: 95, bodyTemperature: 98.6,
    });
  });

  test('an out-of-range vital blocks submission with a validation error, and never calls the API', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight/i), '9999');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/weight must be between/i)).toBeInTheDocument();
    expect(mockUpdateVisit).not.toHaveBeenCalled();
  });

  test('a malformed blood pressure blocks submission with a validation error', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText(/blood pressure/i));
    await user.type(screen.getByLabelText(/blood pressure/i), 'high');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/blood pressure must be in the format/i)).toBeInTheDocument();
    expect(mockUpdateVisit).not.toHaveBeenCalled();
  });

  test('a vital just saved via Edit is reflected immediately in View mode', async () => {
    mockUpdateVisit.mockImplementation((body: Record<string, unknown>) =>
      Promise.resolve({ ...VISIT_WITH_VITALS, vitals: { ...VISIT_WITH_VITALS.vitals, ...(body.vitals as object) } }));

    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
    await user.clear(screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight/i), '73');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('73 kg')).toBeInTheDocument();
  });
});
