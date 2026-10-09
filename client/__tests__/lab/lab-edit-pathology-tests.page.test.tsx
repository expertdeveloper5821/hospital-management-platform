import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Edit Pathology Request — Test Type uses the same searchable multi-select and
// 40-test catalog as New Request; the request's tests load as chips.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const CBC     = 'CBC (Complete Blood Count)';
const THYROID = 'Thyroid Profile (T3, T4, TSH)';
const LIPID   = 'Lipid Profile';
const PREG    = 'Pregnancy Test (Urine β-hCG)';

const BASE = {
  patientId: 'PAT-001', fullName: 'John Doe', tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk',
  referredBy: 'SELF', referredByName: 'Self', status: 'PENDING', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z',
  chargeId: null, payment: null,
};
const PATH_ID  = '11111111-1111-4111-8111-111111111111';
const RADIO_ID = '22222222-2222-4222-8222-222222222222';

// Tests disabled in the Test Master (GET /api/lab/pathology/disabled-tests).
let mockDisabledTests: string[] = [];
let mockPathologyRows: unknown[] = [];
const mockEditPathology = jest.fn();
const mockEditRadiology = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: mockPathologyRows, total: mockPathologyRows.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery: () => ({
    data: { data: [{ ...BASE, requestId: RADIO_ID, imagingType: 'X-Ray Chest' }], total: 1, totalPages: 1 },
    isFetching: false, refetch: jest.fn(),
  }),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [mockEditPathology, { isLoading: false }],
  useListDisabledPathologyTestsQuery: () => ({ data: mockDisabledTests }),
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [mockEditRadiology, { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useGetPathologyRequestQuery:        () => ({ currentData: undefined, isFetching: false }),
  useGetRadiologyRequestQuery:        () => ({ currentData: undefined, isFetching: false }),
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
jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'HOSPITAL_ADMIN', userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

async function openEdit(user: ReturnType<typeof userEvent.setup>, testType: string) {
  mockPathologyRows = [{ ...BASE, requestId: PATH_ID, testType }];
  render(<LabPage />);
  await user.click(screen.getByRole('button', { name: 'View' }));
  await user.click(screen.getByRole('button', { name: /Edit Request/ }));
}

const combobox = () => screen.getByRole('combobox', { name: /Test Type/ });
const chips    = () => within(combobox()).getAllByRole('button', { name: /^Remove / })
  .map((b) => b.getAttribute('aria-label')!.replace(/^Remove /, ''));

beforeEach(() => {
  jest.clearAllMocks();
  mockDisabledTests = [];
  mockEditPathology.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockEditRadiology.mockReturnValue({ unwrap: () => Promise.resolve({}) });
});

describe('Edit Pathology Request — Test Type multi-select', () => {
  test('the request\'s tests load as selected chips, in order, with exact names', async () => {
    const user = userEvent.setup();
    await openEdit(user, `${CBC}, ${THYROID}, ${PREG}`);
    expect(chips()).toEqual([CBC, THYROID, PREG]);
    // No free-text Test Type input any more.
    expect(screen.queryByRole('textbox', { name: 'Test Type' })).not.toBeInTheDocument();
  });

  test('offers the same 111-test catalog, searchable, with current tests marked selected', async () => {
    const user = userEvent.setup();
    await openEdit(user, CBC);
    await user.click(combobox());
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options).toHaveLength(111);
    expect(screen.getByRole('option', { name: CBC })).toHaveAttribute('aria-selected', 'true');
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'serum');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Serum Electrolytes (Sodium, Potassium, Chloride)', 'Serum Ferritin', 'Serum Calcium',
      'Serum Magnesium', 'Serum Phosphorus', 'Serum Amylase', 'Serum Lipase',
      'Serum Albumin', 'Serum Sodium (Na+)', 'Serum Potassium (K+)', 'Serum Triglycerides', 'Serum Cholesterol (Total)',
      'Serum Iron', 'Beta HCG (Serum Quantitative)', 'Serum Lithium',
    ]);
  });

  test('adding and removing tests saves the new selection as the testType string', async () => {
    const user = userEvent.setup();
    await openEdit(user, `${CBC}, ${THYROID}`);
    await user.click(within(combobox()).getByRole('button', { name: `Remove ${CBC}` }));
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: LIPID }));
    await user.click(screen.getByRole('option', { name: PREG }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(mockEditPathology).toHaveBeenCalledWith(expect.objectContaining({
      requestId: PATH_ID,
      testType:  `${THYROID}, ${LIPID}, ${PREG}`,
      priority:  'NORMAL',
    }));
  });

  test('saving without changes sends the same testType', async () => {
    const user = userEvent.setup();
    await openEdit(user, `${CBC}, ${THYROID}`);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockEditPathology).toHaveBeenCalledWith(expect.objectContaining({ testType: `${CBC}, ${THYROID}` }));
  });

  test('a test outside the catalog (legacy / Billing) is kept as a chip unless removed', async () => {
    const user = userEvent.setup();
    await openEdit(user, `Blood CBC, ${CBC}`);
    expect(chips()).toEqual(['Blood CBC', CBC]);
    await user.click(combobox());
    await user.click(screen.getByRole('option', { name: LIPID }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockEditPathology).toHaveBeenCalledWith(expect.objectContaining({ testType: `Blood CBC, ${CBC}, ${LIPID}` }));
  });

  test('requires at least one test', async () => {
    const user = userEvent.setup();
    await openEdit(user, CBC);
    await user.click(within(combobox()).getByRole('button', { name: `Remove ${CBC}` }));
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.getByText('Please select at least one test.')).toBeInTheDocument();
    expect(mockEditPathology).not.toHaveBeenCalled();
  });

  test('blocks a selection longer than the backend testType limit', async () => {
    const user = userEvent.setup();
    await openEdit(user, CBC);
    await user.click(combobox());
    // The next 11 catalog tests push the joined string past 200 characters.
    for (const opt of within(screen.getByRole('listbox')).getAllByRole('option').slice(1, 12)) await user.click(opt);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(screen.getByText(/Too many tests selected/)).toBeInTheDocument();
    expect(mockEditPathology).not.toHaveBeenCalled();
  });
});

describe('Edit Pathology Request — tests disabled in the Test Master', () => {
  test('a disabled test is not offered for adding', async () => {
    mockDisabledTests = [LIPID];
    const user = userEvent.setup();
    await openEdit(user, CBC);
    await user.click(combobox());
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toHaveLength(110);
    expect(names).not.toContain(LIPID);
  });

  test('a disabled test already on the request stays as a chip and is saved unchanged', async () => {
    mockDisabledTests = [CBC];
    const user = userEvent.setup();
    await openEdit(user, `${CBC}, ${THYROID}`);
    expect(chips()).toEqual([CBC, THYROID]);
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockEditPathology).toHaveBeenCalledWith(expect.objectContaining({ testType: `${CBC}, ${THYROID}` }));
  });
});

describe('Edit Radiology Request is unchanged', () => {
  test('keeps the free-text Imaging Type input', async () => {
    const user = userEvent.setup();
    mockPathologyRows = [];
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /Radiology/ }));
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('button', { name: /Edit Request/ }));
    expect(screen.queryByRole('combobox', { name: /Imaging Type/ })).not.toBeInTheDocument();
    const input = screen.getByLabelText('Imaging Type');
    await user.clear(input);
    await user.type(input, 'CT Head');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(mockEditRadiology).toHaveBeenCalledWith(expect.objectContaining({ requestId: RADIO_ID, imagingType: 'CT Head' }));
  });
});
