import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetDashboardStats = jest.fn();

jest.mock('@/store/api/dashboard.api', () => ({
  useGetDashboardStatsQuery: (...args: unknown[]) => mockGetDashboardStats(...args),
}));

const mockDispatch = jest.fn();

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      auth: {
        profile:  { role: 'HOSPITAL_ADMIN' },
        branding: { displayName: 'Test Hospital' },
      },
    }),
  useAppDispatch: () => mockDispatch,
}));

// Import after mocks — page uses the real `logout` action creator so we can
// assert dispatch was called with the exact action object it produces.
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import { logout } from '@/store/slices/auth.slice';

function baseQueryResult(overrides: Record<string, unknown>) {
  return {
    data:       undefined,
    isLoading:  false,
    isFetching: false,
    isError:    true,
    refetch:    jest.fn(),
    ...overrides,
  };
}

function lastCallOptions() {
  const calls = mockGetDashboardStats.mock.calls;
  return calls[calls.length - 1][1] as { skip?: boolean; pollingInterval?: number };
}

describe('DashboardPage — dashboard stats error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('tenant inactive (401 + "Tenant account is inactive") shows banner and disables polling', async () => {
    mockGetDashboardStats.mockReturnValue(
      baseQueryResult({ error: { status: 401, data: { message: 'Tenant account is inactive' } } }),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Tenant account is inactive')).toBeInTheDocument();
    });

    // Query must stop being refetched/polled once the tenant is confirmed inactive.
    await waitFor(() => {
      expect(lastCallOptions().skip).toBe(true);
    });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('authentication required (401 + "Authentication required") triggers logout, not the inactive banner', async () => {
    mockGetDashboardStats.mockReturnValue(
      baseQueryResult({ error: { status: 401, data: { message: 'Authentication required' } } }),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockDispatch).toHaveBeenCalledWith(logout());
    });

    // The query itself must remain enabled so it can recover after re-auth.
    expect(lastCallOptions().skip).toBe(false);
    expect(screen.queryByText('Tenant account is inactive')).not.toBeInTheDocument();
  });

  test('insufficient permissions (403) shows a permissions message without disabling the query', async () => {
    mockGetDashboardStats.mockReturnValue(
      baseQueryResult({ error: { status: 403, data: { message: 'Insufficient permissions' } } }),
    );

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/Insufficient permissions/)).toBeInTheDocument();
    });

    expect(lastCallOptions().skip).toBe(false);
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
