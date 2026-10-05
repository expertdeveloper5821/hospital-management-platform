import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/link', () => {
  return ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  );
});

type ListArgs = { status?: string; search?: string; page: number; limit: number };

let mockResponse: { data: unknown[]; total: number; page: number; limit: number; totalPages: number } | undefined;
const mockUseListPackagesQuery = jest.fn((_args: ListArgs) => ({
  data: mockResponse, isLoading: false, isFetching: false, isError: false,
}));

jest.mock('@/store/api/packages.api', () => ({
  useListPackagesQuery: (args: ListArgs) => mockUseListPackagesQuery(args),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'HOSPITAL_ADMIN' } } }),
  useAppDispatch: () => jest.fn(),
}));

import PackagesPage from '@/app/(dashboard)/packages/page';

function pkgs(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    packageId: `PKG-${offset + i}`, name: `Package ${offset + i}`, price: 100,
    includedServices: ['x'], status: 'ACTIVE', wardId: null, wardName: null,
  }));
}

const lastArgs = () => mockUseListPackagesQuery.mock.calls[mockUseListPackagesQuery.mock.calls.length - 1][0];

beforeEach(() => {
  mockUseListPackagesQuery.mockClear();
  mockResponse = { data: pkgs(20), total: 45, page: 1, limit: 20, totalPages: 3 };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PackagesPage — server-side pagination', () => {
  test('requests page 1 with the page size and shows range, page and total', () => {
    render(<PackagesPage />);
    expect(lastArgs()).toMatchObject({ page: 1, limit: 20 });
    expect(screen.getByText('Showing 1–20 of 45 packages')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('Next requests the next page; the last page shows a partial range and disables Next', () => {
    const { rerender } = render(<PackagesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: pkgs(5, 40), total: 45, page: 3, limit: 20, totalPages: 3 };
    rerender(<PackagesPage />);
    expect(lastArgs()).toMatchObject({ page: 3 });
    expect(screen.getByText('Showing 41–45 of 45 packages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  test('changing the status filter resets to page 1', () => {
    render(<PackagesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'INACTIVE' }));
    expect(lastArgs()).toMatchObject({ status: 'INACTIVE', page: 1 });
  });

  test('search is debounced, sent to the server, and resets to page 1', () => {
    jest.useFakeTimers();
    try {
      render(<PackagesPage />);
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      fireEvent.change(screen.getByPlaceholderText(/search packages/i), { target: { value: '  cardiac ' } });
      expect(lastArgs().search).toBeUndefined();
      act(() => { jest.advanceTimersByTime(300); });
      expect(lastArgs()).toMatchObject({ search: 'cardiac', page: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  test('hides the pager on a single page but still shows the count', () => {
    mockResponse = { data: pkgs(3), total: 3, page: 1, limit: 20, totalPages: 1 };
    render(<PackagesPage />);
    expect(screen.getByText('Showing 1–3 of 3 packages')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('empty search result shows a search-specific empty state and no count', () => {
    jest.useFakeTimers();
    try {
      render(<PackagesPage />);
      mockResponse = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      fireEvent.change(screen.getByPlaceholderText(/search packages/i), { target: { value: 'zzz' } });
      act(() => { jest.advanceTimersByTime(300); });
      expect(screen.getByText('No packages match your search.')).toBeInTheDocument();
      expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  test('a page past the end (shrunken result set) snaps back to the last page', () => {
    const { rerender } = render(<PackagesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(lastArgs()).toMatchObject({ page: 3 });

    // Server now reports only 2 pages, so page 3 came back empty.
    mockResponse = { data: [], total: 40, page: 3, limit: 20, totalPages: 2 };
    rerender(<PackagesPage />);
    expect(lastArgs()).toMatchObject({ page: 2 });
  });

  test('offline single-page response (page 1 / totalPages 1) snaps back to page 1 and counts every row', () => {
    const { rerender } = render(<PackagesPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    mockResponse = { data: pkgs(7), total: 7, page: 1, limit: 7, totalPages: 1 };
    rerender(<PackagesPage />);
    expect(lastArgs()).toMatchObject({ page: 1 });
    expect(screen.getByText('Showing 1–7 of 7 packages')).toBeInTheDocument();
  });
});
