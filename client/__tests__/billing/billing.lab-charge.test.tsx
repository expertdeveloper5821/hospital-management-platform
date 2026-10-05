import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Billing → LAB_TEST charges: free (₹0) tests, the linked Lab request note,
// and the receipt download for a paid charge.

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

let mockCharges: unknown[] = [];
const mockAddCharge      = jest.fn();
const mockReceiptTrigger = jest.fn();

jest.mock('@/store/api/charges.api', () => ({
  useListChargesQuery: () => ({
    data: { data: mockCharges, total: mockCharges.length, page: 1, limit: 20, totalPages: 1 },
    isLoading: false, isFetching: false, isError: false,
  }),
  useAddChargeMutation:      () => [mockAddCharge, { isLoading: false }],
  useCancelChargeMutation:   () => [jest.fn(), { isLoading: false }],
  useMarkChargePaidMutation: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/lab.api', () => ({
  useListLabTestTypesQuery: () => ({
    data: [{ id: 'PATHOLOGY:Blood Sugar', name: 'Blood Sugar', category: 'PATHOLOGY' }],
    isLoading: false,
  }),
}));

jest.mock('@/store/api/payment.api', () => ({
  useLazyGetReceiptUrlQuery: () => [mockReceiptTrigger, { isFetching: false }],
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'RECEPTIONIST' } } }),
  useAppDispatch: () => jest.fn(),
}));

import BillingPage from '@/app/(dashboard)/billing/page';

const BASE_CHARGE = {
  patientId: 'PAT-1', category: 'LAB_TEST', amount: 300, addedBy: 'u1', addedByName: 'Staff',
  testTypeId: 'PATHOLOGY:Blood Sugar', testTypeName: 'Blood Sugar',
  labRequestId: 'req-1', labRequestKind: 'PATHOLOGY', createdAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCharges = [];
  mockAddCharge.mockReturnValue({ unwrap: () => Promise.resolve({}) });
});

async function fillAddCharge(category: string, amount: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /add charge/i }));
  await user.type(screen.getByLabelText('UHID'), 'PAT-1');
  await user.selectOptions(screen.getByLabelText('Category'), category);
  if (category === 'LAB_TEST') {
    await user.selectOptions(screen.getByLabelText('Test Type'), 'PATHOLOGY:Blood Sugar');
  }
  await user.type(screen.getByLabelText('Amount (₹)'), amount);
  await user.type(screen.getByLabelText('Description'), 'Test charge');
  const dialog = screen.getByRole('heading', { name: 'Add Charge' }).parentElement!.parentElement!;
  await user.click(within(dialog).getByRole('button', { name: 'Add Charge' }));
}

describe('Billing — Lab Test charges', () => {
  test('a free (₹0) Lab Test charge can be added', async () => {
    render(<BillingPage />);
    await fillAddCharge('LAB_TEST', '0');
    expect(mockAddCharge).toHaveBeenCalledWith(expect.objectContaining({
      category: 'LAB_TEST', amount: 0, testTypeId: 'PATHOLOGY:Blood Sugar', testTypeName: 'Blood Sugar',
    }));
  });

  test('₹0 is still rejected for other categories', async () => {
    render(<BillingPage />);
    await fillAddCharge('CONSULTATION', '0');
    expect(mockAddCharge).not.toHaveBeenCalled();
    // The input's native min (0.01 outside Lab Test) blocks submission.
    expect((screen.getByLabelText('Amount (₹)') as HTMLInputElement).validity.rangeUnderflow).toBe(true);
  });

  test('the Lab Test amount input allows ₹0', async () => {
    const user = userEvent.setup();
    render(<BillingPage />);
    await user.click(screen.getByRole('button', { name: /add charge/i }));
    await user.selectOptions(screen.getByLabelText('Category'), 'LAB_TEST');
    expect(screen.getByLabelText('Amount (₹)')).toHaveAttribute('min', '0');
  });

  test('a Lab Test charge shows that its request was sent to Lab', () => {
    mockCharges = [{ ...BASE_CHARGE, chargeId: 'CHG-1', description: 'CBC', status: 'UNPAID' }];
    render(<BillingPage />);
    expect(screen.getByText('Pathology request sent to Lab · Blood Sugar')).toBeInTheDocument();
  });

  test('a paid charge offers its receipt; unpaid charges do not', async () => {
    mockCharges = [
      { ...BASE_CHARGE, chargeId: 'CHG-PAID', description: 'Paid test', status: 'PAID', paymentId: 'pay-1', receiptAvailable: true },
      { ...BASE_CHARGE, chargeId: 'CHG-UNPAID', description: 'Unpaid test', status: 'UNPAID', paymentId: null, receiptAvailable: false },
    ];
    mockReceiptTrigger.mockReturnValue({ unwrap: () => Promise.resolve('https://s3.test/receipt.pdf') });
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    const user = userEvent.setup();
    render(<BillingPage />);

    const receipts = screen.getAllByRole('button', { name: 'Receipt' });
    expect(receipts).toHaveLength(1);
    await user.click(receipts[0]);
    expect(mockReceiptTrigger).toHaveBeenCalledWith('pay-1');
    expect(open).toHaveBeenCalledWith('https://s3.test/receipt.pdf', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
