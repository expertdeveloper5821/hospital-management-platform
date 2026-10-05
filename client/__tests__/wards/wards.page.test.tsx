import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockBeds = [
  { bedId: 'b1', wardId: 'w1', bedNumber: 'G-01', isOccupied: false, currentAdmissionId: null, tenantId: 't1', createdAt: '' },
  { bedId: 'b2', wardId: 'w1', bedNumber: 'G-02', isOccupied: true,  currentAdmissionId: 'a1', tenantId: 't1', createdAt: '' },
];
const mockDeleteWard = jest.fn();
const mockDeleteBed  = jest.fn();

const mockWard = {
  wardId:           'w1',
  name:             'General Ward',
  floor:            null,
  assignedNurseIds: [],
  tenantId:         't1',
  createdAt:        '2026-01-01T00:00:00.000Z',
};

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsPaginatedQuery: () => ({
    data: { data: [mockWard], total: 1, page: 1, limit: 20, totalPages: 1 },
    isLoading: false, isFetching: false, isError: false,
  }),
  useCreateWardMutation:      () => [jest.fn(), { isLoading: false }],
  useListBedsQuery:           () => ({ data: mockBeds, isLoading: false }),
  useAddBedsMutation:         () => [jest.fn(), { isLoading: false }],
  useAssignNursesToWardMutation: () => [jest.fn(), { isLoading: false }],
  useGetOccupancySummaryQuery: () => ({ data: [] }),
  useDeleteWardMutation:      () => [mockDeleteWard],
  useUpdateBedMutation:       () => [jest.fn(), { isLoading: false }],
  useDeleteBedMutation:       () => [mockDeleteBed],
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import WardsPage from '@/app/(dashboard)/wards/page';
import { waitFor } from '@testing-library/react';

function expandWard() {
  fireEvent.click(screen.getByText('General Ward'));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WardsPage — nurse assignment role gating', () => {
  test('ADMIN sees the nurse-assignment dropdown', () => {
    mockRole = 'ADMIN';
    render(<WardsPage />);
    expandWard();
    expect(screen.getByText('Select nurse…')).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN still sees the nurse-assignment dropdown (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<WardsPage />);
    expandWard();
    expect(screen.getByText('Select nurse…')).toBeInTheDocument();
  });

  test('DOCTOR still sees the nurse-assignment dropdown (unchanged)', () => {
    mockRole = 'DOCTOR';
    render(<WardsPage />);
    expandWard();
    expect(screen.getByText('Select nurse…')).toBeInTheDocument();
  });

  test('MANAGER does not see the nurse-assignment dropdown', () => {
    mockRole = 'MANAGER';
    render(<WardsPage />);
    expandWard();
    expect(screen.queryByText('Select nurse…')).not.toBeInTheDocument();
  });
});

describe('WardsPage — ward delete and bed edit/delete (Hospital Admin only)', () => {
  beforeEach(() => {
    mockDeleteWard.mockReset();
    mockDeleteBed.mockReset();
  });

  test.each(['ADMIN', 'MANAGER', 'DOCTOR', 'NURSE', 'RECEPTIONIST'])('%s sees no delete/edit controls', (role) => {
    mockRole = role;
    render(<WardsPage />);
    expandWard();
    expect(screen.queryByLabelText('Delete ward General Ward')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit bed G-01')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Delete bed G-01')).not.toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN sees ward delete and per-bed edit/delete; occupied beds are disabled', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<WardsPage />);
    expandWard();
    expect(screen.getByLabelText('Delete ward General Ward')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit bed G-01')).toBeEnabled();
    expect(screen.getByLabelText('Delete bed G-01')).toBeEnabled();
    expect(screen.getByLabelText('Edit bed G-02')).toBeDisabled();
    expect(screen.getByLabelText('Delete bed G-02')).toBeDisabled();
  });

  test('ward delete asks for confirmation and shows the server 409 message', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDeleteWard.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: 'Cannot delete ward: 1 patient(s) are currently admitted in it.' } }),
    });
    render(<WardsPage />);
    fireEvent.click(screen.getByLabelText('Delete ward General Ward'));
    expect(mockDeleteWard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockDeleteWard).toHaveBeenCalledWith('w1');
    await waitFor(() =>
      expect(screen.getByText('Cannot delete ward: 1 patient(s) are currently admitted in it.')).toBeInTheDocument(),
    );
  });

  test('bed delete calls the API with the ward and bed id after confirmation', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockDeleteBed.mockReturnValue({ unwrap: () => Promise.resolve(undefined) });
    render(<WardsPage />);
    expandWard();
    fireEvent.click(screen.getByLabelText('Delete bed G-01'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockDeleteBed).toHaveBeenCalledWith({ wardId: 'w1', bedId: 'b1' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
