import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = [];
const mockReactivateUser = jest.fn();
const mockDeactivateUser = jest.fn();

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: mockUsers, total: mockUsers.length }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateUserMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateUserRoleMutation: () => [jest.fn(), { isLoading: false }],
  useDeactivateUserMutation: () => [mockDeactivateUser, { isLoading: false }],
  useReactivateUserMutation: () => [mockReactivateUser, { isLoading: false }],
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: undefined }),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import AdminPage from '@/app/(dashboard)/admin/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUsers = [];
  mockReactivateUser.mockClear();
  mockDeactivateUser.mockClear();
});

describe('AdminPage — Add User role gating', () => {
  test('HOSPITAL_ADMIN sees the Add User button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<AdminPage />);
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
  });

  test('HR sees the Add User button', () => {
    mockRole = 'HR';
    render(<AdminPage />);
    expect(screen.getByRole('button', { name: /add user/i })).toBeInTheDocument();
  });

  test('ADMIN does not see the Add User button', () => {
    mockRole = 'ADMIN';
    render(<AdminPage />);
    expect(screen.queryByRole('button', { name: /add user/i })).not.toBeInTheDocument();
  });
});

describe('AdminPage — Reactivate action', () => {
  const inactiveUser = {
    userId: 'u-inactive', email: 'inactive@h.com', name: 'Inactive User',
    role: 'NURSE', departmentIds: [], isActive: false, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };
  const activeUser = {
    userId: 'u-active', email: 'active@h.com', name: 'Active User',
    role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };

  test('Inactive user shows Reactivate, not Deactivate', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);
    expect(screen.getAllByRole('button', { name: /^reactivate$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^deactivate$/i })).not.toBeInTheDocument();
  });

  test('Active user shows Deactivate, not Reactivate', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);
    expect(screen.getAllByRole('button', { name: /^deactivate$/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^reactivate$/i })).not.toBeInTheDocument();
  });

  test('Clicking Reactivate calls the reactivate mutation with the user id', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);
    const [reactivateButton] = screen.getAllByRole('button', { name: /^reactivate$/i });
    reactivateButton.click();
    expect(mockReactivateUser).toHaveBeenCalledWith('u-inactive');
  });

  test('ADMIN (no manage permission) sees status badge but no Reactivate button for inactive user', () => {
    mockRole = 'ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);
    expect(screen.queryByRole('button', { name: /^reactivate$/i })).not.toBeInTheDocument();
  });
});
