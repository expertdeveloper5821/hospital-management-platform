import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWard = {
  wardId:           'w1',
  name:             'General Ward',
  floor:            null,
  assignedNurseIds: [],
  tenantId:         't1',
  createdAt:        '2026-01-01T00:00:00.000Z',
};

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery:          () => ({ data: [mockWard], isLoading: false }),
  useCreateWardMutation:      () => [jest.fn(), { isLoading: false }],
  useListBedsQuery:           () => ({ data: [], isLoading: false }),
  useAddBedsMutation:         () => [jest.fn(), { isLoading: false }],
  useAssignNursesToWardMutation: () => [jest.fn(), { isLoading: false }],
  useGetOccupancySummaryQuery: () => ({ data: [] }),
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
