import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Lab section view of requests created from a Billing LAB_TEST charge
// (`chargeId` set): payment is collected in Billing, never via Lab's Collect.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const BASE = {
  patientId: 'PAT-001', fullName: 'John Doe', tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk',
  referredBy: 'SELF', referredByName: 'Self', status: 'PENDING', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-05-19T10:00:00.000Z', updatedAt: '2026-05-19T10:00:00.000Z',
};
const BILLED_UNPAID = {
  ...BASE, requestId: '33333333-3333-4333-8333-333333333333', testType: 'Thyroid Panel',
  chargeId: 'CHG-UNPAID1', payment: null,
};
const BILLED_PAID = {
  ...BASE, requestId: '44444444-4444-4444-8444-444444444444', testType: 'Liver Function',
  chargeId: 'CHG-PAID01',
  payment: { paymentId: 'pay-charge-1', amount: 600, paymentMethod: 'CASH', paidAt: '2026-05-19T11:00:00.000Z', receiptAvailable: true },
};
const BILLED_FREE = {
  ...BASE, requestId: '55555555-5555-4555-8555-555555555555', testType: 'Blood Sugar',
  chargeId: 'CHG-FREE01',
  payment: { paymentId: 'pay-charge-free', amount: 0, paymentMethod: 'CASH', paidAt: '2026-05-19T11:00:00.000Z', receiptAvailable: true },
};
const LAB_UNPAID = {
  ...BASE, requestId: '66666666-6666-4666-8666-666666666666', testType: 'Urine Routine',
  chargeId: null, payment: null,
};

let mockRequests: unknown[] = [];
const mockReceiptTrigger = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: mockRequests, total: mockRequests.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery:      () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
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
}));

jest.mock('@/store/api/payment.api', () => ({
  useLazyGetReceiptUrlQuery: () => [mockReceiptTrigger, { isFetching: false }],
}));
jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));
jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

let mockRole = 'RECEPTIONIST';
jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

const rowFor = (text: string) => screen.getByText(text).closest('tr') as HTMLElement;

async function openPanel(testType: string) {
  const user = userEvent.setup();
  await user.click(within(rowFor(testType)).getByRole('button', { name: 'View' }));
  return user;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'RECEPTIONIST';
  mockRequests = [BILLED_UNPAID, BILLED_PAID, BILLED_FREE, LAB_UNPAID];
});

describe('Billing-created lab requests in the Lab section', () => {
  test('appear in the list with their Billing payment status', () => {
    render(<LabPage />);
    expect(within(rowFor('Thyroid Panel')).getByText('Unpaid')).toBeInTheDocument();
    expect(within(rowFor('Liver Function')).getByText('Paid')).toBeInTheDocument();
    expect(within(rowFor('Blood Sugar')).getByText('Paid')).toBeInTheDocument();
  });

  test('an unpaid Billing-created request has no Lab Collect action (Lab-created ones still do)', () => {
    render(<LabPage />);
    expect(within(rowFor('Thyroid Panel')).queryByRole('button', { name: 'Collect' })).not.toBeInTheDocument();
    expect(within(rowFor('Urine Routine')).getByRole('button', { name: 'Collect' })).toBeInTheDocument();
  });

  test('its detail panel points to Billing instead of offering Collect Payment', async () => {
    render(<LabPage />);
    await openPanel('Thyroid Panel');
    expect(screen.getByText(/Billed in Billing \(charge CHG-UNPAID1\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collect payment/i })).not.toBeInTheDocument();
  });

  // No Pathology file upload for any role (structured per-test reports only).
  test.each(['Thyroid Panel', 'Liver Function', 'Blood Sugar'])(
    '%s: the Hospital Admin never gets a Pathology file upload option, paid or unpaid',
    async (testType) => {
      mockRole = 'HOSPITAL_ADMIN';
      render(<LabPage />);
      await openPanel(testType);
      expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/can be uploaded once/)).not.toBeInTheDocument();
    },
  );

  test('once paid in Billing, the Hospital Admin is not asked to collect again', async () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<LabPage />);
    await openPanel('Liver Function');
    expect(screen.queryByRole('button', { name: /collect payment/i })).not.toBeInTheDocument();
  });

  test('a paid Billing-created request downloads the Billing payment receipt', async () => {
    mockReceiptTrigger.mockReturnValue({ unwrap: () => Promise.resolve('https://s3.test/receipt.pdf') });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<LabPage />);
    const user = await openPanel('Liver Function');
    expect(screen.getByText(/₹600\.00 · Cash/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /download receipt/i }));
    expect(mockReceiptTrigger).toHaveBeenCalledWith('pay-charge-1');
    expect(open).toHaveBeenCalledWith('https://s3.test/receipt.pdf', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  test('a free (₹0) test shows as Paid · Free with a receipt', async () => {
    render(<LabPage />);
    await openPanel('Blood Sugar');
    expect(screen.getByText(/₹0\.00 · Free/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download receipt/i })).toBeInTheDocument();
  });

  test('the Pathologist never gets a file upload option, paid or unpaid', async () => {
    mockRole = 'PATHOLOGIST';
    render(<LabPage />);
    await openPanel('Liver Function');
    expect(screen.queryByRole('button', { name: /upload report/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/can be uploaded once/)).not.toBeInTheDocument();
  });
});
