import React from 'react';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetOPDPaymentValidity    = jest.fn();
const mockSearchPatients           = jest.fn();
const mockGetPatientById            = jest.fn().mockReturnValue({ data: undefined });
const mockUsers                    = jest.fn().mockReturnValue({ data: { data: [] }, isFetching: false });
const mockListDepartments          = jest.fn().mockReturnValue({ data: undefined });
const mockGetAvailableOpdNurses    = jest.fn().mockReturnValue({ data: [] });
const mockGetDoctorNurseAssignments = jest.fn().mockReturnValue({ data: undefined });
const mockCreateVisit              = jest.fn().mockResolvedValue({ visitId: 'OPD-TEST0001', queueNumber: 1, nurseIds: [] });
// GET /api/opd/visits is paginated — wraps rows in the PaginatedResult shape.
function queuePage(data: unknown[]) {
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1 };
}

const mockGetOPDQueue               = jest.fn().mockReturnValue({ data: queuePage([]), isFetching: false, refetch: jest.fn() });
const mockUpdateVisit               = jest.fn().mockResolvedValue({});
const mockCompleteVisit             = jest.fn().mockResolvedValue({});

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDQueueQuery: (args: unknown) => mockGetOPDQueue(args),
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
  useDeleteOPDVisitMutation: () => [jest.fn(), { isLoading: false }],
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
  useGetPatientByIdQuery: (...args: unknown[]) => mockGetPatientById(...args),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: (...args: unknown[]) => mockUsers(...args),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => mockListDepartments(),
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

describe('OPDPage — New Visit patient search keyboard navigation', () => {
  const PATIENTS = [
    { patientId: 'PAT-1', fullName: 'Ravi Kumar',  mobileNumber: '9876543210' },
    { patientId: 'PAT-2', fullName: 'Ravi Sharma', mobileNumber: '9876500000' },
    { patientId: 'PAT-3', fullName: 'Ravi Verma',  mobileNumber: '9876511111' },
  ];

  async function openModalAndSearch(user: ReturnType<typeof userEvent.setup>) {
    mockSearchPatients.mockReturnValue({ data: { data: PATIENTS }, isFetching: false });
    render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
    const input = screen.getByPlaceholderText(/search patient by name or mobile/i);
    await user.type(input, 'Ravi');
    await waitFor(() => expect(screen.getByText('Ravi Kumar')).toBeInTheDocument(), { timeout: 2000 });
    return input;
  }

  const suggestions = () => document.getElementById('nv-patient-suggestions');
  const option = (name: string) =>
    within(suggestions() as HTMLElement).getByRole('option', { name: new RegExp(name, 'i') });

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
  });

  test('nothing is highlighted until an arrow key is pressed', async () => {
    const user = userEvent.setup();
    await openModalAndSearch(user);
    PATIENTS.forEach((p) => expect(option(p.fullName)).toHaveAttribute('aria-selected', 'false'));
  });

  test('ArrowDown / ArrowUp move the highlight, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const input = await openModalAndSearch(user);

    await user.keyboard('{ArrowDown}');
    expect(option('Ravi Kumar')).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', option('Ravi Kumar').id);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(option('Ravi Verma')).toHaveAttribute('aria-selected', 'true');
    expect(option('Ravi Kumar')).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowDown}');
    expect(option('Ravi Kumar')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(option('Ravi Verma')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(option('Ravi Sharma')).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter selects the highlighted patient without submitting the form', async () => {
    const user = userEvent.setup();
    await openModalAndSearch(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(screen.getByText('Ravi Sharma')).toBeInTheDocument();
    expect(suggestions()).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search patient by name or mobile/i)).not.toBeInTheDocument();
    expect(mockCreateVisit).not.toHaveBeenCalled();
  });

  test('Enter with nothing highlighted does not select a patient', async () => {
    const user = userEvent.setup();
    await openModalAndSearch(user);

    await user.keyboard('{Enter}');

    expect(screen.getByPlaceholderText(/search patient by name or mobile/i)).toBeInTheDocument();
    expect(within(suggestions() as HTMLElement).getAllByRole('option')).toHaveLength(3);
  });

  test('mouse click still selects a patient, and hovering moves the highlight', async () => {
    const user = userEvent.setup();
    await openModalAndSearch(user);

    await user.hover(option('Ravi Verma'));
    expect(option('Ravi Verma')).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByText('Ravi Verma'));
    expect(suggestions()).not.toBeInTheDocument();
    expect(screen.getByText('Ravi Verma')).toBeInTheDocument();
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

  // Assign Nurse's multi-select — only present once at least one nurse is available.
  function nurseCombobox(): HTMLElement {
    return within(modalForm()).getByRole('combobox', { name: /assign nurse/i });
  }

  const NURSE_NAMES: Record<string, string> = { 'nurse-1': 'Nurse XYZ', 'nurse-2': 'Nurse PQR' };

  function doctorCombobox(): HTMLElement {
    return within(modalForm()).getByRole('combobox', { name: /assign doctors/i });
  }

  const DOCTOR_NAMES: Record<string, string> = { 'doc-1': 'Dr. ABC' };

  async function selectDoctor(user: ReturnType<typeof userEvent.setup>, doctorId: string) {
    await user.click(doctorCombobox());
    await user.click(within(modalForm()).getByRole('option', { name: DOCTOR_NAMES[doctorId] }));
    await user.click(doctorCombobox()); // close the list again
  }

  async function addNurse(user: ReturnType<typeof userEvent.setup>, nurseId: string) {
    await user.click(nurseCombobox());
    await user.click(within(modalForm()).getByRole('option', { name: NURSE_NAMES[nurseId] }));
    await user.click(nurseCombobox()); // close the list again
  }

  test('doctor multi-select: toggles options, stays open, shows removable tags, filters by search', async () => {
    mockUsers.mockImplementation(() => ({
      data: { data: [DOCTOR_1, { userId: 'doc-2', name: 'Dr. DEF', departmentIds: [] }] },
      isFetching: false,
    }));
    const user = userEvent.setup();
    await openModal(user);

    await user.click(doctorCombobox());
    await user.click(within(modalForm()).getByRole('option', { name: 'Dr. ABC' }));
    await user.click(within(modalForm()).getByRole('option', { name: 'Dr. DEF' }));

    // List stays open after each pick; both are checked and shown as tags.
    expect(within(modalForm()).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'true');
    expect(within(modalForm()).getByRole('option', { name: 'Dr. DEF' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTitle('Dr. ABC')).toBeInTheDocument();
    expect(screen.getByTitle('Dr. DEF')).toBeInTheDocument();

    // Selecting an already-selected doctor deselects it.
    await user.click(within(modalForm()).getByRole('option', { name: 'Dr. ABC' }));
    expect(within(modalForm()).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByTitle('Dr. ABC')).not.toBeInTheDocument();

    // Search narrows the list.
    await user.type(screen.getByLabelText(/search doctors/i), 'abc');
    expect(within(modalForm()).getByRole('option', { name: 'Dr. ABC' })).toBeInTheDocument();
    expect(within(modalForm()).queryByRole('option', { name: 'Dr. DEF' })).not.toBeInTheDocument();

    // Tag × removes the doctor.
    await user.click(screen.getByRole('button', { name: /remove dr\. def/i }));
    expect(screen.queryByTitle('Dr. DEF')).not.toBeInTheDocument();
  });

  test('doctor multi-select: after searching, ArrowDown/ArrowUp move the highlight and Enter selects it without submitting', async () => {
    mockUsers.mockImplementation(() => ({
      data: { data: [DOCTOR_1, { userId: 'doc-2', name: 'Dr. DEF', departmentIds: [] }, { userId: 'doc-3', name: 'Nobody', departmentIds: [] }] },
      isFetching: false,
    }));
    const user = userEvent.setup();
    await openModal(user);

    await user.click(doctorCombobox());
    const search = screen.getByLabelText(/search doctors/i);
    await user.type(search, 'dr');
    expect(search).not.toHaveAttribute('aria-activedescendant');

    // Down → Dr. ABC, Down → Dr. DEF, Down wraps → Dr. ABC, Up wraps → Dr. DEF.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}');
    const def = within(modalForm()).getByRole('option', { name: 'Dr. DEF' });
    expect(search).toHaveAttribute('aria-activedescendant', def.id);

    await user.keyboard('{Enter}');
    expect(def).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTitle('Dr. DEF')).toBeInTheDocument();
    expect(doctorCombobox()).toHaveAttribute('aria-expanded', 'true');
    expect(mockCreateVisit).not.toHaveBeenCalled();

    // Enter again on the same highlighted option toggles it off.
    await user.keyboard('{Enter}');
    expect(screen.queryByTitle('Dr. DEF')).not.toBeInTheDocument();
  });

  test('doctor multi-select: Enter with nothing highlighted selects nothing; mouse selection still works', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.click(doctorCombobox());
    await user.type(screen.getByLabelText(/search doctors/i), 'abc{Enter}');
    expect(screen.queryByTitle('Dr. ABC')).not.toBeInTheDocument();
    expect(mockCreateVisit).not.toHaveBeenCalled();

    await user.click(within(modalForm()).getByRole('option', { name: 'Dr. ABC' }));
    expect(screen.getByTitle('Dr. ABC')).toBeInTheDocument();
  });

  test('nurse multi-select: after searching, arrow keys + Enter select the highlighted nurse', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.click(nurseCombobox());
    await user.type(screen.getByLabelText(/search nurses/i), 'nurse');
    await user.keyboard('{ArrowUp}{Enter}');

    expect(within(modalForm()).getByRole('option', { name: 'Nurse PQR' })).toHaveAttribute('aria-selected', 'true');
    expect(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();
    expect(mockCreateVisit).not.toHaveBeenCalled();
  });

  test('renders below Assign Doctors and is clearly marked optional', async () => {
    const user = userEvent.setup();
    await openModal(user);

    expect(screen.getByText('Assign Nurse (Optional)')).toBeInTheDocument();
  });

  test('available nurses (excluding anyone the backend left out, e.g. IPD-assigned) populate the dropdown', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.click(nurseCombobox());
    expect(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' })).toBeInTheDocument();
    expect(within(modalForm()).getByRole('option', { name: 'Nurse PQR' })).toBeInTheDocument();
    // A nurse the backend excluded (e.g. currently on IPD ward duty) never appears.
    expect(within(modalForm()).queryByRole('option', { name: 'Nurse On-Ward' })).not.toBeInTheDocument();
  });

  test('nurse multi-select: toggles without closing, no checkboxes, Escape and outside click close it', async () => {
    const user = userEvent.setup();
    await openModal(user);

    await user.click(nurseCombobox());
    await user.click(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' }));
    await user.click(within(modalForm()).getByRole('option', { name: 'Nurse PQR' }));
    expect(nurseCombobox()).toHaveAttribute('aria-expanded', 'true');
    expect(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' })).toHaveAttribute('aria-selected', 'true');

    // Re-selecting deselects; the list never renders checkbox inputs.
    await user.click(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' }));
    expect(within(modalForm()).getByRole('option', { name: 'Nurse XYZ' })).toHaveAttribute('aria-selected', 'false');
    expect(within(modalForm()).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Nurse XYZ')).not.toBeInTheDocument();
    expect(screen.getByTitle('Nurse PQR')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(nurseCombobox()).toHaveAttribute('aria-expanded', 'false');

    await user.click(nurseCombobox());
    await user.click(screen.getByText('Assign Nurse (Optional)'));
    expect(nurseCombobox()).toHaveAttribute('aria-expanded', 'false');
  });

  test('no separate Add Doctor / Add Nurse buttons remain', async () => {
    const user = userEvent.setup();
    await openModal(user);

    expect(within(modalForm()).queryByRole('button', { name: /add doctor/i })).not.toBeInTheDocument();
    expect(within(modalForm()).queryByRole('button', { name: /add nurse/i })).not.toBeInTheDocument();
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
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
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
    mockGetOPDQueue.mockReturnValue({ data: queuePage([{ ...VISIT, nurseIds: [] }]), isFetching: false, refetch: jest.fn() });
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await waitFor(() => expect(screen.getAllByText('Dr. ABC').length).toBeGreaterThan(0));

    // "Unassigned" appears for both an empty Doctor(s) and Nurse(s) row when
    // applicable — here only Nurse(s) is empty, so exactly one match.
    expect(screen.getAllByText('Unassigned')).toHaveLength(1);
  });
});

describe('OPDPage — Receptionist Delete Visit gating by status', () => {
  const VISIT = {
    visitId: 'OPD-DEL0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: [], nurseIds: [], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    mockUsers.mockReturnValue({ data: { data: [] }, isFetching: false });
    mockSearchPatients.mockReturnValue({ data: { data: [] }, isFetching: false });
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
  });

  async function openPanel(status: string) {
    mockGetOPDQueue.mockReturnValue({ data: queuePage([{ ...VISIT, status }]), isFetching: false, refetch: jest.fn() });
    const user = userEvent.setup();
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    await screen.findByText('OPD-DEL0001');
  }

  test('shows Delete Visit for a Waiting (OPEN) visit', async () => {
    await openPanel('OPEN');
    expect(screen.getByRole('button', { name: /delete visit/i })).toBeInTheDocument();
  });

  test.each(['IN_PROGRESS', 'COMPLETED'])('hides Delete Visit for a %s visit', async (status) => {
    await openPanel(status);
    expect(screen.queryByRole('button', { name: /delete visit/i })).not.toBeInTheDocument();
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
    mockGetOPDQueue.mockReturnValue({ data: queuePage([]), isFetching: false, refetch: jest.fn() });
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
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
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
    expect(screen.getByLabelText('Pulse (bpm)')).toBeInTheDocument();
    expect(screen.getByLabelText('BP (mmHg)')).toBeInTheDocument();
    expect(screen.queryByLabelText('RBS (mg/dL)')).not.toBeInTheDocument();
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
    mockGetPatientById.mockReturnValue({ data: undefined });
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    mockUsers.mockReturnValue({ data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
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

describe('OPDPage — View/Edit doctor & nurse multi-selects', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const DOCTOR_2 = { userId: 'doc-2', name: 'Dr. DEF', departmentIds: [] };
  const NURSE_1  = { userId: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' };
  const NURSE_2  = { userId: 'nurse-2', name: 'Nurse PQR', email: 'pqr@h.com' };
  const VISIT = {
    visitId: 'OPD-EDIT0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: ['nurse-1'], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPatientById.mockReturnValue({ data: undefined });
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    mockUsers.mockReturnValue({ data: { data: [DOCTOR_1, DOCTOR_2] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [NURSE_1, NURSE_2] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockUpdateVisit.mockImplementation((body: Record<string, unknown>) => Promise.resolve({ ...VISIT, ...body }));
  });

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
  }

  const doctorBox = () => screen.getByRole('combobox', { name: /assigned doctors/i });
  const nurseBox  = () => screen.getByRole('combobox', { name: /assigned nurses/i });

  test('existing doctor and nurse assignments are pre-selected as tags and selected options', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
    expect(within(nurseBox()).getByTitle('Nurse XYZ')).toBeInTheDocument();

    await user.click(doctorBox());
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. DEF' })).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Escape}');

    await user.click(nurseBox());
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Nurse XYZ' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Nurse PQR' })).toHaveAttribute('aria-selected', 'false');

    expect(screen.queryByRole('button', { name: /add doctor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add nurse/i })).not.toBeInTheDocument();
  });

  test('changing doctors and nurses via the dropdowns saves the new id arrays', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    await user.click(doctorBox());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. DEF' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. ABC' })); // deselect
    await user.keyboard('{Escape}');

    await user.click(nurseBox());
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Nurse PQR' }));
    await user.keyboard('{Escape}');
    await user.click(within(nurseBox()).getByRole('button', { name: /remove nurse xyz/i }));

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    expect(mockUpdateVisit.mock.calls[0][0]).toEqual(expect.objectContaining({
      visitId:   'OPD-EDIT0001',
      doctorIds: ['doc-2'],
      nurseIds:  ['nurse-2'],
    }));
  });

  test('saving without touching assignments sends neither doctorIds nor nurseIds', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    expect(mockUpdateVisit.mock.calls[0][0]).not.toHaveProperty('doctorIds');
    expect(mockUpdateVisit.mock.calls[0][0]).not.toHaveProperty('nurseIds');
  });
});

describe('OPD Vitals — View/Edit', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', departmentIds: [] };
  const VISIT_WITH_VITALS = {
    visitId: 'OPD-VITALS01', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-1'], nurseIds: [], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    vitals: {
      weight: 68.5, height: 172, bloodPressure: '120/80', sugar: 95,
      bodyTemperature: 98.6, spo2: 98, pulse: 72, respiratoryRate: 18, headCircumference: 55,
    },
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPatientById.mockReturnValue({ data: undefined });
    mockRole = 'DOCTOR';
    mockUserId = 'doc-1';
    mockUsers.mockReturnValue({ data: { data: [DOCTOR_1] }, isFetching: false });
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT_WITH_VITALS]), isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
  });

  const PEDIATRIC     = { departmentId: 'DEPT-PED', name: 'Pediatric', vitalsProfile: 'PEDIATRIC' };
  const NON_PEDIATRIC = { departmentId: 'DEPT-NON', name: 'Non-Pediatric', vitalsProfile: 'NON_PEDIATRIC' };
  const DENTAL        = { departmentId: 'DEPT-DEN', name: 'Dental', vitalsProfile: null };
  const VITAL_LABELS = /^(PR \(bpm\)|Pulse \(bpm\)|RR \(\/min\)|SpO₂ \(%\)|BP \(mmHg\)|RBS \(mg\/dL\)|Temperature \(°F\)|Height(\/Length)? \(cm\)|Weight \(kg\)|Head Circumference \(cm\))$/;
  const vitalLabels = () => screen.getAllByText(VITAL_LABELS).map((el) => el.textContent);

  function withVisit(departmentId: string | null, age: { age: number; ageUnit: string }) {
    mockListDepartments.mockReturnValue({ data: [PEDIATRIC, NON_PEDIATRIC, DENTAL] });
    mockGetPatientById.mockReturnValue({ data: { patientId: 'PAT-1', dateOfBirth: null, ...age } });
    mockGetOPDQueue.mockReturnValue({
      data: queuePage([{ ...VISIT_WITH_VITALS, departmentId }]), isFetching: false, refetch: jest.fn(),
    });
  }
  afterEach(() => { mockListDepartments.mockReturnValue({ data: undefined }); });

  test('View mode shows previously saved vitals with units', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));

    // No department → SpO₂ → Temp → BP → Pulse → Height → Weight.
    expect(await screen.findByText('68.5 kg')).toBeInTheDocument();
    expect(screen.getByText('98 %')).toBeInTheDocument();
    expect(screen.getByText('98.6 °F')).toBeInTheDocument();
    expect(screen.getByText('120/80 mmHg')).toBeInTheDocument();
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
    expect(screen.getByText('172 cm')).toBeInTheDocument();
    expect(screen.queryByText('95 mg/dL')).not.toBeInTheDocument();
    expect(screen.getByText('Vitals')).toBeInTheDocument();
  });

  test('Pediatric department: PR → RR → SpO₂ → BP → Height → Weight → Head Circ., whatever the age', async () => {
    withVisit('DEPT-PED', { age: 40, ageUnit: 'YEARS' });
    const user = userEvent.setup();
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    expect(await screen.findByText('Pediatric Vitals')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit visit/i }));

    expect(vitalLabels()).toEqual(['PR (bpm)', 'RR (/min)', 'SpO₂ (%)', 'BP (mmHg)', 'Height/Length (cm)', 'Weight (kg)', 'Head Circumference (cm)']);
    expect(screen.getByLabelText('PR (bpm)')).toHaveValue(72);
    expect(screen.getByLabelText('RR (/min)')).toHaveValue(18);
    expect(screen.getByLabelText('Head Circumference (cm)')).toHaveValue(55);
  });

  test('Non-Pediatric department: BP → PR → SpO₂ → RBS → Temp → Wt, whatever the age', async () => {
    withVisit('DEPT-NON', { age: 5, ageUnit: 'MONTHS' });
    const user = userEvent.setup();
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    expect(await screen.findByText('Non-Pediatric Vitals')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /edit visit/i }));

    expect(vitalLabels()).toEqual(['BP (mmHg)', 'PR (bpm)', 'SpO₂ (%)', 'RBS (mg/dL)', 'Temperature (°F)', 'Weight (kg)']);
    expect(screen.getByLabelText('RBS (mg/dL)')).toHaveValue(95);
  });

  test.each([['DEPT-DEN'], [null]] as const)(
    'department %s: SpO₂ → Temp → BP → Pulse → Height → Weight, never a Pediatric/Non-Pediatric set — even for an infant',
    async (departmentId) => {
      withVisit(departmentId, { age: 5, ageUnit: 'MONTHS' });
      const user = userEvent.setup();
      render(<OPDPage />);
      await user.click(screen.getByText('Ravi Kumar'));
      await user.click(await screen.findByRole('button', { name: /edit visit/i }));

      expect(screen.queryByText('Pediatric Vitals')).not.toBeInTheDocument();
      expect(screen.queryByText('Non-Pediatric Vitals')).not.toBeInTheDocument();
      expect(vitalLabels()).toEqual(['SpO₂ (%)', 'Temperature (°F)', 'BP (mmHg)', 'Pulse (bpm)', 'Height (cm)', 'Weight (kg)']);
    },
  );

  test('switching away from Pediatric to another department shows the default set and saves the department', async () => {
    withVisit('DEPT-PED', { age: 5, ageUnit: 'MONTHS' });
    mockUsers.mockReturnValue({
      data: { data: [{ ...DOCTOR_1, departmentIds: ['DEPT-PED', 'DEPT-DEN'] }] }, isFetching: false,
    });
    mockUpdateVisit.mockResolvedValue({ ...VISIT_WITH_VITALS, departmentId: 'DEPT-DEN' });
    const user = userEvent.setup();
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
    expect(vitalLabels()).toEqual(['PR (bpm)', 'RR (/min)', 'SpO₂ (%)', 'BP (mmHg)', 'Height/Length (cm)', 'Weight (kg)', 'Head Circumference (cm)']);

    await user.selectOptions(screen.getByLabelText('Department'), 'DEPT-DEN');
    expect(screen.queryByText('Pediatric Vitals')).not.toBeInTheDocument();
    expect(vitalLabels()).toEqual(['SpO₂ (%)', 'Temperature (°F)', 'BP (mmHg)', 'Pulse (bpm)', 'Height (cm)', 'Weight (kg)']);

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    expect(mockUpdateVisit.mock.calls[0][0]).toMatchObject({ departmentId: 'DEPT-DEN' });
  });

  test('Edit mode pre-fills the Vitals inputs from previously saved values', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    expect(screen.getByLabelText('SpO₂ (%)')).toHaveValue(98);
    expect(screen.getByLabelText('Temperature (°F)')).toHaveValue(98.6);
    expect(screen.getByLabelText('BP (mmHg)')).toHaveValue('120/80');
    expect(screen.getByLabelText('Pulse (bpm)')).toHaveValue(72);
    expect(screen.getByLabelText('Height (cm)')).toHaveValue(172);
    expect(screen.getByLabelText(/weight/i)).toHaveValue(68.5);
  });

  test('saving Vitals sends numeric fields as numbers and blank fields as null', async () => {
    mockUpdateVisit.mockResolvedValue({ ...VISIT_WITH_VITALS });
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight/i), '70.2');
    await user.clear(screen.getByLabelText('BP (mmHg)')); // clear → should send null
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    const sentBody = mockUpdateVisit.mock.calls[0][0] as { vitals: Record<string, unknown> };
    expect(sentBody.vitals).toEqual({
      spo2: 98, bodyTemperature: 98.6, bloodPressure: null, pulse: 72, height: 172, weight: 70.2,
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

    // Rendered directly below the Weight input, not in the form-level banner.
    const weightError = await screen.findByText(/weight must be between/i);
    const weightInput = screen.getByLabelText(/weight/i);
    expect(weightInput.parentElement).toContainElement(weightError);
    expect(weightInput).toHaveAttribute('aria-invalid', 'true');
    expect(weightInput).toHaveAttribute('aria-describedby', weightError.id);
    expect(weightError).not.toHaveClass('bg-destructive/10');
    expect(mockUpdateVisit).not.toHaveBeenCalled();
  });

  test('every invalid vital shows its own error below its field, and editing a field clears only its error', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText(/weight/i));
    await user.type(screen.getByLabelText(/weight/i), '9999');
    await user.clear(screen.getByLabelText('Pulse (bpm)'));
    await user.type(screen.getByLabelText('Pulse (bpm)'), '5');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    const weightError = await screen.findByText(/weight must be between/i);
    const pulseError  = screen.getByText(/Pulse must be between/i);
    expect(screen.getByLabelText(/weight/i).parentElement).toContainElement(weightError);
    expect(screen.getByLabelText('Pulse (bpm)').parentElement).toContainElement(pulseError);
    expect(mockUpdateVisit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Pulse (bpm)'), '0');
    expect(screen.queryByText(/Pulse must be between/i)).not.toBeInTheDocument();
    expect(screen.getByText(/weight must be between/i)).toBeInTheDocument();
  });

  test('a malformed blood pressure blocks submission with a validation error', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.clear(screen.getByLabelText('BP (mmHg)'));
    await user.type(screen.getByLabelText('BP (mmHg)'), 'high');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    const bpError = await screen.findByText(/blood pressure must be in the format/i);
    expect(screen.getByLabelText('BP (mmHg)').parentElement).toContainElement(bpError);
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

describe('OPDPage — queue pagination', () => {
  const VISIT = {
    visitId: 'OPD-PAGE0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: [], nurseIds: [], departmentId: null,
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    jest.clearAllMocks();
    mockGetOPDQueue.mockReturnValue({
      data: { data: [VISIT], total: 45, page: 1, limit: 20, totalPages: 3, openCount: 30, completedCount: 12 },
      isFetching: false, refetch: jest.fn(),
    });
  });

  test('requests page 1 with the page size, and stat cards use the server-side totals', () => {
    render(<OPDPage />);

    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    expect(screen.getByText('Showing 1–1 of 45 visits')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  test('Next requests the following page; Previous is disabled on page 1', async () => {
    const user = userEvent.setup();
    render(<OPDPage />);

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });

  test('pager is hidden when everything fits on one page, but the count still shows', () => {
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
    render(<OPDPage />);

    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1 visit')).toBeInTheDocument();
  });

  test('last page shows the partial range and disables Next', async () => {
    const rows = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ ...VISIT, visitId: `OPD-PAGE${String(from + i).padStart(4, '0')}` }));
    mockGetOPDQueue.mockImplementation((args: { page: number }) => ({
      data: {
        data: args.page === 3 ? rows(5, 41) : rows(20, (args.page - 1) * 20 + 1),
        total: 45, page: args.page, limit: 20, totalPages: 3,
      },
      isFetching: false, refetch: jest.fn(),
    }));
    const user = userEvent.setup();
    render(<OPDPage />);

    expect(screen.getByText('Showing 1–20 of 45 visits')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 21–40 of 45 visits')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Showing 41–45 of 45 visits')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('S. No. column is day-wise: starts at 1 and continues across pages via the page offset', async () => {
    const rows = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ ...VISIT, visitId: `OPD-SNO${String(from + i).padStart(5, '0')}` }));
    mockGetOPDQueue.mockImplementation((args: { page: number }) => ({
      data: {
        data: args.page === 3 ? rows(5, 41) : rows(20, (args.page - 1) * 20 + 1),
        total: 45, page: args.page, limit: 20, totalPages: 3,
      },
      isFetching: false, refetch: jest.fn(),
    }));
    const serials = () =>
      within(screen.getByRole('table')).getAllByRole('row').slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent);

    const user = userEvent.setup();
    render(<OPDPage />);
    expect(screen.getByRole('columnheader', { name: 'S. No.' })).toBeInTheDocument();
    expect(serials()[0]).toBe('1');
    expect(serials()[19]).toBe('20');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(serials()[0]).toBe('21');
    expect(serials()[19]).toBe('40');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(serials()).toEqual(['41', '42', '43', '44', '45']);
  });

  test('empty result shows "No visits" and no pager', () => {
    mockGetOPDQueue.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20, totalPages: 0, openCount: 0, completedCount: 0 },
      isFetching: false, refetch: jest.fn(),
    });
    render(<OPDPage />);

    expect(screen.getByText('No visits')).toBeInTheDocument();
    expect(screen.getByText('No visits for the selected filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });

  test('steps back to the new last page when the current page empties out', async () => {
    let totalPages = 3;
    mockGetOPDQueue.mockImplementation((args: { page: number }) => ({
      data: { data: [VISIT], total: totalPages * 20, page: args.page, limit: 20, totalPages },
      isFetching: false, refetch: jest.fn(),
    }));
    const user = userEvent.setup();
    const { rerender } = render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));

    // A visit on page 3 was deleted — the server now reports only 2 pages.
    totalPages = 2;
    rerender(<OPDPage />);

    await waitFor(() =>
      expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  afterEach(() => {
    mockUsers.mockReturnValue({ data: { data: [] }, isFetching: false });
  });

  test('paging right after mount is not reset by the search debounce', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<OPDPage />);
      await user.click(screen.getByRole('button', { name: 'Next' }));
      act(() => { jest.advanceTimersByTime(1000); });

      expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    } finally {
      jest.useRealTimers();
    }
  });

  test('changing the doctor filter or searching resets to page 1', async () => {
    mockUsers.mockReturnValue({
      data: { data: [{ userId: 'doc-1', name: 'Dr. Mehta', role: 'DOCTOR', departmentIds: [] }] },
      isFetching: false,
    });
    const user = userEvent.setup();
    render(<OPDPage />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    fireEvent.change(screen.getByDisplayValue('All Doctors'), { target: { value: 'doc-1' } });
    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, doctorId: 'doc-1' }));

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    await user.type(screen.getByLabelText('Search'), 'ravi');
    await waitFor(() =>
      expect(mockGetOPDQueue).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'ravi' })),
    );
  });
});

describe('OPDPage — View/Edit department-filtered doctor multi-select', () => {
  const CARDIO = { departmentId: 'dept-cardio', name: 'Cardiology' };
  const NEURO  = { departmentId: 'dept-neuro',  name: 'Neurology' };
  const DR_CARDIO_1 = { userId: 'doc-c1', name: 'Dr. Heart', departmentIds: ['dept-cardio'] };
  const DR_CARDIO_2 = { userId: 'doc-c2', name: 'Dr. Pulse', departmentIds: ['dept-cardio'] };
  const DR_NEURO_1  = { userId: 'doc-n1', name: 'Dr. Brain', departmentIds: ['dept-neuro'] };
  const DR_BOTH     = { userId: 'doc-b1', name: 'Dr. Both',  departmentIds: ['dept-cardio', 'dept-neuro'] };
  const ALL_DOCTORS = [DR_CARDIO_1, DR_CARDIO_2, DR_NEURO_1, DR_BOTH];
  const VISIT = {
    visitId: 'OPD-DEPT0001', tenantId: 't1', patientId: 'PAT-1', fullName: 'Ravi Kumar',
    doctorIds: ['doc-c1', 'doc-b1'], nurseIds: [], departmentId: 'dept-cardio',
    visitDate: '2026-05-15T00:00:00.000Z', queueNumber: 1, status: 'OPEN',
    diagnosis: null, prescription: null, notes: null,
    createdAt: '2026-05-15T00:00:00.000Z', updatedAt: '2026-05-15T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'DOCTOR';
    mockUserId = 'doc-c1';
    mockUsers.mockReturnValue({ data: { data: ALL_DOCTORS }, isFetching: false });
    mockListDepartments.mockReturnValue({ data: [CARDIO, NEURO] });
    mockGetOPDQueue.mockReturnValue({ data: queuePage([VISIT]), isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockUpdateVisit.mockImplementation((body: Record<string, unknown>) => Promise.resolve({ ...VISIT, ...body }));
  });

  afterAll(() => {
    mockListDepartments.mockReturnValue({ data: undefined });
  });

  async function openEdit(user: ReturnType<typeof userEvent.setup>) {
    render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));
  }

  const doctorBox   = () => screen.getByRole('combobox', { name: /assigned doctors/i });
  const deptSelect  = () => screen.getByLabelText('Department') as HTMLSelectElement;
  const optionNames = () =>
    within(screen.getByRole('listbox')).queryAllByRole('option').map((o) => o.textContent);

  test("Edit mode preselects the visit department and its existing doctors, listing only that department's doctors", async () => {
    const user = userEvent.setup();
    await openEdit(user);

    expect(deptSelect().value).toBe('dept-cardio');
    expect(within(doctorBox()).getByTitle('Dr. Heart')).toBeInTheDocument();
    expect(within(doctorBox()).getByTitle('Dr. Both')).toBeInTheDocument();

    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Heart', 'Dr. Pulse', 'Dr. Both']);
    expect(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. Heart' })).toHaveAttribute('aria-selected', 'true');
  });

  test('changing department refreshes the doctor list and removes doctors outside the new department', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    await user.selectOptions(deptSelect(), 'dept-neuro');

    // Dr. Heart (Cardiology only) is dropped; Dr. Both (in Neurology too) stays.
    expect(within(doctorBox()).queryByTitle('Dr. Heart')).not.toBeInTheDocument();
    expect(within(doctorBox()).getByTitle('Dr. Both')).toBeInTheDocument();

    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Brain', 'Dr. Both']);
  });

  test('doctors can be searched and selected within the selected department, and the result is saved', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    await user.selectOptions(deptSelect(), 'dept-neuro');
    await user.click(doctorBox());
    await user.type(screen.getByRole('textbox', { name: /search doctors/i }), 'brain');
    expect(optionNames()).toEqual(['Dr. Brain']);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. Brain' }));
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateVisit).toHaveBeenCalled());
    expect(mockUpdateVisit.mock.calls[0][0]).toEqual(expect.objectContaining({
      visitId:   'OPD-DEPT0001',
      doctorIds: ['doc-b1', 'doc-n1'],
    }));
  });

  test('switching to a department with none of the assigned doctors clears them and flags the department/doctor mismatch', async () => {
    const user = userEvent.setup();
    mockGetOPDQueue.mockReturnValue({
      data: queuePage([{ ...VISIT, doctorIds: ['doc-c1'] }]), isFetching: false, refetch: jest.fn(),
    });
    await openEdit(user);

    await user.selectOptions(deptSelect(), 'dept-neuro');

    expect(within(doctorBox()).queryByTitle('Dr. Heart')).not.toBeInTheDocument();
    expect(screen.getAllByRole('alert').some((a) => /requires selecting a doctor/i.test(a.textContent ?? ''))).toBe(true);
  });

  test('selecting "All Departments" keeps the assigned doctors and lists every doctor', async () => {
    const user = userEvent.setup();
    await openEdit(user);

    await user.selectOptions(deptSelect(), '');

    expect(within(doctorBox()).getByTitle('Dr. Heart')).toBeInTheDocument();
    expect(within(doctorBox()).getByTitle('Dr. Both')).toBeInTheDocument();
    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Heart', 'Dr. Pulse', 'Dr. Brain', 'Dr. Both']);
  });

  test('a department change made before the doctor list loads prunes once the list arrives, not before', async () => {
    const user = userEvent.setup();
    mockUsers.mockReturnValue({ data: undefined, isFetching: true });
    const { rerender } = render(<OPDPage />);
    await user.click(screen.getByText('Ravi Kumar'));
    await user.click(await screen.findByRole('button', { name: /edit visit/i }));

    await user.selectOptions(deptSelect(), 'dept-neuro');
    // Nothing pruned while the list is still loading.
    expect(within(doctorBox()).getAllByRole('button', { name: /remove/i })).toHaveLength(2);

    mockUsers.mockReturnValue({ data: { data: ALL_DOCTORS }, isFetching: false });
    rerender(<OPDPage />);

    await waitFor(() => expect(within(doctorBox()).queryByTitle('Dr. Heart')).not.toBeInTheDocument());
    expect(within(doctorBox()).getByTitle('Dr. Both')).toBeInTheDocument();
  });
});

describe('OPDPage — New Visit department-filtered doctor multi-select', () => {
  const CARDIO = { departmentId: 'dept-cardio', name: 'Cardiology' };
  const NEURO  = { departmentId: 'dept-neuro',  name: 'Neurology' };
  const DR_CARDIO_1 = { userId: 'doc-c1', name: 'Dr. Heart', departmentIds: ['dept-cardio'] };
  const DR_CARDIO_2 = { userId: 'doc-c2', name: 'Dr. Pulse', departmentIds: ['dept-cardio'] };
  const DR_NEURO_1  = { userId: 'doc-n1', name: 'Dr. Brain', departmentIds: ['dept-neuro'] };
  const DR_BOTH     = { userId: 'doc-b1', name: 'Dr. Both',  departmentIds: ['dept-cardio', 'dept-neuro'] };
  const ALL_DOCTORS = [DR_CARDIO_1, DR_CARDIO_2, DR_NEURO_1, DR_BOTH];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'RECEPTIONIST';
    mockUserId = undefined;
    mockUsers.mockReturnValue({ data: { data: ALL_DOCTORS }, isFetching: false });
    mockListDepartments.mockReturnValue({ data: [CARDIO, NEURO] });
    mockGetOPDQueue.mockReturnValue({ data: queuePage([]), isFetching: false, refetch: jest.fn() });
    mockGetAvailableOpdNurses.mockReturnValue({ data: [] });
    mockGetDoctorNurseAssignments.mockReturnValue({ data: undefined });
    mockGetOPDPaymentValidity.mockReturnValue({ data: undefined, isFetching: false, refetch: jest.fn() });
  });

  afterAll(() => {
    mockListDepartments.mockReturnValue({ data: undefined });
  });

  const doctorBox   = () => screen.getByRole('combobox', { name: /assign doctors/i });
  const deptSelect  = () => screen.getByLabelText('Department') as HTMLSelectElement;
  const optionNames = () =>
    within(screen.getByRole('listbox')).queryAllByRole('option').map((o) => o.textContent);

  async function openNewVisit(user: ReturnType<typeof userEvent.setup>) {
    const utils = render(<OPDPage />);
    await user.click(screen.getByRole('button', { name: /new visit/i }));
    return utils;
  }

  async function pickDoctors(user: ReturnType<typeof userEvent.setup>, names: string[]) {
    await user.click(doctorBox());
    for (const name of names) {
      await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }));
    }
    await user.keyboard('{Escape}');
  }

  test('selecting a department immediately lists only that department\'s doctors', async () => {
    const user = userEvent.setup();
    await openNewVisit(user);

    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Heart', 'Dr. Pulse', 'Dr. Brain', 'Dr. Both']);
    await user.keyboard('{Escape}');

    await user.selectOptions(deptSelect(), 'dept-cardio');
    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Heart', 'Dr. Pulse', 'Dr. Both']);
  });

  test('changing department clears selected doctors from the previous department, keeping shared ones', async () => {
    const user = userEvent.setup();
    await openNewVisit(user);

    await user.selectOptions(deptSelect(), 'dept-cardio');
    await pickDoctors(user, ['Dr. Heart', 'Dr. Both']);
    expect(within(doctorBox()).getByTitle('Dr. Heart')).toBeInTheDocument();

    await user.selectOptions(deptSelect(), 'dept-neuro');

    expect(within(doctorBox()).queryByTitle('Dr. Heart')).not.toBeInTheDocument();
    expect(within(doctorBox()).getByTitle('Dr. Both')).toBeInTheDocument();
    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Brain', 'Dr. Both']);
  });

  test('doctors can be searched and selected from the refreshed list', async () => {
    const user = userEvent.setup();
    await openNewVisit(user);

    await user.selectOptions(deptSelect(), 'dept-cardio');
    await pickDoctors(user, ['Dr. Heart']);
    await user.selectOptions(deptSelect(), 'dept-neuro');

    await user.click(doctorBox());
    await user.type(screen.getByRole('textbox', { name: /search doctors/i }), 'brain');
    expect(optionNames()).toEqual(['Dr. Brain']);
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Dr. Brain' }));
    await user.keyboard('{Escape}');

    expect(within(doctorBox()).getByTitle('Dr. Brain')).toBeInTheDocument();
    expect(within(doctorBox()).queryByTitle('Dr. Heart')).not.toBeInTheDocument();
  });

  test('switching to "All Departments" keeps the current selection and lists every doctor', async () => {
    const user = userEvent.setup();
    await openNewVisit(user);

    await user.selectOptions(deptSelect(), 'dept-cardio');
    await pickDoctors(user, ['Dr. Heart']);
    await user.selectOptions(deptSelect(), '');

    expect(within(doctorBox()).getByTitle('Dr. Heart')).toBeInTheDocument();
    await user.click(doctorBox());
    expect(optionNames()).toEqual(['Dr. Heart', 'Dr. Pulse', 'Dr. Brain', 'Dr. Both']);
  });

  test('doctors picked under "All Departments" outside a newly chosen department are cleared', async () => {
    const user = userEvent.setup();
    await openNewVisit(user);

    await pickDoctors(user, ['Dr. Brain', 'Dr. Pulse']);
    await user.selectOptions(deptSelect(), 'dept-cardio');

    expect(within(doctorBox()).queryByTitle('Dr. Brain')).not.toBeInTheDocument();
    expect(within(doctorBox()).getByTitle('Dr. Pulse')).toBeInTheDocument();
  });
});
