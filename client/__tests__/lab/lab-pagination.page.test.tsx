import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

const mockUsePathology = jest.fn();
const mockUseRadiology = jest.fn();

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery: (...args: unknown[]) => mockUsePathology(...args),
  useListRadiologyRequestsQuery: (...args: unknown[]) => mockUseRadiology(...args),
  useCreatePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
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

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'HOSPITAL_ADMIN', userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeRows = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => ({
  requestId: `req-${offset + i}`, patientId: `PAT-${offset + i}`, fullName: `Patient ${offset + i}`,
  tenantId: 't1', requestedBy: 'u1', requestedByName: 'Front Desk',
  testType: 'CBC', imagingType: 'X-Ray', referredBy: 'SELF', referredByName: 'Self',
  status: 'PENDING', priority: 'NORMAL', notes: null, reportUrl: null,
  requestedAt: '2026-05-19T10:00:00.000Z', updatedAt: '2026-05-19T10:00:00.000Z', payment: null,
}));

type ListArgs = { page: number; limit: number; search?: string; status?: string };

// Serves whichever page was requested out of `total` rows — mirrors the
// backend's paginated envelope.
const paged = (total: number) => (args: ListArgs) => {
  const start = (args.page - 1) * args.limit;
  return {
    data: {
      data: makeRows(Math.max(0, Math.min(args.limit, total - start)), start),
      total, page: args.page, limit: args.limit, totalPages: Math.ceil(total / args.limit),
    },
    isFetching: false, refetch: jest.fn(),
  };
};

const EMPTY = { data: undefined, isFetching: false, refetch: jest.fn() };

beforeEach(() => {
  mockUsePathology.mockReset();
  mockUseRadiology.mockReset();
  mockUsePathology.mockReturnValue(EMPTY);
  mockUseRadiology.mockReturnValue(EMPTY);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LabPage — server-side pagination', () => {
  test('first page shows the range, page indicator and a disabled Previous', () => {
    mockUsePathology.mockImplementation(paged(25));
    render(<LabPage />);

    expect(mockUsePathology).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 10 }), { skip: false },
    );
    expect(screen.getByText('Showing 1–10 of 25 requests')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('Next/Previous request the adjacent page; last page disables Next', () => {
    mockUsePathology.mockImplementation(paged(25));
    render(<LabPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(mockUsePathology).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), { skip: false });
    expect(screen.getByText('Showing 11–20 of 25 requests')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 21–25 of 25 requests')).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(mockUsePathology).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), { skip: false });
  });

  test('search and status filter are sent to the server and reset to page 1', () => {
    mockUsePathology.mockImplementation(paged(25));
    render(<LabPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByPlaceholderText(/patient name or uhid/i), { target: { value: 'ravi' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/patient name or uhid/i), { key: 'Enter' });
    expect(mockUsePathology).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'ravi', page: 1 }), { skip: false },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByDisplayValue('All Status'), { target: { value: 'COMPLETED' } });
    expect(mockUsePathology).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'ravi', status: 'COMPLETED', page: 1 }), { skip: false },
    );
  });

  test('steps back to the new last page when the result set shrinks', async () => {
    let total = 11;
    mockUsePathology.mockImplementation((args: ListArgs) => paged(total)(args));
    const { rerender } = render(<LabPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Showing 11–11 of 11 requests')).toBeInTheDocument();

    // The only request on page 2 is deleted.
    total = 10;
    rerender(<LabPage />);

    await waitFor(() =>
      expect(mockUsePathology).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }), { skip: false }),
    );
    expect(screen.getByText('Showing 1–10 of 10 requests')).toBeInTheDocument();
  });

  test('offline-cache fallback (all cached matches on one page) reads 1–N of N with no pager', () => {
    mockUsePathology.mockReturnValue({
      data: { data: makeRows(14), total: 14, page: 1, limit: 14, totalPages: 1 },
      isFetching: false, refetch: jest.fn(),
    });
    render(<LabPage />);

    expect(screen.getByText('Showing 1–14 of 14 requests')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  test('empty result shows "No requests" and no pager', () => {
    mockUsePathology.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 10, totalPages: 0 },
      isFetching: false, refetch: jest.fn(),
    });
    render(<LabPage />);

    expect(screen.getByText('No requests')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
  });

  test('Radiology tab paginates its own list independently', () => {
    mockUsePathology.mockImplementation(paged(25));
    mockUseRadiology.mockImplementation(paged(12));
    render(<LabPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /radiology/i }));

    // Switching tabs starts the other list from page 1.
    expect(mockUseRadiology).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 10 }), { skip: false });
    expect(screen.getByText('Showing 1–10 of 12 requests')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });
});
