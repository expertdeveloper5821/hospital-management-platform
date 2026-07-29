import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseListAdmissionsQuery = jest.fn();

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: [], isLoading: false }),
  useListBedsQuery: () => ({ data: [] }),
  useListAdmissionsQuery: (...args: unknown[]) => mockUseListAdmissionsQuery(...args),
  useCreateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useAddProgressNoteMutation: () => [jest.fn(), { isLoading: false }],
  useDischargePatientMutation: () => [jest.fn(), { isLoading: false }],
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

let mockRole = 'RECEPTIONIST';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import IPDPage from '@/app/(dashboard)/ipd/page';

const EMPTY_ADMISSIONS = { data: { data: [], total: 0, totalPages: 1 }, isLoading: false, isFetching: false, refetch: jest.fn() };

beforeEach(() => {
  mockUseListAdmissionsQuery.mockReturnValue(EMPTY_ADMISSIONS);
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
