import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [], total: 0 }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateUserMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateUserRoleMutation: () => [jest.fn(), { isLoading: false }],
  useDeactivateUserMutation: () => [jest.fn(), { isLoading: false }],
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
