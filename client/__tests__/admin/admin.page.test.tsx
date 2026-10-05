import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = [];
const mockReactivateUser = jest.fn();
const mockDeactivateUser = jest.fn();
const mockUpdateUserEmail = jest.fn();

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: mockUsers, total: mockUsers.length }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateUserMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateUserRoleMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateUserEmailMutation: () => [mockUpdateUserEmail, { isLoading: false }],
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// NOTE: JSDOM renders both the mobile card list and the desktop table (the
// md:hidden / hidden md:block classes are CSS-only), so every control exists
// twice in the DOM — hence getAllBy* + first element, matching older tests.
// Row actions now live inside a kebab DropdownMenu whose items portal to
// document.body and carry role="menuitem", so tests open the menu first and
// query role="menuitem" instead of role="button".

async function openFirstKebab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /actions for/i })[0]);
}

// queryAllBy* (not getAllBy*) so zero matches returns [] instead of throwing —
// several assertions check that an item is NOT in the menu.
function menuItems(name: RegExp) {
  return screen.queryAllByRole('menuitem', { name });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUsers = [];
  mockReactivateUser.mockClear();
  mockDeactivateUser.mockClear();
  mockUpdateUserEmail.mockClear();
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

describe('AdminPage — Kebab actions menu', () => {
  const activeUser = {
    userId: 'u-active', email: 'active@h.com', name: 'Active User',
    role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };
  const inactiveUser = { ...activeUser, userId: 'u-inactive', name: 'Inactive User', isActive: false };

  test('kebab trigger is a compact icon button with an accessible name', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);
    expect(screen.getAllByRole('button', { name: /actions for active user/i }).length).toBeGreaterThan(0);
  });

  test('menu shows Edit Email, Edit Role, and Deactivate for an active user', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);

    expect(menuItems(/edit email/i).length).toBeGreaterThan(0);
    expect(menuItems(/edit role/i).length).toBeGreaterThan(0);
    expect(menuItems(/^deactivate$/i).length).toBeGreaterThan(0);
    expect(menuItems(/reactivate/i).length).toBe(0);
  });

  test('menu closes after selecting an item', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);

    expect(screen.queryByRole('menuitem', { name: /edit role/i })).not.toBeInTheDocument();
  });

  test('Edit Email menu item opens the inline email editor', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);

    const inputs = screen.getAllByLabelText('Edit email') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0].value).toBe('active@h.com');
  });

  test('Reactivate appears (Deactivate does not) in the menu for an inactive user', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);

    expect(menuItems(/reactivate/i).length).toBeGreaterThan(0);
    expect(menuItems(/^deactivate$/i).length).toBe(0);
  });

  test('kebab is hidden entirely when the viewer has no available action (ADMIN + inactive user)', () => {
    mockRole = 'ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument();
  });

  test('Clicking Reactivate in the menu calls the reactivate mutation with the user id', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/reactivate/i)[0]);

    expect(mockReactivateUser).toHaveBeenCalledWith('u-inactive');
  });
});

describe('AdminPage — Inline email editing', () => {
  const activeUser = {
    userId: 'u-active', email: 'active@h.com', name: 'Active User',
    role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };

  test('editor shows Save and Cancel controls', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);

    expect(screen.getAllByRole('button', { name: /^save$/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^cancel$/i }).length).toBeGreaterThan(0);
  });

  test('Save calls updateUserEmail with the trimmed, lowercased email', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    mockUpdateUserEmail.mockResolvedValue({});
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);

    const input = screen.getAllByLabelText('Edit email')[0];
    await user.clear(input);
    await user.type(input, '  New@Hospital.COM  ');
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    expect(mockUpdateUserEmail).toHaveBeenCalledWith({ userId: 'u-active', email: 'new@hospital.com' });
  });

  test('Cancel closes the editor without calling the mutation', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);
    await user.click(screen.getAllByRole('button', { name: /^cancel$/i })[0]);

    expect(screen.queryByLabelText('Edit email')).not.toBeInTheDocument();
    expect(mockUpdateUserEmail).not.toHaveBeenCalled();
  });

  test('Invalid email is rejected locally without calling the API', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit email/i)[0]);

    const input = screen.getAllByLabelText('Edit email')[0];
    await user.clear(input);
    await user.type(input, 'not-an-email');
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    expect(screen.getAllByText('Enter a valid email address.').length).toBeGreaterThan(0);
    expect(mockUpdateUserEmail).not.toHaveBeenCalled();
  });

  test('ADMIN does not see the Edit Email action', async () => {
    mockRole = 'ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    expect(menuItems(/edit email/i).length).toBe(0);
  });
});
