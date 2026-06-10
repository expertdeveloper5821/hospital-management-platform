import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const mockEditPathology   = jest.fn();
const mockDeletePathology = jest.fn();
const mockEditRadiology   = jest.fn();
const mockDeleteRadiology = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useListRadiologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [mockEditPathology,   { isLoading: false }],
  useDeletePathologyRequestMutation:  () => [mockDeletePathology, { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [mockEditRadiology,   { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [mockDeleteRadiology, { isLoading: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'PATHOLOGIST' } } }),
  useAppDispatch: () => jest.fn(),
}));

// Import after mocks
import LabPage from '@/app/(dashboard)/lab/page';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PENDING_PATHOLOGY = {
  requestId:   'req-001',
  patientId:   'PAT-001',
  fullName:    'Test Patient',
  tenantId:    'tenant-001',
  requestedBy: 'doctor-001',
  testType:    'Blood CBC',
  status:      'PENDING' as const,
  priority:    'NORMAL' as const,
  notes:       null,
  reportUrl:   null,
  requestedAt: '2026-01-01T00:00:00.000Z',
  updatedAt:   '2026-01-01T00:00:00.000Z',
};

const COMPLETED_PATHOLOGY = {
  ...PENDING_PATHOLOGY,
  requestId: 'req-002',
  status:    'COMPLETED' as const,
  reportUrl: 'https://s3.test/report.pdf',
};

// ─── EditRequestModal ─────────────────────────────────────────────────────────

// Since the modals are internal components of page.tsx, we test them indirectly
// by triggering them through the RequestDetailPanel via the LabPage component.
// This mirrors the pattern used in patient-detail.test.tsx.

describe('EditRequestModal — pathology', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mocks to default resolved state
    mockEditPathology.mockReturnValue({ unwrap: () => Promise.resolve({ ...PENDING_PATHOLOGY, testType: 'Updated' }) });
    mockDeletePathology.mockReturnValue({ unwrap: () => Promise.resolve({ message: 'deleted' }) });

    // Provide list data including our pending request
    jest.spyOn(require('@/store/api/lab.api'), 'useListPathologyRequestsQuery').mockReturnValue({
      data:       { data: [PENDING_PATHOLOGY], total: 1, page: 1, limit: 20, totalPages: 1 },
      isFetching: false,
      refetch:    jest.fn(),
    });
  });

  test('shows Edit button for PENDING requests when user has edit permission', () => {
    render(<LabPage />);
    // Edit button appears in the table row (pencil icon with title)
    const editBtns = screen.getAllByTitle('Edit');
    expect(editBtns.length).toBeGreaterThan(0);
  });

  test('opens Edit modal when Edit button is clicked in detail panel', async () => {
    render(<LabPage />);
    // Click the View button to open detail panel
    fireEvent.click(screen.getByText('View'));

    // Click Edit Request button in the panel
    const editBtn = await screen.findByText('Edit Request');
    fireEvent.click(editBtn);

    expect(screen.getByText(/edit pathology request/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Test Type')).toHaveValue('Blood CBC');
  });

  test('calls editPathologyRequest mutation on submit', async () => {
    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const editBtn = await screen.findByText('Edit Request');
    fireEvent.click(editBtn);

    const typeInput = screen.getByLabelText('Test Type');
    fireEvent.change(typeInput, { target: { value: 'Urine Analysis' } });

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mockEditPathology).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-001', testType: 'Urine Analysis' }),
      );
    });
  });

  test('shows 409 error inline when request is already COMPLETED', async () => {
    mockEditPathology.mockReturnValue({
      unwrap: () => Promise.reject({ status: 409, data: { message: 'Cannot edit' } }),
    });

    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const editBtn = await screen.findByText('Edit Request');
    fireEvent.click(editBtn);

    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(screen.getByText(/already completed and cannot be edited/i)).toBeInTheDocument();
    });
  });

  test('Cancel button does not call mutation', async () => {
    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const editBtn = await screen.findByText('Edit Request');
    fireEvent.click(editBtn);

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockEditPathology).not.toHaveBeenCalled();
  });
});

// ─── DeleteRequestModal ───────────────────────────────────────────────────────

describe('DeleteRequestModal — pathology', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeletePathology.mockReturnValue({ unwrap: () => Promise.resolve({ message: 'deleted' }) });

    jest.spyOn(require('@/store/api/lab.api'), 'useListPathologyRequestsQuery').mockReturnValue({
      data:       { data: [PENDING_PATHOLOGY], total: 1, page: 1, limit: 20, totalPages: 1 },
      isFetching: false,
      refetch:    jest.fn(),
    });
  });

  test('shows Delete button when user has delete permission', () => {
    render(<LabPage />);
    expect(screen.getAllByTitle('Delete').length).toBeGreaterThan(0);
  });

  test('opens Delete confirmation modal when Delete button is clicked', async () => {
    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const deleteBtn = await screen.findByText('Delete Request');
    fireEvent.click(deleteBtn);

    expect(screen.getByText(/archive the request/i)).toBeInTheDocument();
  });

  test('calls deletePathologyRequest mutation on confirm', async () => {
    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const deleteBtn = await screen.findByText('Delete Request');
    fireEvent.click(deleteBtn);

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(mockDeletePathology).toHaveBeenCalledWith('req-001');
    });
  });

  test('Cancel button does not call mutation', async () => {
    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const deleteBtn = await screen.findByText('Delete Request');
    fireEvent.click(deleteBtn);

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockDeletePathology).not.toHaveBeenCalled();
  });

  test('shows 403 inline error when deleting a COMPLETED request without permission', async () => {
    mockDeletePathology.mockReturnValue({
      unwrap: () => Promise.reject({ status: 403, data: { message: 'Forbidden' } }),
    });

    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const deleteBtn = await screen.findByText('Delete Request');
    fireEvent.click(deleteBtn);

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText(/only hospital admin or manager/i)).toBeInTheDocument();
    });
  });

  test('shows 404 inline error when request already deleted', async () => {
    mockDeletePathology.mockReturnValue({
      unwrap: () => Promise.reject({ status: 404, data: { message: 'Not found' } }),
    });

    render(<LabPage />);
    fireEvent.click(screen.getByText('View'));

    const deleteBtn = await screen.findByText('Delete Request');
    fireEvent.click(deleteBtn);

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(screen.getByText(/already been deleted/i)).toBeInTheDocument();
    });
  });
});
