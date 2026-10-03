import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

type ListArgs = {
  patientId?: string; category?: string; startDate?: string; endDate?: string;
  addedByName?: string; page: number; limit: number;
};

let mockResponse: { data: unknown[]; total: number; page: number; limit: number; totalPages: number } | undefined;
const mockUseListChargesQuery = jest.fn((_args: ListArgs) => ({
  data: mockResponse, isLoading: false, isFetching: false, isError: false,
}));

jest.mock('@/store/api/charges.api', () => ({
  useListChargesQuery:       (args: ListArgs) => mockUseListChargesQuery(args),
  useAddChargeMutation:      () => [jest.fn(), { isLoading: false }],
  useCancelChargeMutation:   () => [jest.fn(), { isLoading: false }],
  useMarkChargePaidMutation: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/lab.api', () => ({
  useListLabTestTypesQuery: () => ({ data: [], isLoading: false }),
}));

let mockRole = 'HOSPITAL_ADMIN';
jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import BillingPage from '@/app/(dashboard)/billing/page';

function charges(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    chargeId: `CHG-${offset + i}`, patientId: 'PAT-1', category: 'CONSULTATION',
    description: `Charge ${offset + i}`, amount: 100, status: 'UNPAID',
    addedBy: 'u1', addedByName: 'Staff', createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

const lastArgs = () => mockUseListChargesQuery.mock.calls[mockUseListChargesQuery.mock.calls.length - 1][0];

beforeEach(() => {
  mockRole = 'HOSPITAL_ADMIN';
  mockUseListChargesQuery.mockClear();
  mockResponse = { data: charges(20), total: 45, page: 1, limit: 20, totalPages: 3 };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('BillingPage — server-side pagination', () => {
  test('requests page 1 with the page size and shows range, page and total', () => {
    render(<BillingPage />);
    expect(lastArgs()).toMatchObject({ page: 1, limit: 20 });
    expect(screen.getByText('Showing 1–20 of 45 charges')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('Next requests the next page; the last page shows a partial range and disables Next', () => {
    const { rerender } = render(<BillingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: charges(5, 40), total: 45, page: 3, limit: 20, totalPages: 3 };
    rerender(<BillingPage />);
    expect(lastArgs()).toMatchObject({ page: 3 });
    expect(screen.getByText('Showing 41–45 of 45 charges')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('changing the category filter resets to page 1', () => {
    render(<BillingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByDisplayValue('All Categories'), { target: { value: 'LAB_TEST' } });
    expect(lastArgs()).toMatchObject({ category: 'LAB_TEST', page: 1 });
  });

  test('UHID and Added By are debounced independently, trimmed, and reset to page 1', () => {
    jest.useFakeTimers();
    try {
      render(<BillingPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.change(screen.getByPlaceholderText('PAT-XXXXXXXX'), { target: { value: ' PAT-1 ' } });
      // Editing the other field inside the window must not drop the UHID update.
      fireEvent.change(screen.getByPlaceholderText('Staff name'), { target: { value: 'ann' } });
      expect(lastArgs().patientId).toBeUndefined();
      act(() => { jest.advanceTimersByTime(300); });
      expect(lastArgs()).toMatchObject({ patientId: 'PAT-1', addedByName: 'ann', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('hides the pager on a single page but still shows the count', () => {
    mockResponse = { data: charges(1), total: 1, page: 1, limit: 20, totalPages: 1 };
    render(<BillingPage />);
    expect(screen.getByText('Showing 1–1 of 1 charge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('empty results distinguish "no charges" from "no matches"', () => {
    mockResponse = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    render(<BillingPage />);
    expect(screen.getByText('No charges found.')).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('All Categories'), { target: { value: 'ROOM' } });
    expect(screen.getByText('No charges match your filters.')).toBeInTheDocument();
  });

  test('a page past the end (shrunken result set) snaps back to the last page', () => {
    const { rerender } = render(<BillingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 3 });

    // Server now reports only 2 pages, so page 3 came back empty.
    mockResponse = { data: [], total: 40, page: 3, limit: 20, totalPages: 2 };
    rerender(<BillingPage />);
    expect(lastArgs()).toMatchObject({ page: 2 });
  });

  test('offline single-page response (page 1 / totalPages 1) snaps back to page 1 and counts every row', () => {
    const { rerender } = render(<BillingPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: charges(7), total: 7, page: 1, limit: 7, totalPages: 1 };
    rerender(<BillingPage />);
    expect(lastArgs()).toMatchObject({ page: 1 });
    expect(screen.getByText('Showing 1–7 of 7 charges')).toBeInTheDocument();
  });

  test('MANAGER can page through charges but gets no Mark Paid / Cancel actions', () => {
    mockRole = 'MANAGER';
    render(<BillingPage />);
    expect(screen.getByText('Showing 1–20 of 45 charges')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).not.toBeInTheDocument();
  });
});
