import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const UNPAID_REQUEST = {
  requestId: '11111111-1111-4111-8111-111111111111', patientId: 'PAT-001', fullName: 'John Doe',
  tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk', testType: 'Complete Blood Count',
  referredBy: 'SELF', referredByName: 'Self', status: 'PENDING', priority: 'NORMAL', notes: null,
  reportUrl: null, requestedAt: '2026-05-19T10:00:00.000Z', updatedAt: '2026-05-19T10:00:00.000Z',
  payment: null,
};
const PAID_REQUEST = {
  ...UNPAID_REQUEST,
  requestId: '22222222-2222-4222-8222-222222222222',
  testType:  'Lipid Profile',
  payment:   {
    paymentId: 'pay-123', amount: 450, paymentMethod: 'UPI',
    paidAt: '2026-05-19T10:30:00.000Z', receiptAvailable: true,
  },
};
const TEMP_REQUEST = { ...UNPAID_REQUEST, requestId: 'temp-abc', testType: 'Offline Test' };

let mockRequests: unknown[] = [];
const mockCollectPathology = jest.fn();
const mockDeletePathology  = jest.fn();
const mockReceiptTrigger   = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: () => ({
    data: { data: mockRequests, total: mockRequests.length, totalPages: 1 }, isFetching: false, refetch: jest.fn(),
  }),
  useListRadiologyRequestsQuery:      () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useListDisabledPathologyTestsQuery: () => ({ data: [] }),
  useDeletePathologyRequestMutation:  () => [mockDeletePathology, { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [mockCollectPathology, { isLoading: false }],
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

const unwrapping = <T,>(value: T) => ({ unwrap: () => Promise.resolve(value) });
const rejecting  = (error: unknown) => ({ unwrap: () => Promise.reject(error) });

function rowFor(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'RECEPTIONIST';
  mockRequests = [UNPAID_REQUEST, PAID_REQUEST];
});

// ─── Status display ───────────────────────────────────────────────────────────

describe('Lab payment — Paid/Unpaid status', () => {
  test('table shows Paid / Unpaid badges per request', () => {
    render(<LabPage />);
    expect(within(rowFor('Complete Blood Count')).getByText('Unpaid')).toBeInTheDocument();
    expect(within(rowFor('Lipid Profile')).getByText('Paid')).toBeInTheDocument();
  });

  test('detail panel shows payment details for a paid request', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await user.click(within(rowFor('Lipid Profile')).getByRole('button', { name: 'View' }));
    expect(screen.getByText(/₹450\.00 · UPI/)).toBeInTheDocument();
  });
});

// ─── Role gating ──────────────────────────────────────────────────────────────

describe('Lab payment — role gating', () => {
  test.each(['RECEPTIONIST', 'HOSPITAL_ADMIN'])('%s sees Collect on unpaid rows only', (role) => {
    mockRole = role;
    render(<LabPage />);
    expect(within(rowFor('Complete Blood Count')).getByRole('button', { name: 'Collect' })).toBeInTheDocument();
    expect(within(rowFor('Lipid Profile')).queryByRole('button', { name: 'Collect' })).not.toBeInTheDocument();
  });

  test.each(['DOCTOR', 'NURSE', 'PATHOLOGIST', 'MANAGER', 'ADMIN'])('%s never sees Collect', async (role) => {
    const user = userEvent.setup();
    mockRole = role;
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: 'Collect' })).not.toBeInTheDocument();
    await user.click(within(rowFor('Complete Blood Count')).getByRole('button', { name: 'View' }));
    expect(screen.queryByRole('button', { name: /collect payment/i })).not.toBeInTheDocument();
  });

  test('offline-created (unsynced) requests cannot be collected', () => {
    mockRequests = [TEMP_REQUEST];
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: 'Collect' })).not.toBeInTheDocument();
  });

  test('receptionist sees Download Receipt on a paid request, and no Collect Payment', async () => {
    const user = userEvent.setup();
    render(<LabPage />);
    await user.click(within(rowFor('Lipid Profile')).getByRole('button', { name: 'View' }));
    expect(screen.getByRole('button', { name: /download receipt/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /collect payment/i })).not.toBeInTheDocument();
  });

  test('DOCTOR does not see Download Receipt (no access to the receipt endpoint)', async () => {
    const user = userEvent.setup();
    mockRole = 'DOCTOR';
    render(<LabPage />);
    await user.click(within(rowFor('Lipid Profile')).getByRole('button', { name: 'View' }));
    expect(screen.queryByRole('button', { name: /download receipt/i })).not.toBeInTheDocument();
  });
});

// ─── Collect flow ─────────────────────────────────────────────────────────────

describe('Lab payment — collect flow', () => {
  async function openCollect() {
    const user = userEvent.setup();
    render(<LabPage />);
    await user.click(within(rowFor('Complete Blood Count')).getByRole('button', { name: 'Collect' }));
    return user;
  }

  test('validates amount and payment mode before calling the API', async () => {
    const user = await openCollect();
    const submit = screen.getByRole('button', { name: /^collect payment$/i });

    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('Amount is required.');

    await user.type(screen.getByLabelText(/amount/i), '0');
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('greater than zero');

    await user.clear(screen.getByLabelText(/amount/i));
    await user.type(screen.getByLabelText(/amount/i), '10.555');
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('2 decimal places');

    await user.clear(screen.getByLabelText(/amount/i));
    await user.type(screen.getByLabelText(/amount/i), '450');
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('select a payment mode');

    expect(mockCollectPathology).not.toHaveBeenCalled();
  });

  test('submits amount, mode and transaction ID, then offers Download Receipt', async () => {
    mockCollectPathology.mockReturnValue(unwrapping({
      paymentId: 'pay-new', amount: 450, paymentMethod: 'UPI', receiptUrl: 'https://s3/receipt',
    }));
    mockReceiptTrigger.mockReturnValue(unwrapping('https://s3/presigned'));
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);

    const user = await openCollect();
    await user.type(screen.getByLabelText(/amount/i), '450');
    await user.click(screen.getByRole('button', { name: 'UPI' }));
    await user.type(screen.getByLabelText(/transaction id/i), 'UPI-REF-1');
    await user.click(screen.getByRole('button', { name: /^collect payment$/i }));

    expect(mockCollectPathology).toHaveBeenCalledWith({
      requestId: UNPAID_REQUEST.requestId, amount: 450, paymentMethod: 'UPI', transactionId: 'UPI-REF-1',
    });
    expect(await screen.findByText('Payment Collected')).toBeInTheDocument();
    expect(screen.getByText(/₹450\.00 received via UPI/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /download receipt/i }));
    expect(mockReceiptTrigger).toHaveBeenCalledWith('pay-new');
    expect(open).toHaveBeenCalledWith('https://s3/presigned', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  test('cash payments never send a transaction ID', async () => {
    mockCollectPathology.mockReturnValue(unwrapping({
      paymentId: 'pay-cash', amount: 200, paymentMethod: 'CASH', receiptUrl: 'https://s3/r',
    }));
    const user = await openCollect();
    await user.type(screen.getByLabelText(/amount/i), '200');
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    expect(screen.queryByLabelText(/transaction id/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^collect payment$/i }));

    expect(mockCollectPathology).toHaveBeenCalledWith({
      requestId: UNPAID_REQUEST.requestId, amount: 200, paymentMethod: 'CASH', transactionId: undefined,
    });
  });

  test('shows a clear message when the request was already paid (409)', async () => {
    mockCollectPathology.mockReturnValue(rejecting({ status: 409, data: { message: 'dup' } }));
    const user = await openCollect();
    await user.type(screen.getByLabelText(/amount/i), '450');
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    await user.click(screen.getByRole('button', { name: /^collect payment$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already been collected');
    expect(screen.queryByText('Payment Collected')).not.toBeInTheDocument();
  });

  test('explains that collection is online-only when offline', async () => {
    mockCollectPathology.mockReturnValue(rejecting({ status: 'FETCH_ERROR', error: 'Offline' }));
    const user = await openCollect();
    await user.type(screen.getByLabelText(/amount/i), '450');
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    await user.click(screen.getByRole('button', { name: /^collect payment$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/only be collected online/i);
  });

  test('when the receipt could not be generated, says so instead of offering a download', async () => {
    mockCollectPathology.mockReturnValue(unwrapping({
      paymentId: 'pay-x', amount: 450, paymentMethod: 'CASH', receiptUrl: null,
    }));
    const user = await openCollect();
    await user.type(screen.getByLabelText(/amount/i), '450');
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    await user.click(screen.getByRole('button', { name: /^collect payment$/i }));

    expect(await screen.findByText(/receipt is not available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download receipt/i })).not.toBeInTheDocument();
  });
});

// ─── Delete protection ────────────────────────────────────────────────────────

describe('Lab payment — paid requests cannot be deleted', () => {
  test('HOSPITAL_ADMIN sees no Delete button on a paid request, but does on an unpaid one', async () => {
    const user = userEvent.setup();
    mockRole = 'HOSPITAL_ADMIN';
    render(<LabPage />);

    await user.click(within(rowFor('Lipid Profile')).getByRole('button', { name: 'View' }));
    expect(screen.queryByRole('button', { name: /delete request/i })).not.toBeInTheDocument();
  });

  test('shows the backend 409 message if the request was paid meanwhile', async () => {
    const user = userEvent.setup();
    mockRole = 'HOSPITAL_ADMIN';
    mockDeletePathology.mockReturnValue(rejecting({ status: 409, data: { message: 'Cannot delete a paid pathology request.' } }));
    render(<LabPage />);

    await user.click(within(rowFor('Complete Blood Count')).getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('button', { name: /delete request/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(await screen.findByText('This request has been paid and cannot be deleted.')).toBeInTheDocument();
  });
});
