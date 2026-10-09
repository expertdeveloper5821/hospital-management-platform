import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const MASTER = [
  {
    templateKey: 'CBC', testName: 'CBC (Complete Blood Count)',
    clinicalNote: 'CBC evaluates red cells, white cells and platelets.', comment: null,
    correlateClinically: 'Correlate clinically.', isEnabled: true,
    updatedBy: null, updatedByName: null, updatedAt: '2026-10-06T00:00:00.000Z',
  },
  {
    templateKey: 'HIV', testName: 'HIV 1 & 2 Screening',
    clinicalNote: 'HIV screening note.', comment: 'This is a screening test.',
    correlateClinically: 'Correlate clinically.', isEnabled: true,
    updatedBy: null, updatedByName: null, updatedAt: '2026-10-06T00:00:00.000Z',
  },
];

const GENERIC = {
  templateKey: 'GENERIC', testName: 'Other / Unlisted Tests', clinicalNote: null, comment: null,
  correlateClinically: 'Correlate clinically.', isEnabled: true,
  updatedBy: null, updatedByName: null, updatedAt: '2026-10-06T00:00:00.000Z',
};

const mockUpdate = jest.fn();
let mockMaster: Array<Record<string, unknown>> = MASTER;

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useListRadiologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useListDisabledPathologyTestsQuery: () => ({ data: [] }),
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useGetPathologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
  useGetRadiologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
  useListPathologyTestMasterQuery:    () => ({ data: mockMaster, isLoading: false, isError: false, refetch: jest.fn() }),
  useUpdatePathologyTestMasterMutation: () => [mockUpdate, { isLoading: false }],
}));

jest.mock('@/store/api/payment.api', () => ({
  useLazyGetReceiptUrlQuery: () => [jest.fn(), { isFetching: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

let mockRole = 'PATHOLOGIST';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

beforeEach(() => {
  mockUpdate.mockReset();
  mockRole = 'PATHOLOGIST';
  mockMaster = MASTER;
});

async function openTestMaster() {
  const user = userEvent.setup();
  render(<LabPage />);
  await user.click(screen.getByRole('button', { name: /test master/i }));
  return user;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Lab → Test Master tab', () => {
  test.each(['PATHOLOGIST', 'HOSPITAL_ADMIN'])('%s sees the Test Master tab', (role) => {
    mockRole = role;
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /test master/i })).toBeInTheDocument();
  });

  test.each(['DOCTOR', 'NURSE', 'MANAGER', 'RADIOLOGIST', 'RECEPTIONIST', 'ADMIN'])('%s does not see the Test Master tab', (role) => {
    mockRole = role;
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: /test master/i })).not.toBeInTheDocument();
  });

  test('lists each test with its clinical note, and marks configured comments only where set', async () => {
    await openTestMaster();
    const table = screen.getByRole('table', { name: 'Pathology Test Master' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('CBC evaluates red cells');
    expect(within(rows[0]).queryByText('Configured')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Configured')).toBeInTheDocument();
    // The request table is not shown on this tab.
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
  });

  test('search filters by test name', async () => {
    const user = await openTestMaster();
    await user.type(screen.getByLabelText('Search tests'), 'hiv');
    const rows = within(screen.getByRole('table', { name: 'Pathology Test Master' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('HIV 1 & 2 Screening');
  });

  test('Edit opens the saved values and saves the edited content (empty fields cleared to null)', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(MASTER[1]) });
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Edit HIV 1 & 2 Screening' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit HIV 1 & 2 Screening' });
    expect(within(dialog).getByLabelText('Clinical Note')).toHaveValue('HIV screening note.');
    expect(within(dialog).getByLabelText('Comment')).toHaveValue('This is a screening test.');
    expect(within(dialog).getByLabelText('Please Correlate Clinically')).toHaveValue('Correlate clinically.');

    await user.clear(within(dialog).getByLabelText('Clinical Note'));
    await user.type(within(dialog).getByLabelText('Clinical Note'), 'Updated note');
    await user.clear(within(dialog).getByLabelText('Comment'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(mockUpdate).toHaveBeenCalledWith({
      templateKey: 'HIV', clinicalNote: 'Updated note', comment: null, correlateClinically: 'Correlate clinically.',
    });
    expect(screen.queryByRole('dialog', { name: 'Edit HIV 1 & 2 Screening' })).not.toBeInTheDocument();
  });

  test('the Please Correlate Clinically text is required', async () => {
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Edit CBC (Complete Blood Count)' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit CBC (Complete Blood Count)' });
    await user.clear(within(dialog).getByLabelText('Please Correlate Clinically'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Please Correlate Clinically text is required.')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('every test shows an Enabled switch; Other / Unlisted Tests has none', async () => {
    mockMaster = [...MASTER, GENERIC];
    await openTestMaster();
    expect(screen.getByRole('switch', { name: 'Enable CBC (Complete Blood Count)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Enable HIV 1 & 2 Screening' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('switch', { name: 'Enable Other / Unlisted Tests' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });

  test('toggling an enabled test disables it', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve({ ...MASTER[0], isEnabled: false }) });
    const user = await openTestMaster();
    await user.click(screen.getByRole('switch', { name: 'Enable CBC (Complete Blood Count)' }));
    expect(mockUpdate).toHaveBeenCalledWith({ templateKey: 'CBC', isEnabled: false });
  });

  test('a disabled test is shown as Disabled and toggling re-enables it', async () => {
    mockMaster = [{ ...MASTER[0], isEnabled: false }, MASTER[1]];
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve(MASTER[0]) });
    const user = await openTestMaster();
    const toggle = screen.getByRole('switch', { name: 'Enable CBC (Complete Blood Count)' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(within(screen.getAllByRole('row')[1]).getByText('Disabled')).toBeInTheDocument();
    await user.click(toggle);
    expect(mockUpdate).toHaveBeenCalledWith({ templateKey: 'CBC', isEnabled: true });
  });

  test('shows the error when toggling fails', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.reject({ data: { message: 'Forbidden' } }) });
    const user = await openTestMaster();
    await user.click(screen.getByRole('switch', { name: 'Enable HIV 1 & 2 Screening' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden');
  });

  test('search narrows the list so a test can be found and toggled', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve({ ...MASTER[1], isEnabled: false }) });
    const user = await openTestMaster();
    await user.type(screen.getByLabelText('Search tests'), 'hiv');
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    await user.click(screen.getByRole('switch', { name: 'Enable HIV 1 & 2 Screening' }));
    expect(mockUpdate).toHaveBeenCalledWith({ templateKey: 'HIV', isEnabled: false });
  });
});
