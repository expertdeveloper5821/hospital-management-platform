import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseListAdmissionsQuery = jest.fn();
const mockDischarge = jest.fn();
let mockWards: unknown[] = [];

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: mockWards, isLoading: false }),
  useListBedsQuery: () => ({ data: [] }),
  useListAdmissionsQuery: (...args: unknown[]) => mockUseListAdmissionsQuery(...args),
  useCreateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useAddProgressNoteMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionPrescriptionMutation: () => [jest.fn(), { isLoading: false }],
  useDischargePatientMutation: () => [mockDischarge, { isLoading: false }],
  useDownloadDischargeSummaryMutation: () => [jest.fn(), { isLoading: false }],
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
  mockUserId = undefined;
  mockDischarge.mockReset();
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
    vitals:            { weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null },
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
