import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const PATIENT = { patientId: 'PAT-001', fullName: 'John Doe', mobileNumber: '9999999999' };

const mockCreatePathology = jest.fn();
const mockCreateRadiology = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery:      () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useListRadiologyRequestsQuery:      () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation:  () => [mockCreatePathology, { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [mockCreateRadiology, { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useGetPathologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
  useGetRadiologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
}));

jest.mock('@/store/api/payment.api', () => ({
  useLazyGetReceiptUrlQuery: () => [jest.fn(), { isFetching: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [PATIENT] }, isFetching: false }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'RECEPTIONIST', userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

const CREATED = {
  requestId: '11111111-1111-4111-8111-111111111111', patientId: 'PAT-001', tenantId: 't1',
  requestedBy: 'u1', testType: 'x', referredBy: 'SELF', referredByName: 'Self', status: 'PENDING',
  priority: 'NORMAL', notes: null, reportUrl: null, requestedAt: '2026-05-19T10:00:00.000Z',
  updatedAt: '2026-05-19T10:00:00.000Z', payment: null, chargeId: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreatePathology.mockReturnValue({ unwrap: () => Promise.resolve(CREATED) });
});

async function openNewPathologyRequest(user: ReturnType<typeof userEvent.setup>) {
  render(<LabPage />);
  await user.click(screen.getByRole('button', { name: /New Request/ }));
  await user.type(screen.getByPlaceholderText(/Search patient/), 'John');
  await user.click(await screen.findByRole('button', { name: /John Doe/ }));
}

async function referOther(user: ReturnType<typeof userEvent.setup>, name = 'Dr. Mehta') {
  await user.selectOptions(screen.getByLabelText('Referred By *'), 'Other');
  await user.type(screen.getByLabelText('Referrer Name *'), name);
}

describe('New Pathology Request — Test Type multi-select', () => {
  test('offers the 40 catalog tests (original 20 + 20 added, names exact) and is searchable', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);

    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toHaveLength(40);
    expect(names.slice(0, 2)).toEqual(['CBC (Complete Blood Count)', 'ESR']);
    expect(names[19]).toBe('Troponin I');
    expect(names.slice(20)).toEqual([
      'Peripheral Blood Smear (PBS)', 'Reticulocyte Count', 'Iron Profile / Iron Studies', 'Serum Ferritin',
      'Serum Calcium', 'Serum Magnesium', 'Serum Phosphorus', 'Serum Amylase', 'Serum Lipase',
      'Total & Direct Bilirubin', 'Alkaline Phosphatase (ALP)', 'Procalcitonin (PCT)',
      'HBsAg (Hepatitis B Surface Antigen)', 'Anti-HCV (Hepatitis C Antibody)', 'HIV 1 & 2 Screening',
      'Widal Test', 'Typhoid IgM', 'Pregnancy Test (Urine β-hCG)', 'Stool Routine & Microscopy',
      'Stool Occult Blood Test (FOBT)',
    ]);

    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'vitamin');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Vitamin D (25-OH)', 'Vitamin B12']);
  });

  test('sends all selected tests (no duplicates) as the testType string', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);

    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    await user.click(screen.getByRole('option', { name: 'CBC (Complete Blood Count)' }));
    await user.click(screen.getByRole('option', { name: 'Lipid Profile' }));
    // Re-clicking a selected option deselects it rather than duplicating it.
    await user.click(screen.getByRole('option', { name: 'ESR' }));
    await user.click(screen.getByRole('option', { name: 'ESR' }));

    const combobox = screen.getByRole('combobox', { name: /Test Type/ });
    expect(within(combobox).getByText('CBC (Complete Blood Count)')).toBeInTheDocument();
    expect(within(combobox).getByText('Lipid Profile')).toBeInTheDocument();
    expect(within(combobox).queryByText('ESR')).not.toBeInTheDocument();

    await referOther(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(mockCreatePathology).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 'PAT-001',
      testType:  'CBC (Complete Blood Count), Lipid Profile',
    }));
  });

  test('new tests are searchable and sent with their exact names (including β)', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);

    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'stool');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Stool Routine & Microscopy', 'Stool Occult Blood Test (FOBT)']);
    await user.click(screen.getByRole('option', { name: 'Stool Occult Blood Test (FOBT)' }));
    await user.clear(screen.getByRole('textbox', { name: 'Search tests' }));
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'pregnancy');
    await user.click(screen.getByRole('option', { name: 'Pregnancy Test (Urine β-hCG)' }));

    await referOther(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(mockCreatePathology).toHaveBeenCalledWith(expect.objectContaining({
      testType: 'Stool Occult Blood Test (FOBT), Pregnancy Test (Urine β-hCG)',
    }));
  });

  test('requires at least one test', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(screen.getByText('Please select at least one test.')).toBeInTheDocument();
    expect(mockCreatePathology).not.toHaveBeenCalled();
  });

  test('blocks a selection longer than the backend testType limit', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    // The first 12 catalog names already exceed the 200-character limit.
    for (const opt of within(screen.getByRole('listbox')).getAllByRole('option').slice(0, 12)) await user.click(opt);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(screen.getByText(/Too many tests selected/)).toBeInTheDocument();
    expect(mockCreatePathology).not.toHaveBeenCalled();
  });
});

describe('New Pathology Request — Referred By "Other"', () => {
  async function pickOneTest(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    await user.click(screen.getByRole('option', { name: 'ESR' }));
  }

  test('requires a referrer selection', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await pickOneTest(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(screen.getByText('Please select who referred this request.')).toBeInTheDocument();
    expect(mockCreatePathology).not.toHaveBeenCalled();
  });

  test('requires the referrer name when Other is selected', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await pickOneTest(user);
    await referOther(user, '   ');
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(screen.getByText('Please enter the referrer’s name.')).toBeInTheDocument();
    expect(mockCreatePathology).not.toHaveBeenCalled();
  });

  test('submits the trimmed typed name as the referredBy value', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await pickOneTest(user);
    await referOther(user, '  Dr. Mehta  ');
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(mockCreatePathology).toHaveBeenCalledWith(expect.objectContaining({ referredBy: 'OTHER:Dr. Mehta' }));
  });
});
