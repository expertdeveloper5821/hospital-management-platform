import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseListAdmissionsQuery = jest.fn();
const mockDischarge = jest.fn();
const mockUpdateAdmission = jest.fn();
const mockDeleteAdmission = jest.fn();
const mockUseListPaymentsQuery = jest.fn();
const mockCreateAdmission = jest.fn();
const mockCreateManualPayment = jest.fn();
let mockWards: unknown[] = [];
let mockBeds: unknown[] = [];
let mockDoctors: unknown[] = [];
// Simulates the doctor list still being fetched (RTK Query: no data yet).
let mockDoctorsLoading = false;
let mockDepartments: unknown[] | undefined;

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: mockWards, isLoading: false }),
  useListBedsQuery: () => ({ data: mockBeds }),
  useListAdmissionsQuery: (...args: unknown[]) => mockUseListAdmissionsQuery(...args),
  useCreateAdmissionMutation: () => [mockCreateAdmission, { isLoading: false }],
  useUpdateAdmissionMutation: () => [mockUpdateAdmission, { isLoading: false }],
  useDeleteAdmissionMutation: () => [mockDeleteAdmission, { isLoading: false }],
  useAddProgressNoteMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionPrescriptionMutation: () => [jest.fn(), { isLoading: false }],
  useDischargePatientMutation: () => [mockDischarge, { isLoading: false }],
  useDownloadDischargeSummaryMutation: () => [jest.fn(), { isLoading: false }],
  usePrintDischargeSummaryMutation:    () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [mockCreateManualPayment, { isLoading: false }],
  useListPaymentsQuery: (...args: unknown[]) => mockUseListPaymentsQuery(...args),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => (mockDoctorsLoading ? { data: undefined, isLoading: true } : { data: { data: mockDoctors } }),
}));

// Patients returned for any search; responses are cached per query so `data`
// keeps a stable identity across re-renders (like RTK Query's cache).
let mockSearchPatients: unknown[] = [];
const mockSearchResponses = new Map<string, unknown>();
jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: ({ q }: { q: string }, opts?: { skip?: boolean }) => {
    if (opts?.skip) return { data: undefined, isFetching: false };
    if (!mockSearchResponses.has(q)) mockSearchResponses.set(q, { data: mockSearchPatients });
    return { data: mockSearchResponses.get(q), isFetching: false };
  },
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: mockDepartments }),
}));

jest.mock('@/store/api/packages.api', () => ({
  useListPackagesQuery: () => ({ data: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 } }),
}));

// The IPD New Admission modal's "Add Patient" button reuses the shared
// register-patient modal (same component the OPD New Visit flow uses) — its
// own form/validation/submission logic is exercised elsewhere, so here it's
// stubbed to a minimal component that lets us verify the wiring: the button
// opens it, and its onSuccess callback selects the new patient.
jest.mock('@/components/patients/patient-form-modal', () => ({
  PatientFormModal: ({ onSuccess, onClose }: { onSuccess?: (p: unknown) => void; onClose: () => void }) => (
    <div data-testid="patient-form-modal">
      <button
        onClick={() => onSuccess?.({ patientId: 'PAT-NEW-1', fullName: 'Newly Registered Patient', mobileNumber: '9998887776' })}
      >
        Mock Register Patient
      </button>
      <button onClick={onClose}>Mock Close</button>
    </div>
  ),
}));

let mockRole = 'RECEPTIONIST';
let mockUserId: string | undefined;

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: mockUserId } } }),
  useAppDispatch: () => jest.fn(),
}));

import IPDPage from '@/app/(dashboard)/ipd/page';

const EMPTY_ADMISSIONS = { data: { data: [], total: 0, totalPages: 1 }, isLoading: false, isFetching: false, refetch: jest.fn() };

beforeEach(() => {
  mockUseListAdmissionsQuery.mockReturnValue(EMPTY_ADMISSIONS);
  mockWards = [];
  mockBeds = [];
  mockDoctors = [];
  mockDoctorsLoading = false;
  mockDepartments = undefined;
  mockSearchPatients = [];
  mockSearchResponses.clear();
  mockUserId = undefined;
  mockCreateAdmission.mockReset();
  mockCreateManualPayment.mockReset();
  mockDischarge.mockReset();
  mockUpdateAdmission.mockReset();
  mockDeleteAdmission.mockReset();
  mockUseListPaymentsQuery.mockReset();
  mockUseListPaymentsQuery.mockReturnValue({ data: undefined });
});

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

describe('IPDPage — New Admission Add Patient flow', () => {
  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
  });

  test('shows an Add Patient button next to the patient search field', () => {
    render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: /new admission/i }));
    expect(screen.getByRole('button', { name: /add patient/i })).toBeInTheDocument();
  });

  test('clicking Add Patient opens the shared register-patient modal', () => {
    render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: /new admission/i }));
    fireEvent.click(screen.getByRole('button', { name: /add patient/i }));
    expect(screen.getByTestId('patient-form-modal')).toBeInTheDocument();
  });

  test('successfully registering a new patient auto-selects them in the admission form and closes the register modal', () => {
    render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: /new admission/i }));
    fireEvent.click(screen.getByRole('button', { name: /add patient/i }));

    fireEvent.click(screen.getByRole('button', { name: /mock register patient/i }));

    expect(screen.queryByTestId('patient-form-modal')).not.toBeInTheDocument();
    expect(screen.getByText('Newly Registered Patient')).toBeInTheDocument();
    expect(screen.getByText(/PAT-NEW-1/)).toBeInTheDocument();
  });
});

describe('IPDPage — New Admission patient search keyboard navigation', () => {
  const P1 = { patientId: 'PAT-1', fullName: 'Asha Rao',   mobileNumber: '9000000001' };
  const P2 = { patientId: 'PAT-2', fullName: 'Asha Mehta', mobileNumber: '9000000002' };
  const P3 = { patientId: 'PAT-3', fullName: 'Asha Iyer',  mobileNumber: '9000000003' };
  const scrollIntoView = jest.fn();

  beforeEach(() => {
    mockRole = 'RECEPTIONIST';
    mockSearchPatients = [P1, P2, P3];
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  const searchBox = () => screen.getByPlaceholderText(/search by name or mobile/i);
  const option    = (name: string) => within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(name) });

  async function openAndSearch(user: ReturnType<typeof userEvent.setup>, q = 'asha') {
    render(<IPDPage />);
    await user.click(screen.getByRole('button', { name: /new admission/i }));
    await user.type(searchBox(), q);
    // Wait out the 300 ms debounce so the results are live.
    await waitFor(() => expect(option('Asha Rao')).toBeInTheDocument());
  }

  test('ArrowDown/ArrowUp move the highlight with wrap-around and scroll it into view', async () => {
    const user = userEvent.setup();
    await openAndSearch(user);
    expect(searchBox()).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    expect(option('Asha Rao')).toHaveAttribute('aria-selected', 'true');
    expect(searchBox()).toHaveAttribute('aria-activedescendant', option('Asha Rao').id);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(option('Asha Iyer')).toHaveAttribute('aria-selected', 'true');
    expect(option('Asha Rao')).toHaveAttribute('aria-selected', 'false');

    // Down from the last wraps to the first; Up from the first wraps to the last.
    await user.keyboard('{ArrowDown}');
    expect(option('Asha Rao')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowUp}');
    expect(option('Asha Iyer')).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowUp with nothing highlighted jumps to the last patient', async () => {
    const user = userEvent.setup();
    await openAndSearch(user);

    await user.keyboard('{ArrowUp}');
    expect(option('Asha Iyer')).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter selects the highlighted patient without submitting the admission form', async () => {
    const user = userEvent.setup();
    await openAndSearch(user);

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByText('Asha Mehta')).toBeInTheDocument();
    expect(screen.getByText(/PAT-2/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear patient selection/i })).toBeInTheDocument();
    // The form did not submit (no validation error, no create call).
    expect(screen.queryByText(/select a ward/i)).not.toBeInTheDocument();
    expect(mockCreateAdmission).not.toHaveBeenCalled();
  });

  test('a new search resets the highlight', async () => {
    const user = userEvent.setup();
    await openAndSearch(user);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(option('Asha Mehta')).toHaveAttribute('aria-selected', 'true');

    await user.type(searchBox(), ' m');
    await waitFor(() => expect(searchBox()).not.toHaveAttribute('aria-activedescendant'));
    expect(option('Asha Mehta')).toHaveAttribute('aria-selected', 'false');

    // Navigation starts over from the top of the new results.
    await user.keyboard('{ArrowDown}');
    expect(option('Asha Rao')).toHaveAttribute('aria-selected', 'true');
  });

  test('mouse selection still works', async () => {
    const user = userEvent.setup();
    await openAndSearch(user);

    await user.click(option('Asha Iyer'));
    expect(screen.getByText('Asha Iyer')).toBeInTheDocument();
    expect(screen.getByText(/PAT-3/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('IPDPage — Progress note staff name display', () => {
  const admissionWithNotes = {
    admissionId:       'adm-1',
    patientId:         'PAT-00000001',
    fullName:          'Test Patient',
    wardId:            'ward-1',
    wardName:          'General Ward',
    bedId:             'bed-1',
    bedNumber:         'G-01',
    assignedDoctorIds: [],
    departmentId:      null,
    status:            'ADMITTED',
    admissionDate:     '2026-01-01T00:00:00.000Z',
    dischargeDate:     null,
    progressNotes: [
      {
        noteId:    'note-1',
        doctorId:  'nurse-user-id',
        note:      'Administered medication as prescribed.',
        timestamp: '2026-01-01T10:00:00.000Z',
        staffName: 'Nurse Priya Singh',
      },
    ],
  };

  test('shows the backend-provided staff name for a note authored by a Nurse', () => {
    mockRole = 'RECEPTIONIST';
    mockUseListAdmissionsQuery.mockReturnValue({
      data: { data: [admissionWithNotes], total: 1, totalPages: 1 },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });

    render(<IPDPage />);

    const notesButtons = screen.getAllByRole('button', { name: /notes/i });
    fireEvent.click(notesButtons[0]);

    expect(screen.getByText('Nurse Priya Singh')).toBeInTheDocument();
    // Must not fall back to the old doctor-only placeholder for a nurse's note.
    expect(screen.queryByText(/^Dr\./)).not.toBeInTheDocument();
  });
});

describe('IPDPage — Prescription & Discharge permissions', () => {
  const admission = {
    admissionId:       'adm-rx-1',
    patientId:         'PAT-00000002',
    fullName:          'Rx Patient',
    wardId:            'ward-1',
    wardName:          'General Ward',
    bedId:             'bed-1',
    bedNumber:         'G-01',
    assignedDoctorIds: ['doc-assigned'],
    departmentId:      null,
    status:            'ADMITTED',
    admissionDate:     '2026-01-01T00:00:00.000Z',
    dischargeDate:     null,
    progressNotes:     [],
    vitals:            { weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: null },
    prescription:          'Tab. Paracetamol 500mg BD',
    dischargeSummaryNotes: null,
  };

  function renderWith(role: string, userId?: string) {
    mockRole = role;
    mockUserId = userId;
    mockUseListAdmissionsQuery.mockReturnValue({
      data: { data: [admission], total: 1, totalPages: 1 },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    render(<IPDPage />);
  }

  const dischargeButtons = () => screen.queryAllByRole('button', { name: /^discharge$/i });

  test('HOSPITAL_ADMIN can discharge', () => {
    renderWith('HOSPITAL_ADMIN', 'admin-1');
    expect(dischargeButtons().length).toBeGreaterThan(0);
  });

  test('assigned Doctor can discharge', () => {
    renderWith('DOCTOR', 'doc-assigned');
    expect(dischargeButtons().length).toBeGreaterThan(0);
  });

  test('unassigned Doctor cannot discharge', () => {
    renderWith('DOCTOR', 'doc-other');
    expect(dischargeButtons()).toHaveLength(0);
  });

  test('Nurse on the admission ward can discharge', () => {
    mockWards = [{ wardId: 'ward-1', name: 'General Ward', floor: null, assignedNurseIds: ['nurse-1'], tenantId: 't', createdAt: '' }];
    renderWith('NURSE', 'nurse-1');
    expect(dischargeButtons().length).toBeGreaterThan(0);
  });

  test('Nurse not on the admission ward cannot discharge', () => {
    mockWards = [{ wardId: 'ward-1', name: 'General Ward', floor: null, assignedNurseIds: ['nurse-1'], tenantId: 't', createdAt: '' }];
    renderWith('NURSE', 'nurse-2');
    expect(dischargeButtons()).toHaveLength(0);
  });

  test('RECEPTIONIST cannot discharge', () => {
    renderWith('RECEPTIONIST', 'rec-1');
    expect(dischargeButtons()).toHaveLength(0);
  });

  test('view panel shows the prescription; the Edit form offers it to an assigned Doctor', () => {
    renderWith('DOCTOR', 'doc-assigned');
    fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
    expect(screen.getByText('Tab. Paracetamol 500mg BD')).toBeInTheDocument();
    // No separate prescription Add/Edit button — only the admission Edit.
    expect(screen.queryByRole('button', { name: /^add$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^edit$/i })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByLabelText('Prescription')).toHaveValue('Tab. Paracetamol 500mg BD');
  });

  test('Edit form hides Prescription from RECEPTIONIST (read-only in view)', () => {
    renderWith('RECEPTIONIST', 'rec-1');
    fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
    expect(screen.getByText('Tab. Paracetamol 500mg BD')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.queryByLabelText('Prescription')).not.toBeInTheDocument();
  });

  test('view panel does not show a separate Discharge Summary section', () => {
    mockUseListAdmissionsQuery.mockReturnValue({
      data: { data: [{ ...admission, status: 'DISCHARGED', dischargeDate: '2026-01-05T00:00:00.000Z', dischargeSummaryNotes: 'Stable at discharge.' }], total: 1, totalPages: 1 },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    mockRole = 'HOSPITAL_ADMIN';
    render(<IPDPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
    expect(screen.queryByText('Stable at discharge.')).not.toBeInTheDocument();
  });

  test('Confirm Discharge opens the notes step; discharge requires notes and sends them', async () => {
    mockDischarge.mockResolvedValue({ data: { ...admission, status: 'DISCHARGED', dischargeDate: '2026-01-05T00:00:00.000Z', dischargeSummaryNotes: 'Stable.' } });
    renderWith('HOSPITAL_ADMIN', 'admin-1');

    fireEvent.click(dischargeButtons()[0]);
    fireEvent.click(screen.getByRole('button', { name: /confirm discharge/i }));
    expect(mockDischarge).not.toHaveBeenCalled();
    expect(screen.getByText('Discharge Summary Notes')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /submit & discharge/i }));
    expect(screen.getByText(/discharge summary notes are required/i)).toBeInTheDocument();
    expect(mockDischarge).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: '  Stable.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /submit & discharge/i }));

    await waitFor(() => expect(mockDischarge).toHaveBeenCalledWith({ admissionId: 'adm-rx-1', dischargeSummaryNotes: 'Stable.' }));
    expect(await screen.findByText('Patient Discharged')).toBeInTheDocument();
  });
});

describe('IPDPage — admissions pagination', () => {
  const makeRows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({
    admissionId: `adm-pg-${offset + i}`, patientId: `PAT-${offset + i}`, fullName: `Patient ${offset + i}`,
    wardId: 'w1', wardName: 'General', bedId: 'b1', bedNumber: '1',
    assignedDoctorIds: [], departmentId: null, status: 'ADMITTED',
    admissionDate: '2026-01-01T00:00:00.000Z', dischargeDate: null, progressNotes: [],
  }));
  // Serves whichever page was requested out of `total` rows — mirrors the
  // backend's paginated envelope.
  const paged = (total: number) => (args: { page: number; limit: number }) => {
    const start = (args.page - 1) * args.limit;
    return {
      data: {
        data: makeRows(Math.max(0, Math.min(args.limit, total - start)), start),
        total, page: args.page, limit: args.limit, totalPages: Math.ceil(total / args.limit),
      },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    };
  };

  test('pager stays visible with an active search and Next requests the next page of matches', async () => {
    mockRole = 'RECEPTIONIST';
    mockUseListAdmissionsQuery.mockImplementation(paged(25));

    render(<IPDPage />);
    fireEvent.change(screen.getByPlaceholderText(/search by patient name/i), { target: { value: 'ravi' } });

    // After the 400ms debounce the search is sent to the server, page reset to 1.
    await waitFor(() =>
      expect(mockUseListAdmissionsQuery).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ravi', page: 1, limit: 10 })),
    );
    expect(screen.getByText('Showing 1–10 of 25 admissions')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockUseListAdmissionsQuery).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ravi', page: 2 }));
    expect(screen.getByText('Showing 11–20 of 25 admissions')).toBeInTheDocument();
  });

  test('last page shows the partial range and disables Next', () => {
    mockRole = 'RECEPTIONIST';
    mockUseListAdmissionsQuery.mockImplementation(paged(25));

    render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Showing 21–25 of 25 admissions')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('changing the status filter resets to page 1', () => {
    mockRole = 'RECEPTIONIST';
    mockUseListAdmissionsQuery.mockImplementation(paged(25));

    render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockUseListAdmissionsQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));

    fireEvent.change(screen.getByDisplayValue('Admitted'), { target: { value: 'DISCHARGED' } });
    expect(mockUseListAdmissionsQuery).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'DISCHARGED', page: 1 }));
  });

  test('steps back to the new last page when the result set shrinks', async () => {
    mockRole = 'RECEPTIONIST';
    let total = 11;
    mockUseListAdmissionsQuery.mockImplementation((args: { page: number; limit: number }) => paged(total)(args));

    const { rerender } = render(<IPDPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 11–11 of 11 admissions')).toBeInTheDocument();

    // The only row on page 2 is discharged/deleted elsewhere.
    total = 10;
    rerender(<IPDPage />);

    await waitFor(() =>
      expect(mockUseListAdmissionsQuery).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );
    expect(screen.getByText('Showing 1–10 of 10 admissions')).toBeInTheDocument();
  });

  test('offline-cache fallback (all cached matches on one page) reads 1–N of N with no pager', () => {
    mockRole = 'RECEPTIONIST';
    mockUseListAdmissionsQuery.mockReturnValue({
      data: { data: makeRows(14), total: 14, page: 1, limit: 14, totalPages: 1 },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });

    render(<IPDPage />);
    expect(screen.getByText('Showing 1–14 of 14 admissions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('empty result shows "No admissions" and no pager', () => {
    mockRole = 'RECEPTIONIST';
    render(<IPDPage />);
    expect(screen.getByText('No admissions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });
});

describe('IPDPage — Receptionist edit scope, delete and payment lookup', () => {
  const admitted = {
    admissionId:       'adm-rc-1',
    patientId:         'PAT-00000003',
    fullName:          'Reception Patient',
    wardId:            'ward-1',
    wardName:          'General Ward',
    bedId:             'bed-1',
    bedNumber:         'G-01',
    assignedDoctorIds: [],
    departmentId:      null,
    status:            'ADMITTED',
    admissionDate:     '2026-01-01T00:00:00.000Z',
    dischargeDate:     null,
    progressNotes:     [],
    vitals:            { weight: 60, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: null },
    prescription:          null,
    dischargeSummaryNotes: null,
  };

  function renderWith(role: string, row: Record<string, unknown> = admitted) {
    mockRole = role;
    mockUserId = `${role.toLowerCase()}-1`;
    mockUseListAdmissionsQuery.mockReturnValue({
      data: { data: [row], total: 1, totalPages: 1 },
      isLoading: false, isFetching: false, refetch: jest.fn(),
    });
    render(<IPDPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
  }

  test('RECEPTIONIST Edit form keeps Department/Doctors/Ward/Bed and adds Patient + Vitals', () => {
    renderWith('RECEPTIONIST');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));

    expect(screen.getByText('Patient', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^change$/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Weight (kg)')).toHaveValue(60);
    expect(screen.getByLabelText('Ward')).toBeInTheDocument();
    expect(screen.getByLabelText(/department/i)).toBeInTheDocument();
    expect(screen.getByText('Assigned Doctors')).toBeInTheDocument();
    expect(screen.getByText('Bed')).toBeInTheDocument();
  });

  test('RECEPTIONIST save with only a vitals change sends just vitals', async () => {
    mockUpdateAdmission.mockReturnValue({ unwrap: () => Promise.resolve({ ...admitted, vitals: { ...admitted.vitals, weight: 62 } }) });
    renderWith('RECEPTIONIST');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '62' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockUpdateAdmission).toHaveBeenCalledTimes(1));
    const body = mockUpdateAdmission.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(['admissionId', 'vitals']);
    expect(body.vitals.weight).toBe(62);
  });

  test('invalid vitals show each error directly below its own field and block the save', async () => {
    renderWith('RECEPTIONIST');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '9999' } });
    fireEvent.change(screen.getByLabelText('Blood Pressure (mmHg)'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    const weightError = await screen.findByText(/weight must be between/i);
    const bpError     = screen.getByText(/blood pressure must be in the format/i);
    const weightInput = screen.getByLabelText('Weight (kg)');
    expect(weightInput.parentElement).toContainElement(weightError);
    expect(screen.getByLabelText('Blood Pressure (mmHg)').parentElement).toContainElement(bpError);
    expect(weightInput).toHaveAttribute('aria-invalid', 'true');
    expect(weightInput).toHaveAttribute('aria-describedby', weightError.id);
    expect(weightError).not.toHaveClass('bg-destructive/10');
    expect(mockUpdateAdmission).not.toHaveBeenCalled();

    // Fixing one field clears only that field's message.
    fireEvent.change(weightInput, { target: { value: '62' } });
    expect(screen.queryByText(/weight must be between/i)).not.toBeInTheDocument();
    expect(screen.getByText(/blood pressure must be in the format/i)).toBeInTheDocument();
  });

  test('Non-receptionist edit form is unchanged (Admin still sees Ward, no Patient picker, no Vitals)', () => {
    renderWith('ADMIN');
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.getByLabelText('Ward')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^change$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Weight (kg)')).not.toBeInTheDocument();
  });

  test('RECEPTIONIST can delete an ADMITTED admission after confirming', async () => {
    mockDeleteAdmission.mockReturnValue({ unwrap: () => Promise.resolve(undefined) });
    renderWith('RECEPTIONIST');
    fireEvent.click(screen.getByRole('button', { name: /delete admission/i }));
    expect(screen.getByText(/payment will be cancelled/i)).toBeInTheDocument();
    expect(mockDeleteAdmission).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /yes, delete admission/i }));
    await waitFor(() => expect(mockDeleteAdmission).toHaveBeenCalledWith('adm-rc-1'));
  });

  test('RECEPTIONIST sees no Delete for a DISCHARGED admission', () => {
    renderWith('RECEPTIONIST', { ...admitted, status: 'DISCHARGED', dischargeDate: '2026-01-05T00:00:00.000Z' });
    expect(screen.queryByRole('button', { name: /delete admission/i })).not.toBeInTheDocument();
  });

  test.each(['HOSPITAL_ADMIN', 'ADMIN', 'DOCTOR', 'NURSE', 'MANAGER'])('%s sees no Delete Admission button', (role) => {
    renderWith(role);
    expect(screen.queryByRole('button', { name: /delete admission/i })).not.toBeInTheDocument();
  });

  test('payment is looked up by the admission reference, not patient + date', () => {
    renderWith('RECEPTIONIST');
    expect(mockUseListPaymentsQuery).toHaveBeenCalledWith(
      { referenceType: 'IPD_ADMISSION', referenceId: 'adm-rc-1', limit: 1 },
      { skip: false },
    );
  });
});

describe('IPDPage — Doctor multi-select (New Admission and Edit)', () => {
  const DOCTOR_1 = { userId: 'doc-1', name: 'Dr. ABC', email: 'abc@h.com', departmentIds: [] };
  const DOCTOR_2 = { userId: 'doc-2', name: 'Dr. DEF', email: 'def@h.com', departmentIds: [] };
  const admitted = {
    admissionId:       'adm-doc-1',
    patientId:         'PAT-00000009',
    fullName:          'Doctor Patient',
    wardId:            'ward-1',
    wardName:          'General Ward',
    bedId:             'bed-1',
    bedNumber:         'G-01',
    assignedDoctorIds: ['doc-1'],
    departmentId:      null,
    status:            'ADMITTED',
    admissionDate:     '2026-01-01T00:00:00.000Z',
    dischargeDate:     null,
    progressNotes:     [],
    vitals:            { weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: null },
    prescription:          null,
    dischargeSummaryNotes: null,
  };

  beforeEach(() => {
    mockDoctors = [DOCTOR_1, DOCTOR_2];
  });

  const doctorBox = () => screen.getByRole('combobox', { name: /assigned doctors/i });
  const listbox   = () => screen.getByRole('listbox');

  describe('New Admission', () => {
    beforeEach(() => {
      mockRole  = 'RECEPTIONIST';
      mockWards = [{ wardId: 'ward-1', name: 'General Ward', floor: null }];
      mockBeds  = [{ bedId: 'bed-1', bedNumber: 'G-01', isOccupied: false }];
    });

    test('selects/deselects multiple doctors without closing, shows ✓ options and removable tags, no Add Doctor button', async () => {
      const user = userEvent.setup();
      render(<IPDPage />);
      await user.click(screen.getByRole('button', { name: /new admission/i }));

      expect(screen.queryByRole('button', { name: /add doctor/i })).not.toBeInTheDocument();

      await user.click(doctorBox());
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' }));
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
      expect(doctorBox()).toHaveAttribute('aria-expanded', 'true');
      expect(within(listbox()).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'true');
      expect(within(listbox()).queryByRole('checkbox')).not.toBeInTheDocument();
      expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
      expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();

      // Re-selecting deselects.
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' }));
      expect(within(listbox()).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'false');
      expect(within(doctorBox()).queryByTitle('Dr. ABC')).not.toBeInTheDocument();

      // Search narrows the list.
      await user.type(screen.getByLabelText(/search doctors/i), 'def');
      expect(within(listbox()).queryByRole('option', { name: 'Dr. ABC' })).not.toBeInTheDocument();

      // Escape closes; tag × removes.
      await user.keyboard('{Escape}');
      expect(doctorBox()).toHaveAttribute('aria-expanded', 'false');
      await user.click(within(doctorBox()).getByRole('button', { name: /remove dr\. def/i }));
      expect(within(doctorBox()).queryByTitle('Dr. DEF')).not.toBeInTheDocument();

      // Outside click closes.
      await user.click(doctorBox());
      await user.click(screen.getByText('Payment *'));
      expect(doctorBox()).toHaveAttribute('aria-expanded', 'false');
    });

    test('creates the admission with every selected doctor, in selection order', async () => {
      mockCreateAdmission.mockReturnValue({ unwrap: () => Promise.resolve({ ...admitted, admissionId: 'adm-new-1' }) });
      mockCreateManualPayment.mockReturnValue({ unwrap: () => Promise.resolve({}) });
      const user = userEvent.setup();
      render(<IPDPage />);
      await user.click(screen.getByRole('button', { name: /new admission/i }));

      await user.click(screen.getByRole('button', { name: /add patient/i }));
      await user.click(screen.getByRole('button', { name: /mock register patient/i }));
      await user.selectOptions(screen.getByLabelText('Ward'), 'ward-1');
      await user.click(screen.getByRole('button', { name: /G-01/ }));

      await user.click(doctorBox());
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' }));
      await user.keyboard('{Escape}');

      await user.type(screen.getByLabelText(/amount/i), '500');
      await user.click(screen.getByRole('button', { name: /^cash$/i }));
      await user.click(screen.getByRole('button', { name: /admit patient/i }));

      await waitFor(() => expect(mockCreateAdmission).toHaveBeenCalledTimes(1));
      expect(mockCreateAdmission.mock.calls[0][0]).toEqual(expect.objectContaining({
        patientId:         'PAT-NEW-1',
        wardId:            'ward-1',
        bedId:             'bed-1',
        assignedDoctorIds: ['doc-2', 'doc-1'],
      }));
    });

    describe('department changed after selecting doctors', () => {
      const CARDIO = { departmentId: 'dept-cardio', name: 'Cardiology' };
      const NEURO  = { departmentId: 'dept-neuro',  name: 'Neurology' };
      const DR_HEART = { userId: 'doc-1', name: 'Dr. ABC', email: 'abc@h.com', departmentIds: ['dept-cardio'] };
      const DR_BOTH  = { userId: 'doc-2', name: 'Dr. DEF', email: 'def@h.com', departmentIds: ['dept-cardio', 'dept-neuro'] };
      const deptSelect = () => screen.getByLabelText(/department\s*\(optional\)/i) as HTMLSelectElement;

      beforeEach(() => {
        mockDepartments = [CARDIO, NEURO];
        mockDoctors = [DR_HEART, DR_BOTH];
      });

      async function openWithBothSelected(user: ReturnType<typeof userEvent.setup>) {
        const result = render(<IPDPage />);
        await user.click(screen.getByRole('button', { name: /new admission/i }));
        await user.click(doctorBox());
        await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' }));
        await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
        await user.keyboard('{Escape}');
        return result;
      }

      test('keeps doctors valid for the new department and removes only invalid ones', async () => {
        const user = userEvent.setup();
        await openWithBothSelected(user);

        await user.selectOptions(deptSelect(), 'dept-neuro');
        await waitFor(() => expect(within(doctorBox()).queryByTitle('Dr. ABC')).not.toBeInTheDocument());
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('keeps every selected doctor when all are valid for the new department', async () => {
        const user = userEvent.setup();
        await openWithBothSelected(user);

        await user.selectOptions(deptSelect(), 'dept-cardio');
        expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('switching back to All Departments does not remove any selected doctor', async () => {
        const user = userEvent.setup();
        await openWithBothSelected(user);

        await user.selectOptions(deptSelect(), 'dept-cardio');
        await user.selectOptions(deptSelect(), '');
        expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('keeps selections while the doctor list is loading, then prunes invalid ones once it arrives', async () => {
        const user = userEvent.setup();
        const { rerender } = await openWithBothSelected(user);

        mockDoctorsLoading = true;
        rerender(<IPDPage />);
        await user.selectOptions(deptSelect(), 'dept-neuro');
        // Not pruned against the empty, still-loading list.
        expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();

        mockDoctorsLoading = false;
        rerender(<IPDPage />);
        await waitFor(() => expect(within(doctorBox()).queryByTitle('Dr. ABC')).not.toBeInTheDocument());
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('submits only the doctors retained after the department change', async () => {
        mockCreateAdmission.mockReturnValue({ unwrap: () => Promise.resolve({ ...admitted, admissionId: 'adm-new-2' }) });
        mockCreateManualPayment.mockReturnValue({ unwrap: () => Promise.resolve({}) });
        const user = userEvent.setup();
        await openWithBothSelected(user);

        await user.selectOptions(deptSelect(), 'dept-neuro');
        await user.click(screen.getByRole('button', { name: /add patient/i }));
        await user.click(screen.getByRole('button', { name: /mock register patient/i }));
        await user.selectOptions(screen.getByLabelText('Ward'), 'ward-1');
        await user.click(screen.getByRole('button', { name: /G-01/ }));
        await user.type(screen.getByLabelText(/amount/i), '500');
        await user.click(screen.getByRole('button', { name: /^cash$/i }));
        await user.click(screen.getByRole('button', { name: /admit patient/i }));

        await waitFor(() => expect(mockCreateAdmission).toHaveBeenCalledTimes(1));
        expect(mockCreateAdmission.mock.calls[0][0]).toEqual(expect.objectContaining({
          assignedDoctorIds: ['doc-2'],
        }));
      });
    });
  });

  describe('Edit', () => {
    function openEdit(row: Record<string, unknown> = admitted) {
      mockRole   = 'HOSPITAL_ADMIN';
      mockUserId = 'admin-1';
      mockUseListAdmissionsQuery.mockReturnValue({
        data: { data: [row], total: 1, totalPages: 1 },
        isLoading: false, isFetching: false, refetch: jest.fn(),
      });
      const result = render(<IPDPage />);
      fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      return result;
    }

    test('after searching, ArrowDown/ArrowUp move the highlight and Enter toggles it; mouse still works', async () => {
      const user = userEvent.setup();
      openEdit();

      await user.click(doctorBox());
      const search = screen.getByLabelText(/search doctors/i);
      await user.type(search, 'dr');
      await user.keyboard('{ArrowDown}{ArrowDown}');
      const def = within(listbox()).getByRole('option', { name: 'Dr. DEF' });
      expect(search).toHaveAttribute('aria-activedescendant', def.id);

      await user.keyboard('{Enter}');
      expect(def).toHaveAttribute('aria-selected', 'true');
      expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      expect(doctorBox()).toHaveAttribute('aria-expanded', 'true');

      // Up → Dr. ABC (pre-selected); Enter deselects it.
      await user.keyboard('{ArrowUp}{Enter}');
      expect(within(doctorBox()).queryByTitle('Dr. ABC')).not.toBeInTheDocument();
      expect(mockUpdateAdmission).not.toHaveBeenCalled();

      // Mouse selection unaffected.
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' }));
      expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
    });

    describe('department picked while the doctor list is still loading', () => {
      const CARDIO = { departmentId: 'dept-cardio', name: 'Cardiology' };
      const NEURO  = { departmentId: 'dept-neuro',  name: 'Neurology' };
      const DR_HEART = { userId: 'doc-1', name: 'Dr. ABC', email: 'abc@h.com', departmentIds: ['dept-cardio'] };
      const DR_BOTH  = { userId: 'doc-2', name: 'Dr. DEF', email: 'def@h.com', departmentIds: ['dept-cardio', 'dept-neuro'] };
      const deptSelect = () => screen.getByLabelText(/department \(filter doctors\)/i) as HTMLSelectElement;

      beforeEach(() => {
        mockDepartments = [CARDIO, NEURO];
        mockDoctors = [DR_HEART, DR_BOTH];
      });

      test('keeps the existing assigned doctors while loading, then keeps those in the new department once loaded', async () => {
        mockDoctorsLoading = true;
        const user = userEvent.setup();
        const { rerender } = openEdit({ ...admitted, assignedDoctorIds: ['doc-2'], departmentId: 'dept-cardio' });

        await user.selectOptions(deptSelect(), 'dept-neuro');
        // Not pruned against the empty, still-loading list.
        expect(within(doctorBox()).getByTitle('doc-2')).toBeInTheDocument();

        mockDoctorsLoading = false;
        rerender(<IPDPage />);
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('prunes doctors outside the picked department only once the list arrives', async () => {
        mockDoctorsLoading = true;
        const user = userEvent.setup();
        const { rerender } = openEdit({ ...admitted, assignedDoctorIds: ['doc-1', 'doc-2'], departmentId: 'dept-cardio' });

        await user.selectOptions(deptSelect(), 'dept-neuro');
        expect(within(doctorBox()).getByTitle('doc-1')).toBeInTheDocument();
        expect(within(doctorBox()).getByTitle('doc-2')).toBeInTheDocument();

        mockDoctorsLoading = false;
        rerender(<IPDPage />);
        await waitFor(() => expect(within(doctorBox()).queryByTitle('Dr. ABC')).not.toBeInTheDocument());
        expect(within(doctorBox()).getByTitle('Dr. DEF')).toBeInTheDocument();
      });

      test('opening Edit with the doctor list still loading leaves the pre-selected doctors untouched', () => {
        mockDoctorsLoading = true;
        const { rerender } = openEdit({ ...admitted, assignedDoctorIds: ['doc-1'], departmentId: 'dept-neuro' });

        mockDoctorsLoading = false;
        rerender(<IPDPage />);
        // Saved department doesn't match Dr. ABC, but no user change → no pruning.
        expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
      });
    });

    test('pre-selects the currently assigned doctors as tags and selected options', async () => {
      const user = userEvent.setup();
      openEdit();

      expect(within(doctorBox()).getByTitle('Dr. ABC')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add doctor/i })).not.toBeInTheDocument();

      await user.click(doctorBox());
      expect(within(listbox()).getByRole('option', { name: 'Dr. ABC' })).toHaveAttribute('aria-selected', 'true');
      expect(within(listbox()).getByRole('option', { name: 'Dr. DEF' })).toHaveAttribute('aria-selected', 'false');
    });

    test('changing the doctors saves the full new assignedDoctorIds array', async () => {
      mockUpdateAdmission.mockReturnValue({ unwrap: () => Promise.resolve({ ...admitted, assignedDoctorIds: ['doc-2'] }) });
      const user = userEvent.setup();
      openEdit();

      await user.click(doctorBox());
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. ABC' })); // deselect
      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => expect(mockUpdateAdmission).toHaveBeenCalledTimes(1));
      expect(mockUpdateAdmission.mock.calls[0][0]).toEqual(expect.objectContaining({
        admissionId:       'adm-doc-1',
        assignedDoctorIds: ['doc-2'],
      }));
    });

    test('saving with the pre-selected doctors untouched does not resend assignedDoctorIds', async () => {
      mockUpdateAdmission.mockReturnValue({ unwrap: () => Promise.resolve(admitted) });
      const user = userEvent.setup();
      openEdit();

      // Add then remove a doctor — back to the original selection.
      await user.click(doctorBox());
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
      await user.click(within(listbox()).getByRole('option', { name: 'Dr. DEF' }));
      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      // Hospital Admin always sends vitals, so the update still fires — just without doctors.
      await waitFor(() => expect(mockUpdateAdmission).toHaveBeenCalledTimes(1));
      expect(mockUpdateAdmission.mock.calls[0][0]).not.toHaveProperty('assignedDoctorIds');
    });
  });
});
