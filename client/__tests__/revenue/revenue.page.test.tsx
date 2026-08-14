import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseGetDepartmentRevenueQuery = jest.fn();

jest.mock('@/store/api/payment.api', () => ({
  useGetDepartmentRevenueQuery: (...args: unknown[]) => mockUseGetDepartmentRevenueQuery(...args),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
}));

import RevenuePage from '@/app/(dashboard)/revenue/page';

function setQueryResult(data: unknown, opts: { isFetching?: boolean; isError?: boolean } = {}) {
  mockUseGetDepartmentRevenueQuery.mockReturnValue({
    data,
    isFetching: opts.isFetching ?? false,
    isError: opts.isError ?? false,
    refetch: jest.fn(),
  });
}

function lastQueryArgs() {
  return mockUseGetDepartmentRevenueQuery.mock.calls.at(-1)?.[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RevenuePage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-29T10:00:00'));
    mockUseGetDepartmentRevenueQuery.mockReset();
    setQueryResult(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('role access gating', () => {
    test.each(['MANAGER', 'FINANCE_MANAGER', 'HOSPITAL_ADMIN', 'ADMIN'])(
      '%s can access the Revenue page',
      (role) => {
        mockRole = role;
        render(<RevenuePage />);
        expect(screen.queryByText(/you do not have access to the revenue module/i)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^revenue$/i })).toBeInTheDocument();
      },
    );

    test.each(['RECEPTIONIST', 'DOCTOR', 'NURSE'])(
      '%s cannot access the Revenue page',
      (role) => {
        mockRole = role;
        render(<RevenuePage />);
        expect(screen.getByText(/you do not have access to the revenue module/i)).toBeInTheDocument();
      },
    );
  });

  describe('filters', () => {
    beforeEach(() => {
      mockRole = 'HOSPITAL_ADMIN';
    });

    test('defaults to This Month: 1st of the current month through today', () => {
      render(<RevenuePage />);
      expect(lastQueryArgs()).toEqual({ dateFrom: '2026-07-01', dateTo: '2026-07-29' });
    });

    test('Today filter sends today for both dateFrom and dateTo', () => {
      render(<RevenuePage />);
      fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'TODAY' } });
      expect(lastQueryArgs()).toEqual({ dateFrom: '2026-07-29', dateTo: '2026-07-29' });
    });

    test('Daily filter uses the selected date for both dateFrom and dateTo', () => {
      render(<RevenuePage />);
      fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'DAILY' } });
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-07-15' } });
      expect(lastQueryArgs()).toEqual({ dateFrom: '2026-07-15', dateTo: '2026-07-15' });
    });

    test('Monthly filter uses the selected month and year as a full-month range', () => {
      render(<RevenuePage />);
      fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'MONTHLY' } });
      fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2026-02' } });
      expect(lastQueryArgs()).toEqual({ dateFrom: '2026-02-01', dateTo: '2026-02-28' });
    });

    test('Custom Date Range filter uses the selected From/To dates', () => {
      render(<RevenuePage />);
      fireEvent.change(screen.getByLabelText('Filter'), { target: { value: 'CUSTOM' } });
      fireEvent.change(screen.getByLabelText('From Date'), { target: { value: '2026-06-01' } });
      fireEvent.change(screen.getByLabelText('To Date'), { target: { value: '2026-06-20' } });
      expect(lastQueryArgs()).toEqual({ dateFrom: '2026-06-01', dateTo: '2026-06-20' });
    });
  });

  describe('rendering', () => {
    beforeEach(() => {
      mockRole = 'HOSPITAL_ADMIN';
    });

    test('shows every department (including ₹0 ones) as a table row, an Other Revenue row, and the reconciled total', () => {
      setQueryResult({
        departments: [
          { departmentId: 'd1', name: 'Cardiology', opdRevenue: 3000, ipdRevenue: 2000, directPayment: 0, total: 5000 },
          { departmentId: 'd2', name: 'Neurology', opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 },
        ],
        other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 300, total: 300 },
        grandTotal: 5300,
      });
      render(<RevenuePage />);

      expect(screen.getByRole('cell', { name: 'Cardiology' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '₹3,000.00' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '₹2,000.00' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: '₹5,000.00' })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: 'Neurology' })).toBeInTheDocument();
      expect(screen.getAllByRole('cell', { name: '₹0.00' }).length).toBeGreaterThan(0);
      expect(screen.getByRole('cell', { name: 'Other Revenue' })).toBeInTheDocument();
      // Other Revenue row shows ₹300.00 in both Direct Payment and Total Revenue cells.
      expect(screen.getAllByRole('cell', { name: '₹300.00' }).length).toBe(2);
      // "Total Revenue" appears as both the table column header and the footer summary label.
      expect(screen.getAllByText('Total Revenue').length).toBe(2);
      expect(screen.getByText('₹5,300.00')).toBeInTheDocument();
      expect(screen.queryByText(/unassigned/i)).not.toBeInTheDocument();
    });

    test('table column headers include OPD, IPD, Direct Payment, and Total Revenue', () => {
      setQueryResult({
        departments: [
          { departmentId: 'd1', name: 'Cardiology', opdRevenue: 100, ipdRevenue: 0, directPayment: 0, total: 100 },
        ],
        other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 },
        grandTotal: 100,
      });
      render(<RevenuePage />);

      expect(screen.getByRole('columnheader', { name: 'Department' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'OPD Revenue' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'IPD Revenue' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Direct Payment' })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: 'Total Revenue' })).toBeInTheDocument();
    });

    test('Department filter narrows the table to the selected department only', () => {
      setQueryResult({
        departments: [
          { departmentId: 'd1', name: 'Cardiology', opdRevenue: 3000, ipdRevenue: 2000, directPayment: 0, total: 5000 },
          { departmentId: 'd2', name: 'Neurology', opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 },
        ],
        other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 300, total: 300 },
        grandTotal: 5300,
      });
      render(<RevenuePage />);

      fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd1' } });

      expect(screen.getByRole('cell', { name: 'Cardiology' })).toBeInTheDocument();
      expect(screen.queryByRole('cell', { name: 'Neurology' })).not.toBeInTheDocument();
      expect(screen.queryByRole('cell', { name: 'Other Revenue' })).not.toBeInTheDocument();
      // Grand total keeps reflecting the full, unfiltered revenue.
      expect(screen.getByText('₹5,300.00')).toBeInTheDocument();
    });

    test('shows a loading state while fetching', () => {
      setQueryResult(undefined, { isFetching: true });
      render(<RevenuePage />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });

    test('shows an error state when the query fails', () => {
      setQueryResult(undefined, { isError: true });
      render(<RevenuePage />);
      expect(screen.getByText(/failed to load revenue data/i)).toBeInTheDocument();
    });

    test('shows an empty state when there are no departments and no other revenue', () => {
      setQueryResult({ departments: [], other: { opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 }, grandTotal: 0 });
      render(<RevenuePage />);
      expect(screen.getByText(/no departments have been created yet/i)).toBeInTheDocument();
    });
  });
});
