import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Lab request View panel: every test on the request, and the request's own
// linked OPD visit / IPD admission (fetched from the single-request GET —
// list rows don't carry it).

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const BASE = {
  patientId: 'PAT-001', fullName: 'John Doe', tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk',
  referredBy: 'SELF', referredByName: 'Self', status: 'PENDING', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z',
  chargeId: null, payment: null,
};

// Same patient: one request raised during an OPD visit (three tests, two of
// whose names contain commas), one raised during an IPD admission.
const OPD_REQUEST = {
  ...BASE, requestId: '77777777-7777-4777-8777-777777777777',
  testType: 'CBC (Complete Blood Count), Thyroid Profile (T3, T4, TSH), Serum Electrolytes (Sodium, Potassium, Chloride)',
};
const IPD_REQUEST = {
  ...BASE, requestId: '88888888-8888-4888-8888-888888888888', testType: 'Lipid Profile',
};
const RADIOLOGY_REQUEST = {
  ...BASE, requestId: '99999999-9999-4999-8999-999999999999', imagingType: 'X-Ray Chest, CT Head',
};

const OPD_ENCOUNTER = {
  type: 'OPD', encounterId: 'OPD-1', date: '2026-10-03T18:30:00.000Z',
  departmentName: 'Cardiology', doctorNames: ['Dr. Rao'], wardName: null, bedNumber: null,
};
const IPD_ENCOUNTER = {
  type: 'IPD', encounterId: 'ADM-1', date: '2026-10-01T05:00:00.000Z',
  departmentName: 'Medicine', doctorNames: ['Dr. Sen', 'Dr. Iyer'], wardName: 'ICU', bedNumber: 'B-07',
};

let mockPathologyRows: unknown[] = [];
let mockRadiologyRows: unknown[] = [];
// requestId → that request's single-request GET result.
let mockDetails: Record<string, unknown> = {};
const mockGetPathology = jest.fn();

const detailFor = (id: string) =>
  id in mockDetails
    ? { currentData: mockDetails[id], isFetching: false }
    : { currentData: undefined, isFetching: true };

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: mockPathologyRows, total: mockPathologyRows.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery: () => ({
    data: { data: mockRadiologyRows, total: mockRadiologyRows.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useListDisabledPathologyTestsQuery: () => ({ data: [] }),
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useGetPathologyRequestQuery: (id: string, opts: { skip?: boolean }) => {
    mockGetPathology(id, opts);
    return opts?.skip ? { currentData: undefined, isFetching: false } : detailFor(id);
  },
  useGetRadiologyRequestQuery: (id: string, opts: { skip?: boolean }) =>
    opts?.skip ? { currentData: undefined, isFetching: false } : detailFor(id),
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

// Rows are matched by request id prefix via their unique test label.
async function openPanel(user: ReturnType<typeof userEvent.setup>, label: string) {
  const row = screen.getByRole('cell', { name: label }).closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'View' }));
}

async function closePanel(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}');
  const close = screen.queryAllByRole('button').find((b) => b.querySelector('svg.lucide-x'));
  if (close && screen.queryByText('Patient Name')) await user.click(close);
  expect(screen.queryByText('Patient Name')).not.toBeInTheDocument();
}

const detailRow = (label: string) => screen.getByText(label, { selector: 'span' }).parentElement as HTMLElement;
const listedTests = () => within(screen.getByRole('list', { name: 'Requested tests' }))
  .getAllByRole('listitem').map((li) => li.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  mockPathologyRows = [OPD_REQUEST, IPD_REQUEST];
  mockRadiologyRows = [RADIOLOGY_REQUEST];
  mockDetails = {
    [OPD_REQUEST.requestId]:       { ...OPD_REQUEST, encounter: OPD_ENCOUNTER },
    [IPD_REQUEST.requestId]:       { ...IPD_REQUEST, encounter: IPD_ENCOUNTER },
    [RADIOLOGY_REQUEST.requestId]: { ...RADIOLOGY_REQUEST, encounter: IPD_ENCOUNTER },
  };
});

describe('Lab View — multiple tests', () => {
  test('lists every selected pathology test separately (commas inside a test name are kept)', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, OPD_REQUEST.testType);

    expect(screen.getByText('3 tests')).toBeInTheDocument();
    expect(detailRow('Tests (3)')).toBeInTheDocument();
    expect(listedTests()).toEqual([
      'CBC (Complete Blood Count)',
      'Thyroid Profile (T3, T4, TSH)',
      'Serum Electrolytes (Sodium, Potassium, Chloride)',
    ]);
  });

  test('a single-test request shows that one test', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, 'Lipid Profile');

    expect(detailRow('Test')).toBeInTheDocument();
    expect(listedTests()).toEqual(['Lipid Profile']);
  });

  test('lists every imaging type on a radiology request', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /radiology/i }));
    await openPanel(user, RADIOLOGY_REQUEST.imagingType);

    expect(screen.getByText('2 tests')).toBeInTheDocument();
    expect(listedTests()).toEqual(['X-Ray Chest', 'CT Head']);
    expect(within(detailRow('Patient Type')).getByText('IPD')).toBeInTheDocument();
  });

  test('the list row keeps the full test string available on hover', () => {
    render(<LabPage />);
    expect(screen.getByRole('cell', { name: OPD_REQUEST.testType })).toHaveAttribute('title', OPD_REQUEST.testType);
  });
});

describe('Lab View — OPD and IPD requests for the same patient', () => {
  test('fetches the detail of the viewed request', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, OPD_REQUEST.testType);
    expect(mockGetPathology).toHaveBeenCalledWith(OPD_REQUEST.requestId, { skip: false });
  });

  test('the OPD request shows only its OPD visit date, department and doctor', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, OPD_REQUEST.testType);

    expect(within(detailRow('Patient Type')).getByText('OPD')).toBeInTheDocument();
    expect(within(detailRow('OPD Visit Date')).getByText(/04 Oct 2026/)).toBeInTheDocument();
    expect(within(detailRow('Department')).getByText('Cardiology')).toBeInTheDocument();
    expect(within(detailRow('Doctor')).getByText('Dr. Rao')).toBeInTheDocument();
    expect(screen.queryByText('Admission Date', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('Ward Name', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('Bed Number', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('ICU')).not.toBeInTheDocument();
  });

  test('the IPD request shows only its admission date, ward, bed, department and doctors', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, 'Lipid Profile');

    expect(within(detailRow('Patient Type')).getByText('IPD')).toBeInTheDocument();
    expect(within(detailRow('Admission Date')).getByText(/01 Oct 2026/)).toBeInTheDocument();
    expect(within(detailRow('Ward Name')).getByText('ICU')).toBeInTheDocument();
    expect(within(detailRow('Bed Number')).getByText('B-07')).toBeInTheDocument();
    expect(within(detailRow('Department')).getByText('Medicine')).toBeInTheDocument();
    expect(within(detailRow('Doctors')).getByText('Dr. Sen, Dr. Iyer')).toBeInTheDocument();
    expect(screen.queryByText('OPD Visit Date')).not.toBeInTheDocument();
    expect(screen.queryByText('Cardiology')).not.toBeInTheDocument();
  });

  test('viewing one request after the other never carries details across', async () => {
    const user = userEvent.setup();
    render(<LabPage />);

    await openPanel(user, OPD_REQUEST.testType);
    expect(within(detailRow('Patient Type')).getByText('OPD')).toBeInTheDocument();
    await closePanel(user);

    await openPanel(user, 'Lipid Profile');
    expect(within(detailRow('Patient Type')).getByText('IPD')).toBeInTheDocument();
    expect(screen.queryByText('Cardiology')).not.toBeInTheDocument();
    await closePanel(user);

    await openPanel(user, OPD_REQUEST.testType);
    expect(within(detailRow('Patient Type')).getByText('OPD')).toBeInTheDocument();
    expect(screen.queryByText('ICU')).not.toBeInTheDocument();
  });

  test("shows Loading (not another request's details) until the request's own detail arrives", async () => {
    delete mockDetails[IPD_REQUEST.requestId];
    const user = userEvent.setup();
    render(<LabPage />);
    await openPanel(user, 'Lipid Profile');

    expect(within(detailRow('Patient Type')).getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Cardiology')).not.toBeInTheDocument();
    expect(screen.queryByText('ICU')).not.toBeInTheDocument();
  });

  test('omits department/doctor rows when not available, and the whole block when unlinked', async () => {
    mockDetails[OPD_REQUEST.requestId] = {
      ...OPD_REQUEST, encounter: { ...OPD_ENCOUNTER, departmentName: null, doctorNames: [] },
    };
    mockDetails[IPD_REQUEST.requestId] = { ...IPD_REQUEST, encounter: null };
    const user = userEvent.setup();
    render(<LabPage />);

    await openPanel(user, OPD_REQUEST.testType);
    expect(screen.getByText('Patient Type')).toBeInTheDocument();
    expect(screen.queryByText('Department')).not.toBeInTheDocument();
    expect(screen.queryByText('Doctor')).not.toBeInTheDocument();
    await closePanel(user);

    await openPanel(user, 'Lipid Profile');
    expect(screen.queryByText('Patient Type')).not.toBeInTheDocument();
    // Existing rows are untouched.
    expect(screen.getByText('Referred By', { selector: 'span' })).toBeInTheDocument();
  });
});
