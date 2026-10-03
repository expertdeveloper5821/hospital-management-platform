import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

type ListArgs = { search?: string; page: number; limit: number };

let mockResponse: { data: unknown[]; total: number; page: number; limit: number; totalPages: number } | undefined;
let mockIsFetching = false;
const mockUseListWardsPaginatedQuery = jest.fn((_args: ListArgs) => ({
  data: mockResponse, isLoading: false, isFetching: mockIsFetching, isError: false,
}));

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsPaginatedQuery:    (args: ListArgs) => mockUseListWardsPaginatedQuery(args),
  useCreateWardMutation:         () => [jest.fn(), { isLoading: false }],
  useListBedsQuery:              () => ({ data: [], isLoading: false }),
  useAddBedsMutation:            () => [jest.fn(), { isLoading: false }],
  useAssignNursesToWardMutation: () => [jest.fn(), { isLoading: false }],
  useGetOccupancySummaryQuery:   () => ({ data: [] }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'HOSPITAL_ADMIN' } } }),
  useAppDispatch: () => jest.fn(),
}));

import WardsPage from '@/app/(dashboard)/wards/page';

function wards(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    wardId: `W-${offset + i}`, name: `Ward ${offset + i}`, floor: null,
    assignedNurseIds: [], tenantId: 't1', createdAt: '2026-01-01T00:00:00.000Z',
  }));
}

const lastArgs = () =>
  mockUseListWardsPaginatedQuery.mock.calls[mockUseListWardsPaginatedQuery.mock.calls.length - 1][0];

beforeEach(() => {
  mockUseListWardsPaginatedQuery.mockClear();
  mockIsFetching = false;
  mockResponse = { data: wards(20), total: 45, page: 1, limit: 20, totalPages: 3 };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WardsPage — server-side pagination', () => {
  test('requests page 1 with the page size and shows range, page and total', () => {
    render(<WardsPage />);
    expect(lastArgs()).toMatchObject({ page: 1, limit: 20 });
    expect(screen.getByText('Showing 1–20 of 45 wards')).toBeInTheDocument();
    expect(screen.getByText('45 wards')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('Next requests the next page; the last page shows a partial range and disables Next', () => {
    const { rerender } = render(<WardsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: wards(5, 40), total: 45, page: 3, limit: 20, totalPages: 3 };
    rerender(<WardsPage />);
    expect(lastArgs()).toMatchObject({ page: 3 });
    expect(screen.getByText('Showing 41–45 of 45 wards')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('Previous/Next are disabled while a page is fetching', () => {
    mockIsFetching = true;
    mockResponse = { data: wards(20, 20), total: 45, page: 2, limit: 20, totalPages: 3 };
    render(<WardsPage />);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  test('search is debounced, sent to the server, and resets to page 1', () => {
    jest.useFakeTimers();
    try {
      render(<WardsPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.change(screen.getByPlaceholderText(/search wards/i), { target: { value: '  icu ' } });
      expect(lastArgs().search).toBeUndefined();
      act(() => { jest.advanceTimersByTime(300); });
      expect(lastArgs()).toMatchObject({ search: 'icu', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('hides the pager on a single page but still shows the count', () => {
    mockResponse = { data: wards(3), total: 3, page: 1, limit: 20, totalPages: 1 };
    render(<WardsPage />);
    expect(screen.getByText('Showing 1–3 of 3 wards')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('no wards at all shows the original empty state and no count', () => {
    mockResponse = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    render(<WardsPage />);
    expect(screen.getByText('No wards created yet.')).toBeInTheDocument();
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  });

  test('empty search result shows a search-specific empty state', () => {
    jest.useFakeTimers();
    try {
      render(<WardsPage />);
      mockResponse = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      fireEvent.change(screen.getByPlaceholderText(/search wards/i), { target: { value: 'zzz' } });
      act(() => { jest.advanceTimersByTime(300); });
      expect(screen.getByText('No wards match your search.')).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a page past the end (shrunken result set) snaps back to the last page', () => {
    const { rerender } = render(<WardsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 3 });

    // Server now reports only 2 pages, so page 3 came back empty.
    mockResponse = { data: [], total: 40, page: 3, limit: 20, totalPages: 2 };
    rerender(<WardsPage />);
    expect(lastArgs()).toMatchObject({ page: 2 });
  });

  test('offline single-page response (page 1 / totalPages 1) snaps back to page 1 and counts every row', () => {
    const { rerender } = render(<WardsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: wards(7), total: 7, page: 1, limit: 7, totalPages: 1 };
    rerender(<WardsPage />);
    expect(lastArgs()).toMatchObject({ page: 1 });
    expect(screen.getByText('Showing 1–7 of 7 wards')).toBeInTheDocument();
  });
});
