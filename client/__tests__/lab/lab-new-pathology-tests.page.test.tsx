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
// Tests disabled in the Test Master (GET /api/lab/pathology/disabled-tests).
let mockDisabledTests: string[] = [];

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery:      () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useListRadiologyRequestsQuery:      () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation:  () => [mockCreatePathology, { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [mockCreateRadiology, { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useListDisabledPathologyTestsQuery: () => ({ data: mockDisabledTests }),
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
  mockDisabledTests = [];
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
  test('offers the 111 catalog tests (names exact, in catalog order) and is searchable', async () => {
    const user = userEvent.setup();
    await openNewPathologyRequest(user);

    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toHaveLength(111);
    expect(names.slice(0, 2)).toEqual(['CBC (Complete Blood Count)', 'ESR']);
    expect(names[19]).toBe('Troponin I');
    expect(names.slice(20, 40)).toEqual([
      'Peripheral Blood Smear (PBS)', 'Reticulocyte Count', 'Iron Profile / Iron Studies', 'Serum Ferritin',
      'Serum Calcium', 'Serum Magnesium', 'Serum Phosphorus', 'Serum Amylase', 'Serum Lipase',
      'Total & Direct Bilirubin', 'Alkaline Phosphatase (ALP)', 'Procalcitonin (PCT)',
      'HBsAg (Hepatitis B Surface Antigen)', 'Anti-HCV (Hepatitis C Antibody)', 'HIV 1 & 2 Screening',
      'Widal Test', 'Typhoid IgM', 'Pregnancy Test (Urine β-hCG)', 'Stool Routine & Microscopy',
      'Stool Occult Blood Test (FOBT)',
    ]);
    expect(names.slice(40, 47)).toEqual([
      'DP Profile', 'C-Peptide', 'Fasting Insulin', 'Sputum AFB', 'Urea', 'Creatinine', 'Vitamin Profile',
    ]);
    expect(names.slice(47, 70)).toEqual([
      'Haemoglobin (Hb)', 'TLC (Total Leucocyte Count)', 'DLC (Differential Leucocyte Count)',
      'PCV / HCT (Packed Cell Volume / Haematocrit)', 'Platelet Count (PLT)', 'AEC (Absolute Eosinophil Count)',
      'BT (Bleeding Time)', 'CT (Clotting Time)', 'MP (Malaria Parasite - Peripheral Smear)',
      'MP Card (Malaria Rapid Antigen Test)', 'Blood Sugar - Fasting', 'Blood Sugar - Post-Prandial (PP)',
      'Blood Sugar - Random', 'SGOT (AST)', 'SGPT (ALT)', 'Serum Albumin', 'Total Protein',
      'Serum Sodium (Na+)', 'Serum Potassium (K+)', 'Serum Triglycerides', 'Serum Cholesterol (Total)',
      'D-Dimer', 'LDH (Lactate Dehydrogenase)',
    ]);
    expect(names.slice(70)).toEqual([
      'VDRL (Syphilis Screening)', 'RA Factor (Rheumatoid Factor)', 'ASO Titer (Anti-Streptolysin O)',
      'H. Pylori (Helicobacter pylori)', 'Urine Bile Salts (BS)', 'Urine Bile Pigments (BP)', 'Semen Analysis',
      'T3 (Total Triiodothyronine)', 'T4 (Total Thyroxine)', 'TSH (Thyroid Stimulating Hormone)',
      'FT3 (Free Triiodothyronine)', 'FT4 (Free Thyroxine)', 'Prolactin (PRL)', 'LH (Luteinising Hormone)',
      'FSH (Follicle Stimulating Hormone)', 'Testosterone (Total)', 'Serum Iron', 'Total IgE',
      'PSA Total (Prostate Specific Antigen)', 'PSA Free (Free / Total PSA Ratio)',
      'ACE (Angiotensin Converting Enzyme)', 'ANA (Antinuclear Antibody)', 'CA-125',
      'Anti-CCP (Anti-Cyclic Citrullinated Peptide)', 'E2 (Estradiol)', 'HBsAg Quantitative (Surface Antigen)',
      'Beta HCG (Serum Quantitative)', 'TORCH Profile', 'TB Platinum (IGRA)',
      'Microalbumin (Urine Albumin / Creatinine Ratio)', 'Allergy Profile', 'ANC Profile (Antenatal)',
      'Dual Marker (First Trimester Screen)', 'Triple Marker (Second Trimester Screen)', 'Thalassemia Profile',
      'Serum Lithium', 'Coombs Test - Direct (DAT)', 'Coombs Test - Indirect (IAT)', 'Folic Acid (Vitamin B9)',
      'Allergy Vaccine', 'Widal ELISA',
    ]);

    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'vitamin');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Vitamin D (25-OH)', 'Vitamin B12', 'Vitamin Profile', 'Folic Acid (Vitamin B9)']);
    await user.clear(screen.getByRole('textbox', { name: 'Search tests' }));
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'widal');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Widal Test', 'Widal ELISA']);
  });

  // Heavy multi-select + combobox typing in jsdom regularly exceeds the 5s
  // default on slower machines — generous per-test timeout, assertions unchanged.
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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);
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

describe('New Pathology Request — tests disabled in the Test Master', () => {
  test('a disabled test is hidden from the Test Type list and search; the rest stay in order', async () => {
    mockDisabledTests = ['ESR', 'HIV 1 & 2 Screening'];
    const user = userEvent.setup();
    await openNewPathologyRequest(user);

    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    const names = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(names).toHaveLength(109);
    expect(names).not.toContain('ESR');
    expect(names).not.toContain('HIV 1 & 2 Screening');
    expect(names.slice(0, 2)).toEqual(['CBC (Complete Blood Count)', 'Blood Sugar (Fasting / Post-Prandial / Random)']);

    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'hiv');
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
  });

  test('Widal ELISA is listed beside Widal Test and hidden when disabled', async () => {
    mockDisabledTests = ['Widal ELISA'];
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'widal');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Widal Test']);
    await user.clear(screen.getByRole('textbox', { name: 'Search tests' }));
    await user.type(screen.getByRole('textbox', { name: 'Search tests' }), 'allergy');
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Allergy Profile', 'Allergy Vaccine']);
  });

  test('a re-enabled test is offered again and can be submitted', async () => {
    mockDisabledTests = [];
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(111);
    await user.click(screen.getByRole('option', { name: 'ESR' }));
    await referOther(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(mockCreatePathology).toHaveBeenCalledWith(expect.objectContaining({ testType: 'ESR' }));
  });

  test('shows the backend error when a test was disabled after the form opened', async () => {
    mockCreatePathology.mockReturnValue({
      unwrap: () => Promise.reject({ status: 400, data: { message: 'ESR is disabled for this hospital and cannot be selected.' } }),
    });
    const user = userEvent.setup();
    await openNewPathologyRequest(user);
    await user.click(screen.getByRole('combobox', { name: /Test Type/ }));
    await user.click(screen.getByRole('option', { name: 'ESR' }));
    await referOther(user);
    await user.click(screen.getByRole('button', { name: 'Submit Request' }));
    expect(await screen.findByText('ESR is disabled for this hospital and cannot be selected.')).toBeInTheDocument();
  });
});
