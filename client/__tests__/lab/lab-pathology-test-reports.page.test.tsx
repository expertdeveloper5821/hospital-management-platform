import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Structured Pathology reports: every selected test in the View panel opens
// its own report form (lab staff) / submitted report (everyone else), with a
// separate PDF per test.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const CBC = 'CBC (Complete Blood Count)';
const LFT = 'LFT (Liver Function Test)';
const DENGUE = 'Dengue NS1 / IgM / IgG';

const BASE = {
  patientId: 'PAT-001', fullName: 'John Doe', tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk',
  referredBy: 'SELF', referredByName: 'Self', status: 'IN_PROGRESS', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-10-04T10:00:00.000Z', updatedAt: '2026-10-04T10:00:00.000Z',
  chargeId: null,
};
const PAID = { paymentId: 'PAY-1', amount: 500, paymentMethod: 'CASH', paidAt: '2026-10-04T10:05:00.000Z', receiptAvailable: true };

const REQUEST = {
  ...BASE, requestId: '77777777-7777-4777-8777-777777777777', testType: `${CBC}, ${LFT}, ${DENGUE}`, payment: PAID,
};
const RADIOLOGY_REQUEST = {
  ...BASE, requestId: '99999999-9999-4999-8999-999999999999', imagingType: 'X-Ray Chest', payment: PAID,
};

const field = (key: string, name: string, unit: string | null, referenceRange: string | null, extra = {}) => ({
  key, name, unit, inputType: 'number', section: null, options: null, referenceRange, ...extra,
});

const CBC_FIELDS = [
  field('hemoglobin', 'Haemoglobin (Hb)', 'g/dL', '13.0 - 17.0'),
  field('wbc', 'Total Leucocyte Count (TLC / WBC)', 'cells/µL', '4000 - 11000'),
  field('neutrophils', 'Neutrophils', '%', '40 - 80', { section: 'Differential Leucocyte Count' }),
];
const LFT_FIELDS = [
  field('sgpt', 'SGPT (ALT)', 'U/L', '0 - 41'),
  field('albumin', 'Albumin', 'g/dL', '3.5 - 5.2'),
];
const DENGUE_FIELDS = [
  field('ns1', 'Dengue NS1 Antigen', null, 'Negative', { inputType: 'select', options: ['Negative', 'Positive', 'Equivocal'] }),
];

const CBC_RESULT = {
  values: [
    { key: 'hemoglobin', name: 'Haemoglobin (Hb)', section: null, value: '10.5', unit: 'g/dL', referenceRange: '13.0 - 17.0', flag: 'LOW' },
    { key: 'neutrophils', name: 'Neutrophils', section: 'Differential Leucocyte Count', value: '60', unit: '%', referenceRange: '40 - 80', flag: null },
  ],
  remarks: 'Mild anaemia.',
  clinicalNote: 'CBC clinical note.' as string | null,
  comment: null as string | null,
  submittedBy: 'p1', submittedByName: 'Lab Pathologist', submittedAt: '2026-10-04T12:00:00.000Z',
};

function reportsWith(cbcResult: typeof CBC_RESULT | null) {
  return [
    { testIndex: 0, testName: CBC,    templateKey: 'CBC',    fields: CBC_FIELDS,    result: cbcResult,
      clinicalContent: { clinicalNote: 'CBC clinical note.', comment: null, correlateClinically: 'Correlate clinically.' } },
    { testIndex: 1, testName: LFT,    templateKey: 'LFT',    fields: LFT_FIELDS,    result: null },
    { testIndex: 2, testName: DENGUE, templateKey: 'DENGUE', fields: DENGUE_FIELDS, result: null },
  ];
}

let mockRole = 'PATHOLOGIST';
let mockPathologyRows: unknown[] = [];
let mockDetails: Record<string, unknown> = {};
const mockSubmit = jest.fn();
const mockGetPdf = jest.fn();
const mockGetAllPdf = jest.fn();

const detailFor = (id: string) =>
  id in mockDetails ? { currentData: mockDetails[id], isFetching: false } : { currentData: undefined, isFetching: true };

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: mockPathologyRows, total: mockPathologyRows.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery: () => ({
    data: { data: [RADIOLOGY_REQUEST], total: 1, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
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
  useSubmitPathologyTestReportMutation: () => [mockSubmit, { isLoading: false }],
  useGetPathologyTestReportPdfMutation: () => [mockGetPdf, { isLoading: false }],
  useGetAllPathologyTestReportsPdfMutation: () => [mockGetAllPdf, { isLoading: false }],
  useGetPathologyRequestQuery: (id: string, opts: { skip?: boolean }) =>
    opts?.skip ? { currentData: undefined, isFetching: false } : detailFor(id),
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
    selector({ auth: { profile: { role: mockRole, userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

function setup(opts: { role?: string; cbcResult?: typeof CBC_RESULT | null; paid?: boolean } = {}) {
  mockRole = opts.role ?? 'PATHOLOGIST';
  const request = { ...REQUEST, payment: opts.paid === false ? null : PAID };
  mockPathologyRows = [request];
  mockDetails = {
    [REQUEST.requestId]:           { ...request, testReports: reportsWith(opts.cbcResult ?? null) },
    [RADIOLOGY_REQUEST.requestId]: { ...RADIOLOGY_REQUEST },
  };
}

async function openRequest(user: ReturnType<typeof userEvent.setup>) {
  render(<LabPage />);
  const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('John Doe') && r.textContent?.includes('CBC')) as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'View' }));
}

const testsList = () => screen.getByRole('list', { name: 'Requested tests' });
const reportDialog = (testName: string) => screen.getByRole('dialog', { name: `${testName} report` });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Requested tests are clickable', () => {
  test('every selected test is a button with its exact name and a report status', async () => {
    const user = userEvent.setup();
    setup({ cbcResult: CBC_RESULT });
    await openRequest(user);
    const list = testsList();
    for (const name of [CBC, LFT, DENGUE]) {
      expect(within(list).getByRole('button', { name })).toBeInTheDocument();
    }
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Report Submitted');
    expect(items[1]).toHaveTextContent('Pending');
  });

  test('Radiology tests are not turned into report forms', async () => {
    const user = userEvent.setup();
    setup();
    mockRole = 'HOSPITAL_ADMIN';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /Radiology/ }));
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('X-Ray Chest')) as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'View' }));
    expect(within(testsList()).queryByRole('button')).not.toBeInTheDocument();
    expect(testsList()).toHaveTextContent('X-Ray Chest');
  });
});

describe('Structured report-entry forms (lab staff)', () => {
  test('each test opens its own form with its own parameters, units and reference ranges', async () => {
    const user = userEvent.setup();
    setup();
    await openRequest(user);

    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    let dialog = reportDialog(CBC);
    expect(within(dialog).getByLabelText('Haemoglobin (Hb)')).toBeInTheDocument();
    expect(within(dialog).getByText('Ref: 13.0 - 17.0')).toBeInTheDocument();
    expect(within(dialog).getByText('g/dL')).toBeInTheDocument();
    expect(within(dialog).getByText('Differential Leucocyte Count')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('SGPT (ALT)')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(within(testsList()).getByRole('button', { name: LFT }));
    dialog = reportDialog(LFT);
    expect(within(dialog).getByLabelText('SGPT (ALT)')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Haemoglobin (Hb)')).not.toBeInTheDocument();
  });

  test('all fields are optional — only the entered values are sent, the rest as null', async () => {
    const user = userEvent.setup();
    setup();
    mockSubmit.mockReturnValue({
      unwrap: () => Promise.resolve({ ...REQUEST, testReports: reportsWith(CBC_RESULT) }),
    });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);

    await user.type(within(dialog).getByLabelText('Haemoglobin (Hb)'), '10.5');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));

    expect(mockSubmit).toHaveBeenCalledWith({
      requestId: REQUEST.requestId,
      testIndex: 0,
      testName:  CBC,
      values:    { hemoglobin: '10.5', wbc: null, neutrophils: null },
      remarks:   null,
      // Pre-filled from the Test Master and sent with the report as-is.
      clinicalNote: 'CBC clinical note.',
      comment:      null,
    });
    // After submission the submitted report (filled values only) is shown.
    expect(await within(dialog).findByText(/Report submitted\. It is now available to the doctor\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('table', { name: `${CBC} results` })).toHaveTextContent('10.5');
  });

  test('an entirely empty form is not submitted', async () => {
    const user = userEvent.setup();
    setup();
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: LFT }));
    await user.click(within(reportDialog(LFT)).getByRole('button', { name: 'Submit Report' }));
    expect(screen.getByText('Enter at least one result before submitting the report.')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  test('non-numeric values in numeric fields are flagged and not submitted', async () => {
    const user = userEvent.setup();
    setup();
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: LFT }));
    const dialog = reportDialog(LFT);
    await user.type(within(dialog).getByLabelText('SGPT (ALT)'), 'high');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(within(dialog).getByText('Enter a number.')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  test('select parameters offer only their listed options', async () => {
    const user = userEvent.setup();
    setup();
    mockSubmit.mockReturnValue({ unwrap: () => Promise.resolve({ ...REQUEST, testReports: reportsWith(null) }) });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: DENGUE }));
    const dialog = reportDialog(DENGUE);
    const select = within(dialog).getByLabelText('Dengue NS1 Antigen');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['—', 'Negative', 'Positive', 'Equivocal']);
    await user.selectOptions(select, 'Positive');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ testIndex: 2, values: { ns1: 'Positive' } }));
  });

  test('a backend error is shown in the form', async () => {
    const user = userEvent.setup();
    setup();
    mockSubmit.mockReturnValue({ unwrap: () => Promise.reject({ data: { message: 'The tests on this request have changed.' } }) });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: LFT }));
    const dialog = reportDialog(LFT);
    await user.type(within(dialog).getByLabelText('Albumin'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(await within(dialog).findByText('The tests on this request have changed.')).toBeInTheDocument();
  });

  test('a submitted report can be edited, pre-filled with its values', async () => {
    const user = userEvent.setup();
    setup({ cbcResult: CBC_RESULT });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);
    await user.click(within(dialog).getByRole('button', { name: /Edit Results/ }));
    expect(within(dialog).getByLabelText('Haemoglobin (Hb)')).toHaveValue('10.5');
    expect(within(dialog).getByLabelText('Neutrophils')).toHaveValue('60');
    // Free-text Remarks were replaced by Clinical Notes / Comment; a legacy
    // report's stored remarks are carried over.
    expect(within(dialog).queryByLabelText('Remarks')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Clinical Notes')).toHaveValue('CBC clinical note.');
    mockSubmit.mockReturnValue({ unwrap: () => Promise.resolve({ ...REQUEST, testReports: reportsWith(CBC_RESULT) }) });
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ testIndex: 0, remarks: 'Mild anaemia.' }));
  });

  test('a new report pre-fills Clinical Notes from the Test Master; Comment stays blank when none is configured', async () => {
    const user = userEvent.setup();
    setup();
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);
    expect(within(dialog).getByLabelText('Clinical Notes')).toHaveValue('CBC clinical note.');
    expect(within(dialog).getByLabelText('Comment')).toHaveValue('');
  });

  test('edited Clinical Notes and an entered Comment are submitted with the report', async () => {
    const user = userEvent.setup();
    setup();
    const saved = { ...CBC_RESULT, clinicalNote: 'Edited note.', comment: 'Repeat after 2 weeks.' };
    mockSubmit.mockReturnValue({ unwrap: () => Promise.resolve({ ...REQUEST, testReports: reportsWith(saved) }) });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);

    await user.type(within(dialog).getByLabelText('Haemoglobin (Hb)'), '10.5');
    const note = within(dialog).getByLabelText('Clinical Notes');
    await user.clear(note);
    await user.type(note, 'Edited note.');
    await user.type(within(dialog).getByLabelText('Comment'), '  Repeat after 2 weeks.  ');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));

    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
      testIndex: 0, clinicalNote: 'Edited note.', comment: 'Repeat after 2 weeks.',
    }));
    // The submitted view shows the report's saved text.
    expect(await within(dialog).findByText('Edited note.')).toBeInTheDocument();
    expect(within(dialog).getByText('Repeat after 2 weeks.')).toBeInTheDocument();
  });

  test('clearing Clinical Notes submits it as empty (null)', async () => {
    const user = userEvent.setup();
    setup();
    mockSubmit.mockReturnValue({ unwrap: () => Promise.resolve({ ...REQUEST, testReports: reportsWith(CBC_RESULT) }) });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);
    await user.type(within(dialog).getByLabelText('Haemoglobin (Hb)'), '10.5');
    await user.clear(within(dialog).getByLabelText('Clinical Notes'));
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ clinicalNote: null, comment: null }));
  });

  test('reopening a submitted report loads its saved Clinical Notes / Comment (not the Test Master default) for editing', async () => {
    const user = userEvent.setup();
    setup({ cbcResult: { ...CBC_RESULT, clinicalNote: 'Saved note.', comment: 'Saved comment.' } });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);
    expect(within(dialog).getByText('Saved note.')).toBeInTheDocument();
    expect(within(dialog).getByText('Saved comment.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /Edit Results/ }));
    expect(within(dialog).getByLabelText('Clinical Notes')).toHaveValue('Saved note.');
    expect(within(dialog).getByLabelText('Comment')).toHaveValue('Saved comment.');
  });

  test('results cannot be entered before payment is collected', async () => {
    const user = userEvent.setup();
    setup({ paid: false });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);
    expect(within(dialog).getByText('Results can be entered once payment has been collected.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Submit Report' })).not.toBeInTheDocument();
  });
});

describe('Doctor viewing', () => {
  test('a doctor sees the submitted results (filled values only), flags and clinical notes — never the entry form', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    const dialog = reportDialog(CBC);

    expect(within(dialog).getByText('John Doe', { exact: false })).toBeInTheDocument();
    const table = within(dialog).getByRole('table', { name: `${CBC} results` });
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(rows).toEqual([
      'Haemoglobin (Hb)10.5Lowg/dL13.0 - 17.0',
      'Differential Leucocyte Count',
      'Neutrophils60%40 - 80',
    ]);
    // Unfilled parameters (e.g. TLC) are not listed.
    expect(within(dialog).queryByText('Total Leucocyte Count (TLC / WBC)')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Clinical Notes')).toBeInTheDocument();
    expect(within(dialog).getByText('CBC clinical note.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Comment')).not.toBeInTheDocument();
    // The old free-text Remarks are no longer part of the report.
    expect(within(dialog).queryByText('Mild anaemia.')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Reported by Lab Pathologist/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Edit Results|Enter Results/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
  });

  test('a test without a submitted report says so', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: LFT }));
    expect(within(reportDialog(LFT)).getByText('The report for this test has not been submitted yet.')).toBeInTheDocument();
    expect(within(reportDialog(LFT)).queryByRole('button', { name: /PDF/ })).not.toBeInTheDocument();
  });
});

describe('Per-test PDF', () => {
  test('Download PDF fetches only that test\'s PDF and saves it under the test\'s name', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetPdf.mockResolvedValue({ data: 'blob:cbc-pdf' });
    const clicks: HTMLAnchorElement[] = [];
    const spy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    await user.click(within(reportDialog(CBC)).getByRole('button', { name: /Download PDF/ }));

    expect(mockGetPdf).toHaveBeenCalledWith({ requestId: REQUEST.requestId, testIndex: 0, letterhead: true });
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].getAttribute('href')).toBe('blob:cbc-pdf');
    expect(clicks[0].download).toBe('pathology-report-CBC-Complete-Blood-Count-PAT-001.pdf');
    spy.mockRestore();
  });

  test('View / Print PDF opens that test\'s PDF in a new tab', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetPdf.mockResolvedValue({ data: 'blob:cbc-pdf' });
    const win = { location: { href: '' }, close: jest.fn() };
    const open = jest.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    await user.click(within(reportDialog(CBC)).getByRole('button', { name: /View \/ Print PDF/ }));

    await waitFor(() => expect(win.location.href).toBe('blob:cbc-pdf'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    // View / Print keeps the plain copy — no letterhead request.
    expect(mockGetPdf).toHaveBeenCalledWith({ requestId: REQUEST.requestId, testIndex: 0 });
    open.mockRestore();
  });

  test('a PDF failure shows an error', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetPdf.mockResolvedValue({ error: { status: 500 } });
    await openRequest(user);
    await user.click(within(testsList()).getByRole('button', { name: CBC }));
    await user.click(within(reportDialog(CBC)).getByRole('button', { name: /Download PDF/ }));
    expect(await screen.findByText('Could not load the report PDF. Please try again.')).toBeInTheDocument();
  });
});

describe('Bulk Download / Print of all available reports', () => {
  const bulk = () => screen.getByLabelText('All test reports');

  test('is hidden until at least one test report has been submitted', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: null });
    await openRequest(user);
    expect(testsList()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download All Reports/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Print All Reports/ })).not.toBeInTheDocument();
  });

  test('Download All fetches one combined letterhead PDF and saves it — per-test PDF untouched', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetAllPdf.mockResolvedValue({ data: 'blob:all-pdf' });
    const clicks: HTMLAnchorElement[] = [];
    const spy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    await openRequest(user);
    // Counts only the available (submitted) reports.
    await user.click(within(bulk()).getByRole('button', { name: 'Download All Reports (1)' }));

    expect(mockGetAllPdf).toHaveBeenCalledWith({ requestId: REQUEST.requestId, letterhead: true });
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].getAttribute('href')).toBe('blob:all-pdf');
    expect(clicks[0].download).toBe('pathology-reports-PAT-001.pdf');
    expect(mockGetPdf).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('Download All and Print All sit side by side in one row', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    await openRequest(user);
    const download = within(bulk()).getByRole('button', { name: /Download All Reports/ });
    const print    = within(bulk()).getByRole('button', { name: /Print All Reports/ });
    expect(download.parentElement).toBe(print.parentElement);
    expect(download.parentElement).toHaveClass('grid', 'grid-cols-2');
    expect(download.className).toBe(print.className);
  });

  test('Print All loads the combined print copy (no letterhead) into a hidden frame and opens one print dialog', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetAllPdf.mockResolvedValue({ data: 'blob:all-pdf' });
    await openRequest(user);
    await user.click(within(bulk()).getByRole('button', { name: /Print All Reports/ }));

    // Print copy — no letterhead request (the server adds the Doctor Signature to every copy).
    expect(mockGetAllPdf).toHaveBeenCalledWith({ requestId: REQUEST.requestId });
    const frame = await waitFor(() => {
      const f = document.querySelector('iframe[src="blob:all-pdf"]') as HTMLIFrameElement | null;
      expect(f).not.toBeNull();
      return f!;
    });
    const print = jest.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { focus: jest.fn(), print } });
    frame.onload?.(new Event('load'));
    expect(print).toHaveBeenCalledTimes(1);
    expect(mockGetPdf).not.toHaveBeenCalled();
  });

  test('shows an error when the combined PDF cannot be loaded', async () => {
    const user = userEvent.setup();
    setup({ role: 'DOCTOR', cbcResult: CBC_RESULT });
    mockGetAllPdf.mockResolvedValue({ error: { status: 500 } });
    await openRequest(user);
    await user.click(within(bulk()).getByRole('button', { name: /Download All Reports/ }));
    expect(await within(bulk()).findByText('Could not load the reports PDF. Please try again.')).toBeInTheDocument();
  });
});

describe('Added catalog tests use the same report workflow', () => {
  const PREG  = 'Pregnancy Test (Urine β-hCG)';
  const WIDAL = 'Widal Test';
  const NEW_REQUEST = { ...REQUEST, testType: `${WIDAL}, ${PREG}` };
  const titres = ['< 1:20', '1:20', '1:40', '1:80', '1:160', '1:320', '1:640'];
  const reports = (pregResult: unknown) => [
    { testIndex: 0, testName: WIDAL, templateKey: 'WIDAL', result: null, fields: [
      field('typhiO', 'S. Typhi O', null, '< 1:80', { inputType: 'select', options: titres }),
      field('typhiH', 'S. Typhi H', null, '< 1:160', { inputType: 'select', options: titres }),
    ] },
    { testIndex: 1, testName: PREG, templateKey: 'PREGNANCY', result: pregResult, fields: [
      field('urineHcg', 'Urine hCG (Qualitative)', null, 'Negative', { inputType: 'select', options: ['Negative', 'Positive'] }),
    ] },
  ];

  function setupNew(role: string, pregResult: unknown = null) {
    mockRole = role;
    mockPathologyRows = [NEW_REQUEST];
    mockDetails = { [NEW_REQUEST.requestId]: { ...NEW_REQUEST, testReports: reports(pregResult) } };
  }

  async function openNew(user: ReturnType<typeof userEvent.setup>) {
    render(<LabPage />);
    const row = screen.getAllByRole('row').find((r) => r.textContent?.includes('Widal')) as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'View' }));
  }

  test('new tests are clickable with their exact names and submit through the same form', async () => {
    const user = userEvent.setup();
    setupNew('PATHOLOGIST');
    mockSubmit.mockReturnValue({ unwrap: () => Promise.resolve({ ...NEW_REQUEST, testReports: reports(null) }) });
    await openNew(user);

    expect(within(testsList()).getByRole('button', { name: WIDAL })).toBeInTheDocument();
    await user.click(within(testsList()).getByRole('button', { name: PREG }));
    const dialog = reportDialog(PREG);
    expect(within(dialog).getByRole('heading', { name: PREG })).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Urine hCG (Qualitative)'), 'Positive');
    await user.click(within(dialog).getByRole('button', { name: 'Submit Report' }));
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({
      testIndex: 1, testName: PREG, values: { urineHcg: 'Positive' },
    }));
  });

  test('the doctor sees a new test\'s submitted result and can download its own PDF', async () => {
    const user = userEvent.setup();
    setupNew('DOCTOR', {
      values: [{ key: 'urineHcg', name: 'Urine hCG (Qualitative)', section: null, value: 'Positive', unit: null, referenceRange: 'Negative', flag: null }],
      remarks: null, submittedBy: 'p1', submittedByName: 'Lab Pathologist', submittedAt: '2026-10-04T12:00:00.000Z',
    });
    mockGetPdf.mockResolvedValue({ data: 'blob:preg' });
    const clicks: HTMLAnchorElement[] = [];
    const spy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    await openNew(user);
    await user.click(within(testsList()).getByRole('button', { name: PREG }));
    const dialog = reportDialog(PREG);
    expect(within(within(dialog).getByRole('table')).getAllByRole('row')[1]).toHaveTextContent('Urine hCG (Qualitative)Positive—Negative');
    await user.click(within(dialog).getByRole('button', { name: /Download PDF/ }));
    expect(mockGetPdf).toHaveBeenCalledWith({ requestId: NEW_REQUEST.requestId, testIndex: 1, letterhead: true });
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0].download).toBe('pathology-report-Pregnancy-Test-Urine-hCG-PAT-001.pdf');
    spy.mockRestore();
  });
});
