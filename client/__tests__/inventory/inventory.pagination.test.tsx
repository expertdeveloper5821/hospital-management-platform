import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type ListArgs = { category?: string; search?: string; lowStock?: boolean; page: number; limit: number };
type ListResult = { data: unknown[]; total: number; page: number; limit: number; totalPages: number };

// The 1-row lowStock query backs the banner count; every other call is the table.
const isCountQuery = (a: ListArgs) => a.lowStock === true && a.limit === 1;

let mockMain: ListResult | undefined;
let mockLowStockTotal = 0;
const mockUseList = jest.fn((args: ListArgs, _opts?: { skip?: boolean }) => ({
  data: isCountQuery(args)
    ? { data: [], total: mockLowStockTotal, page: 1, limit: 1, totalPages: mockLowStockTotal }
    : mockMain,
  isFetching: false,
  refetch:    jest.fn(),
}));

jest.mock('@/store/api/inventory.api', () => ({
  useListInventoryItemsQuery:     (args: ListArgs, opts?: { skip?: boolean }) => mockUseList(args, opts),
  useCreateInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateStockMutation:         () => [jest.fn(), { isLoading: false }],
  useUpdateThresholdMutation:     () => [jest.fn(), { isLoading: false }],
  useUpdateInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useDeleteInventoryItemMutation: () => [jest.fn(), { isLoading: false }],
  useGetStockHistoryQuery:        () => ({ data: undefined, isFetching: false }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'HOSPITAL_ADMIN' } } }),
  useAppDispatch: () => jest.fn(),
}));

import InventoryPage from '@/app/(dashboard)/inventory/page';

function items(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    itemId: `I-${offset + i}`, tenantId: 't', name: `Item ${offset + i}`, category: 'PPE', unit: 'pcs',
    quantity: 50, lowStockThreshold: 10, description: null, isLowStock: false,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
}

function lastTableArgs(): ListArgs {
  const calls = mockUseList.mock.calls.filter(([a]) => !isCountQuery(a));
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  mockUseList.mockClear();
  mockMain = { data: items(10), total: 25, page: 1, limit: 10, totalPages: 3 };
  mockLowStockTotal = 0;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('InventoryPage — server-side pagination', () => {
  test('shows range, page/total pages and Previous/Next', () => {
    render(<InventoryPage />);
    expect(lastTableArgs()).toMatchObject({ page: 1, limit: 10 });
    expect(screen.getByText('Showing 1–10 of 25 items')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  test('Next requests the next page; the last page shows a partial range and disables Next', () => {
    const { rerender } = render(<InventoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(lastTableArgs()).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    mockMain = { data: items(5, 20), total: 25, page: 3, limit: 10, totalPages: 3 };
    rerender(<InventoryPage />);
    expect(lastTableArgs()).toMatchObject({ page: 3 });
    expect(screen.getByText('Showing 21–25 of 25 items')).toBeInTheDocument();
    const serials = within(screen.getByRole('table')).getAllByRole('row').slice(1)
      .map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(serials).toEqual(['21', '22', '23', '24', '25']);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  test('search is debounced, sent to the server, and resets to page 1', () => {
    jest.useFakeTimers();
    try {
      render(<InventoryPage />);
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: ' gloves ' } });
      expect(lastTableArgs().search).toBeUndefined();
      act(() => { jest.advanceTimersByTime(300); });
      expect(lastTableArgs()).toMatchObject({ search: 'gloves', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('low-stock toggle resets to page 1 and is sent to the server', () => {
    render(<InventoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByLabelText(/low stock only/i));
    expect(lastTableArgs()).toMatchObject({ lowStock: true, page: 1 });
  });

  test('low-stock banner counts across all pages, not just the visible one', () => {
    mockLowStockTotal = 7; // none of the 10 visible rows is low stock
    render(<InventoryPage />);
    // Scoped to the banner's <strong> — the S. No. column also renders a "7".
    expect(screen.getByText('7', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/below the minimum stock threshold/i)).toBeInTheDocument();
  });

  test('empty search result shows a search-specific empty state and no count', () => {
    jest.useFakeTimers();
    try {
      render(<InventoryPage />);
      mockMain = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
      fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
      act(() => { jest.advanceTimersByTime(300); });
      expect(screen.getByText('No inventory items match your search.')).toBeInTheDocument();
      expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a page past the end (e.g. after deleting the last item) snaps back to the last page', () => {
    const { rerender } = render(<InventoryPage />);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    mockMain = { data: [], total: 20, page: 3, limit: 10, totalPages: 2 };
    rerender(<InventoryPage />);
    expect(lastTableArgs()).toMatchObject({ page: 2 });
  });
});
