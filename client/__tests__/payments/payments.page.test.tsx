import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@/store/api/payment.api', () => ({
  useListPaymentsQuery:            () => ({ data: { data: [], total: 0, totalPages: 1 }, isFetching: false, refetch: jest.fn() }),
  useCreateManualPaymentMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useVerifyRazorpayPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCancelRazorpayOrderMutation:  () => [jest.fn(), { isLoading: false }],
  useLazyGetReceiptUrlQuery:       () => [jest.fn(), { isFetching: false }],
  useGetPaymentSummaryQuery:       () => ({ data: undefined, isFetching: false }),
  useExportPaymentsMutation:       () => [mockExportPayments, { isLoading: false }],
}));

const mockExportPayments = jest.fn();

jest.mock('@/store/api/patient.api', () => ({
  useLazySearchPatientsQuery: () => [jest.fn(), { data: undefined, isFetching: false }],
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import PaymentsPage from '@/app/(dashboard)/payments/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentsPage — role access gating', () => {
  test('ADMIN can access the Payments page and sees the Record Payment action', () => {
    mockRole = 'ADMIN';
    render(<PaymentsPage />);
    expect(screen.queryByText(/you do not have access to the payments module/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /payments/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN can still access the Payments page (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<PaymentsPage />);
    expect(screen.queryByText(/you do not have access to the payments module/i)).not.toBeInTheDocument();
  });

  test('DOCTOR still has no Payments page access (unchanged)', () => {
    mockRole = 'DOCTOR';
    render(<PaymentsPage />);
    expect(screen.getByText(/you do not have access to the payments module/i)).toBeInTheDocument();
  });
});

describe('PaymentsPage — Department-wise Revenue moved to /revenue', () => {
  test('no longer renders the Department-wise Revenue section for any role', () => {
    for (const role of ['HOSPITAL_ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'ADMIN', 'RECEPTIONIST']) {
      mockRole = role;
      const { unmount } = render(<PaymentsPage />);
      expect(screen.queryByText('Department-wise Revenue')).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('PaymentsPage — Export', () => {
  beforeEach(() => {
    mockExportPayments.mockReset();
    mockExportPayments.mockReturnValue({
      unwrap: () => Promise.resolve({ url: 'blob:test', filename: 'payments-daily-2026-10-09.pdf' }),
    });
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  test.each(['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'ADMIN'])('%s sees the Export button', (role) => {
    mockRole = role;
    render(<PaymentsPage />);
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument();
  });

  test('RECEPTIONIST does not see the Export button (same gate as the summary)', () => {
    mockRole = 'RECEPTIONIST';
    render(<PaymentsPage />);
    expect(screen.queryByRole('button', { name: /^export$/i })).not.toBeInTheDocument();
    // existing create actions unchanged
    expect(screen.getByRole('button', { name: /manual payment/i })).toBeInTheDocument();
  });

  test('MANAGER sees Export but not the create actions (unchanged)', () => {
    mockRole = 'MANAGER';
    render(<PaymentsPage />);
    expect(screen.queryByRole('button', { name: /manual payment/i })).not.toBeInTheDocument();
  });

  function openExport() {
    mockRole = 'FINANCE_MANAGER';
    render(<PaymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
  }

  test('Daily exports the selected date and downloads the file', async () => {
    openExport();
    fireEvent.change(screen.getByLabelText(/^date/i), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(mockExportPayments).toHaveBeenCalledWith({ period: 'DAILY', date: '2026-10-01' }));
    await waitFor(() => expect(screen.queryByText('Export Payments')).not.toBeInTheDocument());
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    const anchor = (HTMLAnchorElement.prototype.click as jest.Mock).mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('payments-daily-2026-10-09.pdf');
  });

  test('Weekly sends the anchor date', async () => {
    openExport();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    fireEvent.change(screen.getByLabelText(/any date in the week/i), { target: { value: '2026-09-17' } });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(mockExportPayments).toHaveBeenCalledWith({ period: 'WEEKLY', date: '2026-09-17' }));
  });

  test('Monthly sends the first day of the chosen month', async () => {
    openExport();
    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    fireEvent.change(screen.getByLabelText(/^month/i), { target: { value: '2026-08' } });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(mockExportPayments).toHaveBeenCalledWith({ period: 'MONTHLY', date: '2026-08-01' }));
  });

  test('Custom requires both dates, then sends the range', async () => {
    openExport();
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(await screen.findByText(/from and to dates are required/i)).toBeInTheDocument();
    expect(mockExportPayments).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/from date \*/i), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText(/to date \*/i),   { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(mockExportPayments).toHaveBeenCalledWith({ period: 'CUSTOM', dateFrom: '2026-09-01', dateTo: '2026-09-15' }));
  });

  test('shows the server error message and keeps the dialog open', async () => {
    mockExportPayments.mockReturnValue({
      unwrap: () => Promise.reject({ data: { message: 'dateTo cannot be in the future' } }),
    });
    openExport();
    fireEvent.click(screen.getByRole('button', { name: /download pdf/i }));
    expect(await screen.findByText('dateTo cannot be in the future')).toBeInTheDocument();
    expect(screen.getByText('Export Payments')).toBeInTheDocument();
  });
});
