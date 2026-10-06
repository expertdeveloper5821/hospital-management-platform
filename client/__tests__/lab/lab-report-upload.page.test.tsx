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
  useUploadRadiologyReportMutation:   () => [mockUploadRadiology, { isLoading: false }],
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

// Radiology only — Pathology has no file upload for any role (structured reports only).
const CASES = [
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

// Every role that can see the Pathology tab (RADIOLOGIST never does).
describe.each(['HOSPITAL_ADMIN', 'NURSE', 'PATHOLOGIST', 'DOCTOR', 'MANAGER', 'RECEPTIONIST', 'ADMIN'])(
  'Lab pathology — %s', (role) => {
    beforeEach(() => { mockRole = role; });

    test.each(['Unpaid Test', 'Paid Test', 'Reported Test'])('%s: no Upload Report option at all (structured reports only)', async (label) => {
      await openDetail('pathology', label);
      expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/can be uploaded once payment has been collected/i)).not.toBeInTheDocument();
      expect(document.querySelector('input[type="file"]')).toBeNull();
      // Pathology reports are viewed per test — no uploaded-file row or link.
      expect(screen.queryByText('No report uploaded')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /view report/i })).not.toBeInTheDocument();
    });
  },
);

describe.each(CASES)('Lab $type — report upload & display', ({ type, role, prefix, upload }) => {
  beforeEach(() => { mockRole = role; });

  test('unpaid request: "No report uploaded" (Radiology only) and no Upload Report button', async () => {
    await openDetail(type, 'Unpaid Test');
    // Pathology has no uploaded-report row at all (reports are viewed per test).
    expect(screen.queryByText('No report uploaded') !== null).toBe(type === 'radiology');
    expect(screen.queryByRole('link', { name: /view report/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
    expect(screen.getByText(/can be uploaded once payment has been collected/i)).toBeInTheDocument();
  });

  test('paid request without a report: "No report uploaded" (Radiology only) and allows upload', async () => {
    await openDetail(type, 'Paid Test');
    expect(screen.queryByText('No report uploaded') !== null).toBe(type === 'radiology');
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

  test('uploaded report: shows "View Report" linking to the report', async () => {
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
  await openDetail('radiology', 'Paid Test');
  expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/can be uploaded once payment has been collected/i)).not.toBeInTheDocument();
});
