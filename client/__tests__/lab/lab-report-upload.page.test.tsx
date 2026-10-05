import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const PAYMENT = {
  paymentId: 'pay-1', amount: 450, paymentMethod: 'CASH',
  paidAt: '2026-05-19T10:30:00.000Z', receiptAvailable: true,
};

const BASE = {
  patientId: 'PAT-001', fullName: 'John Doe', tenantId: 't1', requestedBy: 'u1', requestedByName: 'Dr. A',
  referredBy: 'SELF', referredByName: 'Self', status: 'PENDING', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-05-19T10:00:00.000Z', updatedAt: '2026-05-19T10:00:00.000Z',
  payment: null,
};

// Unpaid → paid (pending upload) → completed with an uploaded report.
function requestsFor(field: 'testType' | 'imagingType', prefix: string) {
  return [
    { ...BASE, requestId: `${prefix}-unpaid`, [field]: 'Unpaid Test' },
    { ...BASE, requestId: `${prefix}-paid`,   [field]: 'Paid Test', payment: PAYMENT },
    {
      ...BASE, requestId: `${prefix}-done`, [field]: 'Reported Test', payment: PAYMENT,
      status: 'COMPLETED', reportUrl: `https://s3.test/${prefix}-done/report.pdf`,
    },
  ];
}

const PATHOLOGY_REQUESTS = requestsFor('testType',    'path');
const RADIOLOGY_REQUESTS = requestsFor('imagingType', 'rad');

const mockUploadPathology = jest.fn();
const mockUploadRadiology = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: PATHOLOGY_REQUESTS, total: 3, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery: () => ({
    data: { data: RADIOLOGY_REQUESTS, total: 3, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [mockUploadPathology, { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [mockUploadRadiology, { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
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

const unwrapping = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });
const rejecting  = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

const CASES = [
  { type: 'pathology' as const, role: 'PATHOLOGIST', prefix: 'path', upload: mockUploadPathology },
  { type: 'radiology' as const, role: 'RADIOLOGIST', prefix: 'rad',  upload: mockUploadRadiology },
];

async function openDetail(type: 'pathology' | 'radiology', testLabel: string) {
  const user = userEvent.setup();
  render(<LabPage />);
  if (type === 'radiology') await user.click(screen.getByRole('button', { name: /radiology/i }));
  const row = screen.getByText(testLabel).closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'View' }));
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each(CASES)('Lab $type — report upload & display', ({ type, role, prefix, upload }) => {
  beforeEach(() => { mockRole = role; });

  test('unpaid request: shows "No report uploaded" and no Upload Report button', async () => {
    await openDetail(type, 'Unpaid Test');
    expect(screen.getByText('No report uploaded')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can be uploaded once payment has been collected/i)).toBeInTheDocument();
  });

  test('paid request without a report: shows "No report uploaded" and allows upload', async () => {
    await openDetail(type, 'Paid Test');
    expect(screen.getByText('No report uploaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload report/i })).toBeInTheDocument();
    expect(screen.queryByText(/can be uploaded once payment has been collected/i)).not.toBeInTheDocument();
  });

  test('paid request: uploads the selected file against this request', async () => {
    upload.mockReturnValue(unwrapping({}));
    const user = await openDetail(type, 'Paid Test');
    await user.click(screen.getByRole('button', { name: /upload report/i }));

    const file = new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    const dialog = screen.getByText(/report file/i).closest('form') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /upload report/i }));

    expect(upload).toHaveBeenCalledWith({ requestId: `${prefix}-paid`, file });
  });

  test('surfaces the backend payment-gate error if the upload is rejected', async () => {
    upload.mockReturnValue(rejecting({ status: 409, data: { message: 'Payment must be collected before the report can be uploaded.' } }));
    const user = await openDetail(type, 'Paid Test');
    await user.click(screen.getByRole('button', { name: /upload report/i }));

    const file = new File(['%PDF-1.4'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
    const dialog = screen.getByText(/report file/i).closest('form') as HTMLElement;
    await user.click(within(dialog).getByRole('button', { name: /upload report/i }));

    expect(await screen.findByText(/payment must be collected/i)).toBeInTheDocument();
  });

  test('uploaded report: shows "View Report" linking to that request\'s report', async () => {
    await openDetail(type, 'Reported Test');
    const link = screen.getByRole('link', { name: /view report/i });
    expect(link).toHaveAttribute('href', `https://s3.test/${prefix}-done/report.pdf`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByText('No report uploaded')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
  });
});

test('roles without upload permission never see Upload Report, even when paid', async () => {
  mockRole = 'RECEPTIONIST';
  await openDetail('pathology', 'Paid Test');
  expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/can be uploaded once payment has been collected/i)).not.toBeInTheDocument();
});
