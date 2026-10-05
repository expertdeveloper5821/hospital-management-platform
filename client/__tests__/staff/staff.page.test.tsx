import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReplace   = jest.fn();
const mockListUsers = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: (...args: unknown[]) => mockListUsers(...args),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: 'me' } } }),
}));

import StaffPage from '@/app/(dashboard)/staff/page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUsers(n: number, from = 1) {
  return Array.from({ length: n }, (_, i) => ({
    userId: `u${from + i}`, tenantId: 't1', email: `staff${from + i}@h.com`, name: `Staff ${from + i}`,
    phone: null, role: 'NURSE', departmentIds: [], profileImageUrl: null,
    isActive: true, isFirstLogin: false, createdAt: '', updatedAt: '',
  }));
}

// Serves a 45-member directory, 20 per page — mirrors GET /api/users.
function serveDirectory(total = 45) {
  mockListUsers.mockImplementation((args: { page: number; limit: number }) => {
    const start = (args.page - 1) * args.limit;
    const count = Math.max(0, Math.min(args.limit, total - start));
    return {
      data: { data: makeUsers(count, start + 1), total, page: args.page, limit: args.limit, totalPages: Math.ceil(total / args.limit) },
      isLoading: false, isFetching: false, isError: false,
    };
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StaffPage — server-side pagination', () => {
  beforeEach(() => {
    mockRole = 'HOSPITAL_ADMIN';
    jest.clearAllMocks();
    serveDirectory();
  });

  test('requests page 1 with the page size and shows the range, count and page indicator', () => {
    render(<StaffPage />);

    expect(mockListUsers).toHaveBeenLastCalledWith({ page: 1, limit: 20 }, { skip: false });
    expect(screen.getByText('Showing 1–20 of 45 staff members')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  test('Next/Previous move between pages; the last page shows the remainder with Next disabled', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 21–40 of 45 staff members')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(mockListUsers).toHaveBeenLastCalledWith({ page: 3, limit: 20 }, { skip: false });
    expect(screen.getByText('Showing 41–45 of 45 staff members')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getAllByText(/^Staff \d+$/)).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  test('search is debounced, trimmed, sent server-side and resets to page 1', async () => {
    const user = userEvent.setup();
    render(<StaffPage />);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByPlaceholderText(/Search by name/), '  nurse ');

    await waitFor(() =>
      expect(mockListUsers).toHaveBeenLastCalledWith({ search: 'nurse', page: 1, limit: 20 }, { skip: false }),
    );
    // Never one request per keystroke with a partial term.
    expect(mockListUsers).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'n' }), expect.anything());
  });

  test('empty result shows the empty state and no pager', () => {
    serveDirectory(0);
    render(<StaffPage />);

    expect(screen.getByText('No staff members found.')).toBeInTheDocument();
    expect(screen.getByText('No staff members')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('single page hides the pager but keeps the count', () => {
    serveDirectory(3);
    render(<StaffPage />);

    expect(screen.getByText('Showing 1–3 of 3 staff members')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('steps back to the new last page when the current page empties out', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<StaffPage />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    serveDirectory(40); // page 3 no longer exists
    rerender(<StaffPage />);

    await waitFor(() =>
      expect(mockListUsers).toHaveBeenLastCalledWith({ page: 2, limit: 20 }, { skip: false }),
    );
    expect(screen.getByText('Showing 21–40 of 40 staff members')).toBeInTheDocument();
  });
});

describe('StaffPage — role gating (unchanged)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serveDirectory();
  });

  test('a disallowed role is redirected and never fetches the directory', async () => {
    mockRole = 'DOCTOR';
    const { container } = render(<StaffPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/dashboard'));
    expect(mockListUsers).toHaveBeenLastCalledWith(expect.anything(), { skip: true });
    expect(container).toBeEmptyDOMElement();
  });

  test('ID Card button only for HOSPITAL_ADMIN / HR', () => {
    mockRole = 'MANAGER';
    render(<StaffPage />);
    expect(screen.queryAllByRole('button', { name: 'ID Card' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Documents' })).toHaveLength(20);
  });
});
