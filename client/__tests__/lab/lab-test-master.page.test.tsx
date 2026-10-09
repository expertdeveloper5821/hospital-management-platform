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

  test('every test shows an Enabled switch; Other / Unlisted Tests is not listed at all', async () => {
    mockMaster = [...MASTER, GENERIC];
    const user = await openTestMaster();
    expect(screen.getByRole('switch', { name: 'Enable CBC (Complete Blood Count)' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Enable HIV 1 & 2 Screening' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByRole('switch')).toHaveLength(2);
    expect(screen.queryByText('Other / Unlisted Tests')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Other / Unlisted Tests' })).not.toBeInTheDocument();
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search tests'), 'other');
    expect(screen.getByText('No tests match your search.')).toBeInTheDocument();
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

// 23 tests: "Test 1" … "Test 23", catalog order, plus GENERIC (never listed).
const MANY = [
  ...Array.from({ length: 23 }, (_, i) => ({
    ...MASTER[0], templateKey: `T${i + 1}`, testName: `Test ${i + 1}`, isEnabled: i !== 11,
  })),
  GENERIC,
];

function bodyRows() {
  return within(screen.getByRole('table', { name: 'Pathology Test Master' })).getAllByRole('row').slice(1);
}
const serials = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('Lab → Test Master pagination', () => {
  beforeEach(() => { mockMaster = MANY; });

  test('shows an S.No. column and 10 rows per page by default', async () => {
    await openTestMaster();
    expect(screen.getByRole('columnheader', { name: 'S.No.' })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);
    expect(serials()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('1–10 of 23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });

  test('serial numbers continue across pages', async () => {
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(serials()[0]).toBe('11');
    expect(bodyRows()[0]).toHaveTextContent('Test 11');
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(serials()).toEqual(['21', '22', '23']);
    expect(screen.getByText('21–23 of 23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(serials()[0]).toBe('11');
  });

  test('page size is configurable and resets to the first page', async () => {
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.selectOptions(screen.getByLabelText('Rows per page'), '25');
    expect(bodyRows()).toHaveLength(23);
    expect(serials()[22]).toBe('23');
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  test('search covers every page, resets to page 1 and numbers the matches from 1', async () => {
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.type(screen.getByLabelText('Search tests'), 'test 2');
    // "Test 2" and "Test 20"–"Test 23".
    expect(bodyRows().map((r) => within(r).getAllByRole('cell')[1].textContent))
      .toEqual(['Test 2', 'Test 20', 'Test 21', 'Test 22', 'Test 23']);
    expect(serials()).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  test('a test on a later page can be enabled / disabled', async () => {
    mockUpdate.mockReturnValue({ unwrap: () => Promise.resolve({ ...MANY[11], isEnabled: true }) });
    const user = await openTestMaster();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    const toggle = screen.getByRole('switch', { name: 'Enable Test 12' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(mockUpdate).toHaveBeenCalledWith({ templateKey: 'T12', isEnabled: true });
    // Stays on the same page.
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });
});
