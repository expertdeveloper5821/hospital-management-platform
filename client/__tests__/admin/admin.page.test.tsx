import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = [];
const mockReactivateUser = jest.fn();
const mockDeactivateUser = jest.fn();
const mockUpdateUser = jest.fn();
const mockCreateUser = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: jest.fn() }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: mockUsers, total: mockUsers.length }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateUserMutation: () => [mockCreateUser, { isLoading: false }],
  useUpdateUserMutation: () => [mockUpdateUser, { isLoading: false }],
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

// JSDOM renders both the mobile card list and the desktop table (the
// md:hidden / hidden md:block classes are CSS-only), so every control exists
// twice in the DOM — hence getAllBy* + first element.

/**
 * Row actions are a single direct 'Edit' button; clicking it opens the Edit
 * User dialog (portal-rendered by DialogOverlay, identified by its heading).
 */
async function openFirstEditDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: /^edit user /i })[0]);
  await screen.findByText('Edit User');
}

function queryEditDialog() {
  return screen.queryByText('Edit User');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockUsers = [];
  mockReactivateUser.mockClear();
  mockDeactivateUser.mockClear();
  mockCreateUser.mockClear();
  mockUpdateUser.mockReset();
  mockRouterPush.mockClear();
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

describe('AdminPage — Edit button replaces kebab menu', () => {
  const activeUser = {
    userId: 'u-active', email: 'active@h.com', name: 'Active User',
    role: 'NURSE', departmentIds: [], ukmcNo: null, isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };
  const inactiveUser = { ...activeUser, userId: 'u-inactive', name: 'Inactive User', isActive: false };

  test('Edit button is present for an active user (no kebab anywhere)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);
    expect(screen.getAllByRole('button', { name: /^edit user /i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /actions for/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  test('Edit button opens the Edit User dialog pre-filled from the row', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    const nameInput = screen.getAllByLabelText('Full Name')[0] as HTMLInputElement;
    const emailInput = screen.getAllByLabelText(/^Email/)[0] as HTMLInputElement;
    expect(nameInput.value).toBe('Active User');
    expect(emailInput.value).toBe('active@h.com');
    expect(screen.getAllByDisplayValue('NURSE').length).toBeGreaterThan(0);
  });

  test('Edit button hidden entirely for ADMIN viewing an inactive user (no available action)', () => {
    mockRole = 'ADMIN';
    mockUsers = [inactiveUser];
    render(<AdminPage />);
    expect(screen.queryByRole('button', { name: /^edit user /i })).not.toBeInTheDocument();
  });

  test('dialog exposes Deactivate for an active user and Reactivate for an inactive one', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser, inactiveUser];
    render(<AdminPage />);

    // Active user's dialog shows Deactivate.
    await openFirstEditDialog(userEvent.setup());
    expect(screen.getAllByRole('button', { name: /deactivate/i }).length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^cancel$/i })[0]);

    // Inactive user's dialog shows Reactivate.
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^edit user inactive user$/i })[0]);
    await screen.findByText('Edit User');
    expect(screen.getAllByRole('button', { name: /reactivate/i }).length).toBeGreaterThan(0);
  });

  test('Deactivate inside the dialog opens the confirm modal', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [activeUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);
    await user.click(screen.getAllByRole('button', { name: /^deactivate$/i })[0]);

    expect(screen.getAllByText(/are you sure you want to deactivate/i).length).toBeGreaterThan(0);
  });
});

describe('AdminPage — Edit User dialog: combined save', () => {
  const nurseUser = {
    userId: 'u-nurse', email: 'nina@h.com', name: 'Nina Rao',
    role: 'NURSE', departmentIds: [], ukmcNo: null, isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };

  test('Save with no changes closes the dialog without calling the API', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(queryEditDialog()).not.toBeInTheDocument();
  });

  test('Save sends name, email and role changes in one PATCH call', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    // The page calls updateUser({...}).unwrap() directly — the mock must
    // return the { unwrap } envelope synchronously, not a Promise of it.
    mockUpdateUser.mockImplementation(() => ({ unwrap: () => Promise.resolve({}) }));
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    // NOTE: the dialog is rendered once; the mockUsers list happens to trigger
    // both the mobile layout's select and the dialog's role select, so target
    // labeled inputs within the dialog context by using unique label ids.
    const nameInput = screen.getAllByLabelText('Full Name')[0];
    await user.clear(nameInput);
    await user.type(nameInput, 'Nina Rao-Verma');
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    await waitForDialogClose();
    expect(mockUpdateUser).toHaveBeenCalledWith({
      userId: 'u-nurse',
      body: { name: 'Nina Rao-Verma' },
    });
  });

  test('invalid email is rejected locally without calling the API', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    const emailInput = screen.getAllByLabelText(/^Email/)[0];
    await user.clear(emailInput);
    await user.type(emailInput, 'not-an-email');
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(screen.getAllByText('Enter a valid email address.').length).toBeGreaterThan(0);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('name shorter than 2 characters is rejected by the shared Zod schema', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    const nameInput = screen.getAllByLabelText('Full Name')[0];
    await user.clear(nameInput);
    // sanitizer strips digits/punctuation, so type a single letter.
    await user.type(nameInput, 'A');
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(screen.getAllByText('Name must be at least 2 characters.').length).toBeGreaterThan(0);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('backend error surfaces inside the dialog and keeps it open', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    mockUpdateUser.mockImplementationOnce(() => ({
      unwrap: () => Promise.reject({
        status: 409,
        data: { message: 'A user with this email already exists in this tenant' },
      }),
    }));
    // (same pattern as before — envelope returned synchronously)
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    const emailInput = screen.getAllByLabelText(/^Email/)[0];
    await user.clear(emailInput);
    await user.type(emailInput, 'taken@h.com');
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(screen.getAllByText(/already exists in this tenant/i).length).toBeGreaterThan(0);
    expect(queryEditDialog()).toBeInTheDocument();
  });

  test('structured 409 conflict opens the generic conflict dialog', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    mockUpdateUser.mockImplementationOnce(() => ({
      unwrap: () => Promise.reject({
        status: 409,
        data: {
          status: 'error',
          message: 'Cannot change role: Nina Rao still has 4 active OPD visit(s) and 2 active IPD admission(s). Take them off duty first, then retry.',
          details: {
            code: 'NURSE_ACTIVE_ENTRIES',
            activeEntries: 6,
            breakdown: { opd: 4, ipd: 2 },
            userId: 'u-nurse', currentRole: 'NURSE', requestedRole: 'RECEPTIONIST',
          },
        },
      }),
    }));
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    // Change the role before saving so the body carries a role change.
    const roleSelects = screen.getAllByDisplayValue('NURSE') as HTMLSelectElement[];
    await user.selectOptions(roleSelects[0], 'RECEPTIONIST');
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    const dialog = await screen.findByText('NURSE_ACTIVE_ENTRIES');
    expect(dialog).toBeInTheDocument();
    // Same contract as the old inline editors: the edit surface stays open at
    // the pre-save value so the admin can retry after reassignment.
    expect(queryEditDialog()).toBeInTheDocument();
    expect(mockUpdateUser).not.toHaveBeenCalledWith(expect.objectContaining({ body: {} }));
  });
});

describe('AdminPage — UKMC No. in the dialogs (doctor-only)', () => {
  const doctorUser = {
    userId: 'u-doc', email: 'doc@h.com', name: 'Dr Asha Verma',
    role: 'DOCTOR', departmentIds: [], ukmcNo: 'UK-REG-12345', isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };
  const nurseUser = {
    userId: 'u-nurse', email: 'nina@h.com', name: 'Nina Rao',
    role: 'NURSE', departmentIds: [], ukmcNo: null, isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };

  test('Create User modal shows UKMC No. only for DOCTOR and requires it', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    mockCreateUser.mockResolvedValue({ unwrap: () => Promise.resolve({}) });
    render(<AdminPage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /add user/i }));

    // Hidden for the default STAFF role.
    expect(screen.queryByLabelText(/UKMC No./i)).not.toBeInTheDocument();

    // Switch to NURSE — still hidden.
    await user.selectOptions(screen.getByLabelText('Role'), 'NURSE');
    expect(screen.queryByLabelText(/UKMC No./i)).not.toBeInTheDocument();

    // Switch to DOCTOR — visible, required.
    await user.selectOptions(screen.getByLabelText('Role'), 'DOCTOR');
    const ukmcInput = screen.getAllByLabelText(/UKMC No./i)[0] as HTMLInputElement;
    expect(ukmcInput.required).toBe(true);

    // Saving without a UKMC No. is blocked locally.
    await user.type(screen.getAllByLabelText('Full Name')[0], 'Dr New');
    await user.type(screen.getAllByLabelText(/^Email/)[0], 'new.doc@h.com');
    await user.click(screen.getAllByRole('button', { name: /^create user$/i })[0]);
    expect(screen.getAllByText('UKMC No. is required for doctors.').length).toBeGreaterThan(0);
    expect(mockCreateUser).not.toHaveBeenCalled();

    // Providing one submits it uppercase.
    const ukmcInputs = screen.getAllByLabelText(/UKMC No./i) as HTMLInputElement[];
    await user.type(ukmcInputs[0], 'uk-reg-55555');
    await user.click(screen.getAllByRole('button', { name: /^create user$/i })[0]);

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'DOCTOR', ukmcNo: 'UK-REG-55555' }),
    );
  });

  test('Edit dialog prefills doctor ukmcNo and sends changes; clearing by role change sends ukmcNo:null', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    mockUpdateUser.mockResolvedValue({ unwrap: () => Promise.resolve({}) });
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    // Prefilled for the doctor.
    const ukmcInput = screen.getAllByLabelText(/UKMC No./i)[0] as HTMLInputElement;
    expect(ukmcInput.value).toBe('UK-REG-12345');

    // Changing the role away from DOCTOR hides the field and clears ukmcNo.
    const roleSelects = screen.getAllByDisplayValue('DOCTOR') as HTMLSelectElement[];
    await user.selectOptions(roleSelects[0], 'NURSE');
    expect(screen.queryByLabelText(/UKMC No./i)).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(mockUpdateUser).toHaveBeenCalledWith({
      userId: 'u-doc',
      body: expect.objectContaining({ role: 'NURSE', ukmcNo: null }),
    });
  });

  test('saving a doctor edit without a UKMC No. is blocked locally', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstEditDialog(user);

    const ukmcInput = screen.getAllByLabelText(/UKMC No./i)[0];
    await user.clear(ukmcInput);
    await user.click(screen.getAllByRole('button', { name: /^save changes$/i })[0]);

    expect(screen.getAllByText('UKMC No. is required for doctors.').length).toBeGreaterThan(0);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  test('non-doctor users never see a UKMC No. field in the Edit dialog', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [nurseUser];
    render(<AdminPage />);

    await openFirstEditDialog(userEvent.setup());
    expect(screen.queryByLabelText(/UKMC No./i)).not.toBeInTheDocument();
  });
});

// Await the dialog unmount (Save with no changes / success path).
async function waitForDialogClose() {
  await waitFor(() => expect(queryEditDialog()).not.toBeInTheDocument());
}
