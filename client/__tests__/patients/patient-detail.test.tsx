import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockDeletePatient = jest.fn();
const mockGetPatient    = jest.fn();
const mockGetHistory    = jest.fn();

jest.mock('@/store/api/patient.api', () => ({
  useGetPatientByIdQuery:  (...args: unknown[]) => mockGetPatient(...args),
  useDeletePatientMutation: () => [mockDeletePatient, { isLoading: false }],
}));

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDPatientHistoryQuery: (...args: unknown[]) => mockGetHistory(...args),
}));

jest.mock('@/lib/toast', () => ({
  toastSuccess: jest.fn(),
  toastError:   jest.fn(),
}));

const BASE_PATIENT = {
  patientId:              'PAT-ABCD1234',
  fullName:               'Ravi Kumar',
  dateOfBirth:            '1990-05-15',
  gender:                 'MALE',
  mobileNumber:           '9876543210',
  address:                '12 MG Road',
  aadhaarNumber:          null,
  emergencyContactName:   null,
  emergencyContactMobile: null,
  bloodGroup:             null,
  tenantId:               't1',
  createdAt:              '2026-01-01T00:00:00.000Z',
  updatedAt:              '2026-01-01T00:00:00.000Z',
};

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'ADMIN' } } }),
  useAppDispatch: () => jest.fn(),
}));

// Import page after mocks
import PatientDetailPage from '@/app/(dashboard)/patients/[patientId]/page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupDefault() {
  mockGetPatient.mockReturnValue({ data: BASE_PATIENT, isLoading: false, isError: false });
  mockGetHistory.mockReturnValue({
    data:       { data: [], total: 0, page: 1, limit: 10, totalPages: 0 },
    isLoading:  false,
    isFetching: false,
  });
  mockDeletePatient.mockResolvedValue({ message: 'Patient record deleted.' });
}

// ─── Patient Info Tab ─────────────────────────────────────────────────────────

describe('PatientDetailPage — patient info', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefault();
  });

  test('renders patient name and ID', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('PAT-ABCD1234')).toBeInTheDocument();
  });

  test('shows loading skeleton when patient is loading', () => {
    mockGetPatient.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  test('shows error state when patient fetch fails', () => {
    mockGetPatient.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    expect(screen.getByText(/patient not found/i)).toBeInTheDocument();
  });

  test('Patient Info tab is active by default', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    expect(screen.getByText('Patient Info')).toBeInTheDocument();
    expect(screen.getByText('9876543210')).toBeInTheDocument();
  });
});

// ─── Delete Modal ─────────────────────────────────────────────────────────────

describe('PatientDetailPage — delete modal (Admin role)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefault();
  });

  test('Delete Patient button is visible for Admin role', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    expect(screen.getByRole('button', { name: /delete patient/i })).toBeInTheDocument();
  });

  test('clicking Delete Patient opens confirmation modal', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByRole('button', { name: /delete patient/i }));
    expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
  });

  test('modal shows archive warning text', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByRole('button', { name: /delete patient/i }));
    expect(screen.getByText(/all clinical history will be archived/i)).toBeInTheDocument();
  });

  test('Cancel button closes the modal', () => {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByRole('button', { name: /delete patient/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/this action cannot be undone/i)).not.toBeInTheDocument();
  });

  test('confirming delete calls deletePatient mutation and navigates to /patients', async () => {
    mockDeletePatient.mockReturnValue({ unwrap: () => Promise.resolve({ message: 'Patient record deleted.' }) });
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByRole('button', { name: /delete patient/i }));

    const confirmBtn = screen.getAllByRole('button', { name: /delete patient/i })
      .find((b) => b.closest('.fixed'));
    fireEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(mockDeletePatient).toHaveBeenCalledWith('PAT-ABCD1234');
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/patients');
    });
  });

  test('409 error message is shown in modal without navigating away', async () => {
    // Use an async throw so the rejection is always handled before it can be
    // reported as unhandled by the test runner.
    mockDeletePatient.mockReturnValue({
      unwrap: jest.fn().mockRejectedValue({
        data: { message: 'Patient has an active IPD admission. Discharge the patient before deletion.' },
      }),
    });
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByRole('button', { name: /delete patient/i }));

    const confirmBtn = screen.getAllByRole('button', { name: /delete patient/i })
      .find((b) => b.closest('.fixed'));

    await act(async () => {
      fireEvent.click(confirmBtn!);
    });

    await waitFor(() => {
      expect(screen.getByText(/active IPD admission/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─── OPD History Tab ──────────────────────────────────────────────────────────

describe('PatientDetailPage — OPD History tab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDefault();
  });

  function switchToOPDTab() {
    render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByText('OPD History'));
  }

  test('switching to OPD History tab shows filter controls', () => {
    switchToOPDTab();
    expect(screen.getByPlaceholderText(/search complaint or diagnosis/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('shows empty state when no visits match filters', () => {
    switchToOPDTab();
    expect(screen.getByText(/no visits found for the selected filters/i)).toBeInTheDocument();
  });

  test('shows visit cards when history data is present', () => {
    mockGetHistory.mockReturnValue({
      data: {
        data: [{
          visitId:        'OPD-ABCD1234',
          tenantId:       't1',
          patientId:      'PAT-ABCD1234',
          status:         'OPEN',
          chiefComplaint: 'Fever and headache',
          diagnosis:      null,
          prescription:   null,
          notes:          null,
          doctorId:       null,
          visitDate:      '2026-05-15T00:00:00.000Z',
          queueNumber:    1,
          createdAt:      '2026-05-15T00:00:00.000Z',
          updatedAt:      '2026-05-15T00:00:00.000Z',
        }],
        total: 1, page: 1, limit: 10, totalPages: 1,
      },
      isLoading: false, isFetching: false,
    });
    switchToOPDTab();
    expect(screen.getByText('Fever and headache')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
  });

  test('loading skeleton is shown while fetching', () => {
    mockGetHistory.mockReturnValue({ data: undefined, isLoading: true, isFetching: true });
    const { container } = render(<PatientDetailPage params={{ patientId: 'PAT-ABCD1234' }} />);
    fireEvent.click(screen.getByText('OPD History'));
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  test('search input updates its value and query receives undefined before debounce fires', () => {
    switchToOPDTab();
    const input = screen.getByPlaceholderText(/search complaint or diagnosis/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'fever' } });
    // Input reflects the typed value immediately
    expect(input.value).toBe('fever');
    // debouncedSearch has not fired yet (300ms), so query still receives undefined
    expect(mockGetHistory).toHaveBeenCalledWith(
      expect.objectContaining({ search: undefined }),
    );
  });

  test('status dropdown passes status filter to OPD history query', () => {
    switchToOPDTab();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'COMPLETED' } });
    expect(mockGetHistory).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' }),
    );
  });
});
