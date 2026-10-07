import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockUsers: any[] = [];
const mockReactivateUser = jest.fn();
const mockDeactivateUser = jest.fn();
const mockUpdateUserEmail = jest.fn();
const mockUpdateUserRole = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: jest.fn() }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: mockUsers, total: mockUsers.length }, isLoading: false, isFetching: false, refetch: jest.fn() }),
  useCreateUserMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateUserRoleMutation: () => [mockUpdateUserRole, { isLoading: false }],
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
  mockRouterPush.mockClear();
  mockUpdateUserRole.mockReset();
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

// ─── Doctor role-change restriction modal ─────────────────────────────────────
// The backend rejects with HTTP 409 and a structured details payload; the page
// branches on details.code === 'DOCTOR_ACTIVE_PATIENTS' (never on message
// text) and opens DoctorActivePatientsDialog.
describe('AdminPage — doctor role-change blocked modal', () => {
  const doctorUser = {
    userId: 'u-doc', email: 'doc@h.com', name: 'Dr Asha Verma',
    role: 'DOCTOR', departmentIds: [], isActive: true, isFirstLogin: false,
    tenantId: 't1', createdAt: '2026-01-01',
  };

  // RTK Query throws the error object from .unwrap(); the page reads
  // err.status and err.data.{message,details}.
  const structured409 = {
    status: 409,
    data: {
      status: 'error',
      message: 'Cannot change role: Dr Asha Verma still has 3 active patient(s). Reassign them first, then retry.',
      details: {
        code: 'DOCTOR_ACTIVE_PATIENTS',
        activePatients: 3,
        breakdown: { opd: 2, ipd: 1 },
        userId: 'u-doc',
        currentRole: 'DOCTOR',
        requestedRole: 'NURSE',
      },
    },
  };

  async function openRoleEditorOnDoctor(user: ReturnType<typeof userEvent.setup>) {
    await openFirstKebab(user);
    await user.click(menuItems(/edit role/i)[0]);
  }

  // RTK Query mutations return a promise-like object with .unwrap(); the page
  // calls .unwrap() and awaits it inside its try/catch. Mock that contract —
  // a bare rejected promise would escape as an unhandled rejection instead of
  // exercising the page's catch branch.
  const reject409 = (payload: unknown) =>
    mockUpdateUserRole.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(payload) }));
  const resolveOk = () =>
    mockUpdateUserRole.mockImplementationOnce(() => ({ unwrap: () => Promise.resolve({}) }));

  // The role editor's <select> has no accessible label; an open editor is
  // identifiable by its Save/Cancel buttons (also rendered by the email
  // editor, which these tests never open alongside). JSDOM renders the mobile
  // and desktop editors together — both bind the same state, so driving the
  // first is enough.
  async function clickFirstSave(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
  }

  // Pick the target role in the inline editor, as an admin would, before saving.
  async function chooseNewRole(user: ReturnType<typeof userEvent.setup>, value = 'NURSE') {
    const selects = screen.getAllByDisplayValue('DOCTOR') as HTMLSelectElement[];
    await user.selectOptions(selects[0], value);
  }

  test('structured 409 opens the modal with name, count and breakdown; no inline error', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    reject409(structured409);
    render(<AdminPage />);

    const user = userEvent.setup();
    await openRoleEditorOnDoctor(user);
    await chooseNewRole(user);
    await clickFirstSave(user);

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog.textContent).toContain('Dr Asha Verma');
    expect(dialog.textContent).toContain('3');
    expect(dialog.textContent).toContain('2'); // opd breakdown
    expect(dialog.textContent).toContain('1'); // ipd breakdown
    expect(dialog.textContent).toContain('NURSE');

    // Modal replaces the inline error path for this case.
    expect(screen.queryByText(/failed to update role/i)).not.toBeInTheDocument();
  });

  test('Close dismisses the modal and keeps the inline role editor open', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    reject409(structured409);
    render(<AdminPage />);

    const user = userEvent.setup();
    await openRoleEditorOnDoctor(user);
    await chooseNewRole(user);
    await clickFirstSave(user);
    await screen.findByRole('dialog', { name: /role change blocked/i });

    await user.click(screen.getAllByRole('button', { name: /^close$/i })[0]);

    expect(screen.queryByRole('dialog', { name: /role change blocked/i })).not.toBeInTheDocument();
    // Editor state preserved for retry after reassignment.
    expect(screen.getAllByRole('button', { name: /^cancel$/i }).length).toBeGreaterThan(0);
  });

  test('View Patients navigates to /patients and closes modal + editor', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    reject409(structured409);
    render(<AdminPage />);

    const user = userEvent.setup();
    await openRoleEditorOnDoctor(user);
    await chooseNewRole(user);
    await clickFirstSave(user);
    await screen.findByRole('dialog', { name: /role change blocked/i });

    await user.click(screen.getAllByRole('button', { name: /view patients/i })[0]);

    expect(mockRouterPush).toHaveBeenCalledWith('/patients');
    expect(screen.queryByRole('dialog', { name: /role change blocked/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
  });

  test('unstructured 409 (e.g. last-admin) shows the inline error instead of the modal', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ ...doctorUser, role: 'HOSPITAL_ADMIN', userId: 'u-admin2' }];
    reject409({
      status: 409,
      data: { status: 'error', message: 'Cannot change role of the last active Hospital Admin. Assign another admin first.' },
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit role/i)[0]);
    await clickFirstSave(user);

    expect(screen.queryByRole('dialog', { name: /role change blocked/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/cannot change role of the last active hospital admin/i).length).toBeGreaterThan(0);
  });

  test('successful save still closes the editor (regression guard)', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [doctorUser];
    resolveOk();
    render(<AdminPage />);

    const user = userEvent.setup();
    await openRoleEditorOnDoctor(user);
    await chooseNewRole(user);
    await clickFirstSave(user);

    expect(mockUpdateUserRole).toHaveBeenCalledWith({ userId: 'u-doc', role: 'NURSE' });
    expect(screen.queryByRole('button', { name: /^cancel$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ─── Generic structured conflict dialog (non-doctor 409s) ─────────────────────
// EVERY structured 409 (details.code present) must open the generic
// RoleChangeConflictDialog showing the exact counts/breakdown/error code the
// backend returned — never a bare inline message. Unstructured 409s (no
// details) keep the inline error fallback.
describe('AdminPage — generic structured conflict dialog', () => {
  const reject409 = (payload: unknown) =>
    mockUpdateUserRole.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(payload) }));
  const rejectDeactivate409 = (payload: unknown) =>
    mockDeactivateUser.mockImplementationOnce(() => ({ unwrap: () => Promise.reject(payload) }));

  async function saveRoleOn(user: ReturnType<typeof userEvent.setup>, u: { userId: string; role: string }, newRole: string) {
    await openFirstKebab(user);
    await user.click(menuItems(/edit role/i)[0]);
    const selects = screen.getAllByDisplayValue(u.role) as HTMLSelectElement[];
    await user.selectOptions(selects[0], newRole);
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);
  }

  test('NURSE_ACTIVE_ENTRIES opens the dialog with code, entries and breakdown', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-nurse', email: 'n@h.com', name: 'Nina Rao', role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    reject409({
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
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await saveRoleOn(user, { userId: 'u-nurse', role: 'NURSE' }, 'RECEPTIONIST');

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('Nina Rao');
    expect(dialog.textContent).toContain('NURSE_ACTIVE_ENTRIES');
    expect(dialog.textContent).toContain('6'); // activeEntries
    expect(dialog.textContent).toContain('OPD 4 · IPD 2'); // breakdown
    expect(dialog.textContent).toContain('RECEPTIONIST');
    expect(screen.queryByText(/failed to update role/i)).not.toBeInTheDocument();
  });

  test('PATHOLOGY_ACTIVE_REQUEST shows the unpaid flag and request count', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-path', email: 'p@h.com', name: 'Pankaj Lab', role: 'PATHOLOGIST', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    reject409({
      status: 409,
      data: {
        status: 'error',
        message: 'Cannot change role: Pankaj Lab still has 2 active pathology request(s). Finalize or hand them over first, then retry.',
        details: { code: 'PATHOLOGY_ACTIVE_REQUEST', activeRequests: 2, unpaidPayment: true, userId: 'u-path', currentRole: 'PATHOLOGIST', requestedRole: 'NURSE' },
      },
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await saveRoleOn(user, { userId: 'u-path', role: 'PATHOLOGIST' }, 'NURSE');

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('PATHOLOGY_ACTIVE_REQUEST');
    expect(dialog.textContent).toContain('2');
    expect(dialog.textContent).toContain('Yes'); // unpaidPayment: true
  });

  test('STAFF_ACTIVE_SESSION shows the dangling attendance id', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-staff', email: 's@h.com', name: 'Sam Staff', role: 'STAFF', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    reject409({
      status: 409,
      data: {
        status: 'error',
        message: 'Cannot change role: Sam Staff has an open attendance session. Finalize it first, then retry.',
        details: { code: 'STAFF_ACTIVE_SESSION', attendanceId: 'att-9', userId: 'u-staff', currentRole: 'STAFF', requestedRole: 'RECEPTIONIST' },
      },
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await saveRoleOn(user, { userId: 'u-staff', role: 'STAFF' }, 'RECEPTIONIST');

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('STAFF_ACTIVE_SESSION');
    expect(dialog.textContent).toContain('att-9');
  });

  test('structured LAST_ADMIN_CONFLICT on role change opens the dialog (not the inline error)', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-admin2', email: 'a@h.com', name: 'Ada Admin', role: 'HOSPITAL_ADMIN', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    reject409({
      status: 409,
      data: {
        status: 'error',
        message: 'Cannot change role of the last active Hospital Admin. Assign another admin first.',
        details: { code: 'LAST_ADMIN_CONFLICT', userId: 'u-admin2', currentRole: 'HOSPITAL_ADMIN', requestedRole: 'MANAGER' },
      },
    });
    render(<AdminPage />);

    // The editor <select> only lists ASSIGNABLE_ROLES (HOSPITAL_ADMIN is not
    // assignable), so there is no option to switch to — just save the editor
    // as-is; the backend guard fires on the current role either way.
    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/edit role/i)[0]);
    await user.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('LAST_ADMIN_CONFLICT');
    expect(dialog.textContent).toContain('Ada Admin');
    // The inline error path was not taken (no generic fallback text; the
    // backend message legitimately appears inside the dialog itself).
    expect(screen.queryByText(/failed to update role/i)).not.toBeInTheDocument();
  });

  test('deactivation 409 (WARD_ROSTER_CONFLICT) opens the dialog and closes the deactivate modal', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-nurse2', email: 'n2@h.com', name: 'Rita Nurse', role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    rejectDeactivate409({
      status: 409,
      data: {
        status: 'error',
        message: 'Cannot deactivate: Rita Nurse is still on the roster of 2 active ward(s). Remove them from the ward roster first, then retry.',
        details: { code: 'WARD_ROSTER_CONFLICT', activeWards: 2, userId: 'u-nurse2' },
      },
    });
    render(<AdminPage />);

    const user = userEvent.setup();
    await openFirstKebab(user);
    await user.click(menuItems(/^deactivate$/i)[0]);
    // DeactivateModal's destructive confirm button (the only rendered instance).
    await user.click(screen.getAllByRole('button', { name: /^deactivate$/i })[0]);

    const dialog = await screen.findByRole('dialog', { name: /role change blocked/i });
    expect(dialog.textContent).toContain('WARD_ROSTER_CONFLICT');
    expect(dialog.textContent).toContain('Rita Nurse');
    expect(dialog.textContent).toContain('2');
    // The deactivate confirm modal is gone; the conflict dialog replaced it.
    expect(screen.queryByText(/are you sure you want to deactivate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/failed to deactivate/i)).not.toBeInTheDocument();
  });

  test('unstructured 409 (no details) still shows the inline error fallback', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockUsers = [{ userId: 'u-nurse3', email: 'n3@h.com', name: 'Rima Nurse', role: 'NURSE', departmentIds: [], isActive: true, isFirstLogin: false, tenantId: 't1', createdAt: '2026-01-01' }];
    reject409({ status: 409, data: { status: 'error', message: 'Some unexpected conflict.' } });
    render(<AdminPage />);

    const user = userEvent.setup();
    await saveRoleOn(user, { userId: 'u-nurse3', role: 'NURSE' }, 'RECEPTIONIST');

    expect(screen.queryByRole('dialog', { name: /role change blocked/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/some unexpected conflict/i).length).toBeGreaterThan(0);
  });
});
