import React from 'react';
import { render, screen } from '@testing-library/react';
import type { DashboardStats } from '@/store/api/dashboard.api';

// Recharts uses ResizeObserver which is not available in jsdom.
global.ResizeObserver = class ResizeObserver {
  observe()    { /* noop */ }
  unobserve()  { /* noop */ }
  disconnect() { /* noop */ }
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetDashboardStats = jest.fn();

jest.mock('@/store/api/dashboard.api', () => ({
  useGetDashboardStatsQuery: (...args: unknown[]) => mockGetDashboardStats(...args),
}));

jest.mock('@/store/api/user.api', () => ({
  useGetMyProfileQuery: () => ({ data: { name: 'Test User' } }),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({
      auth: {
        profile:  { role: mockRole },
        branding: { displayName: 'Test Hospital' },
      },
    }),
  useAppDispatch: () => jest.fn(),
}));

import DashboardPage from '@/app/(dashboard)/dashboard/page';

function mockStats(data: DashboardStats) {
  mockGetDashboardStats.mockReturnValue({
    data,
    isLoading:  false,
    isFetching: false,
    isError:    false,
    error:      undefined,
    refetch:    jest.fn(),
  });
}

const NOW = '2026-07-23T10:00:00.000Z';

describe('DashboardPage — Admissions Today removed for every role', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('HOSPITAL_ADMIN: "Admissions Today" is not rendered even though every other stat card is', () => {
    mockRole = 'HOSPITAL_ADMIN';
    mockStats({
      lastUpdated: NOW,
      totalPatients: 120,
      todayOpdCount: 15,
      activeIpdCount: 8,
      newRegistrationsToday: 4,
      pendingLabCount: 6,
      labReportsToday: 3,
      revenueToday: 5000,
      revenueThisMonth: 120000,
      averageDailyRevenue: 4000,
      pendingPaymentsCount: 2,
      lowStockCount: 1,
      outOfStockCount: 0,
      totalInventoryItems: 50,
      totalActiveStaff: 25,
      totalBeds: 40,
      occupiedBeds: 8,
      monthlyOpdTrend: [{ date: '2026-06-24', count: 2 }],
      monthlyRevenueTrend: [{ date: '2026-06-24', amount: 500 }],
      recentActivities: [],
    });

    render(<DashboardPage />);

    expect(screen.queryByText('Admissions Today')).not.toBeInTheDocument();
    // Sanity check: the rest of the Hospital Overview metric cards (formerly
    // the standalone Key Stats Strip) still render normally.
    expect(screen.getByText('Total Patients')).toBeInTheDocument();
    expect(screen.getByText('Lab Reports Today')).toBeInTheDocument();
    expect(screen.getAllByText('New Registrations').length).toBeGreaterThan(0);
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument(); // Today's Activity row
  });

  test('MANAGER: "Admissions Today" is not rendered', () => {
    mockRole = 'MANAGER';
    mockStats({
      lastUpdated: NOW,
      totalPatients: 60,
      todayOpdCount: 9,
      activeIpdCount: 3,
      newRegistrationsToday: 2,
      recentActivities: [],
    });

    render(<DashboardPage />);
    expect(screen.queryByText('Admissions Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
  });

  test('NURSE: "Admissions Today" is not rendered', () => {
    mockRole = 'NURSE';
    mockStats({
      lastUpdated: NOW,
      totalPatients: 30,
      todayOpdCount: 5,
      activeIpdCount: 2,
      totalBeds: 40,
      occupiedBeds: 8,
      recentActivities: [],
    });

    render(<DashboardPage />);
    expect(screen.queryByText('Admissions Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
  });

  test('DOCTOR: "Admissions Today" is not rendered', () => {
    mockRole = 'DOCTOR';
    mockStats({
      lastUpdated: NOW,
      totalPatients: 5,
      todayOpdCount: 2,
      activeIpdCount: 1,
      pendingLabCount: 1,
      labReportsToday: 1,
      recentActivities: [],
    });

    render(<DashboardPage />);
    expect(screen.queryByText('Admissions Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Admissions')).not.toBeInTheDocument();
  });
});

describe('DashboardPage — Doctor dashboard shows only doctor-scoped data', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'DOCTOR';
  });

  test('renders the four doctor-scoped stats using the values the backend sent', () => {
    mockStats({
      lastUpdated: NOW,
      totalPatients: 7,      // doctor-scoped, not hospital-wide
      todayOpdCount: 3,      // doctor-scoped
      activeIpdCount: 2,     // doctor-scoped
      activeIpdCountToday: 2,
      pendingLabCount: 4,
      pendingLabCountToday: 4,
      labReportsToday: 1,
      recentActivities: [],
    });

    render(<DashboardPage />);

    // Active IPD renders in the Hospital Overview metric cards (DOCTOR has no
    // registration-date-scoped field, so it never sees the "Total Patients"
    // card — that card is gated on newRegistrationsToday, which DOCTOR lacks).
    expect(screen.getByText('Active IPD')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Today's OPD Visits surfaces via the "Today's Appointments" alert and
    // the "OPD Visits" row in Today's Activity.
    expect(screen.getByText("Today's Appointments")).toBeInTheDocument();
    expect(screen.getByText('OPD Visits')).toBeInTheDocument();
    // Pending Lab Reports (Hospital Overview alert) + Lab Reports Today (Hospital Overview metric card).
    expect(screen.getByText('Pending Lab Reports')).toBeInTheDocument();
    expect(screen.getByText('Lab Reports Today')).toBeInTheDocument();
  });

  test('does not render hospital-wide sections not in the doctor-scoped field list', () => {
    mockStats({
      lastUpdated: NOW,
      totalPatients: 7,
      todayOpdCount: 3,
      activeIpdCount: 2,
      activeIpdCountToday: 2,
      pendingLabCount: 4,
      pendingLabCountToday: 4,
      labReportsToday: 1,
      recentActivities: [],
    });

    render(<DashboardPage />);

    // No hospital-wide revenue, staff, inventory, bed, or trend sections.
    expect(screen.queryByText('Revenue Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Active Staff')).not.toBeInTheDocument();
    expect(screen.queryByText('Inventory Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Bed Occupancy')).not.toBeInTheDocument();
    expect(screen.queryByText('OPD Trend')).not.toBeInTheDocument();
    expect(screen.queryByText('New Registrations')).not.toBeInTheDocument();
  });
});

describe('DashboardPage — Hospital Overview splits into Today and This Month sections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'HOSPITAL_ADMIN';
  });

  test('renders both section headings, each with its own date-scoped counts', () => {
    mockStats({
      lastUpdated: NOW,
      lowStockCountToday: 1,
      lowStockCountThisMonth: 5,
      pendingLabCountToday: 2,
      pendingLabCountThisMonth: 9,
      pendingPaymentsCountToday: 3,
      pendingPaymentsCountThisMonth: 11,
      todayOpdCount: 15,
      opdCountThisMonth: 200,
      recentActivities: [],
    });

    render(<DashboardPage />);

    expect(screen.getByText('Hospital Overview — Today')).toBeInTheDocument();
    expect(screen.getByText('Hospital Overview — This Month')).toBeInTheDocument();

    // "Low Stock Items" / "Pending Lab Reports" / "Pending Payments" labels are
    // shared by both sections — each count renders once, under its own label.
    expect(screen.getAllByText('Low Stock Items')).toHaveLength(2);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    expect(screen.getAllByText('Pending Lab Reports')).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();

    expect(screen.getAllByText('Pending Payments')).toHaveLength(2);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('11')).toBeInTheDocument();

    // The appointments card's label is section-specific, so it stays unique per section.
    // "15" also appears in the unrelated Today's Activity "OPD Visits" row (same
    // todayOpdCount value), so assert presence rather than a single match.
    expect(screen.getByText("Today's Appointments")).toBeInTheDocument();
    expect(screen.getAllByText('15').length).toBeGreaterThan(0);
    expect(screen.getByText("This Month's Appointments")).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  test('a section with no data-scoped fields for its range is omitted entirely', () => {
    mockStats({
      lastUpdated: NOW,
      todayOpdCount: 4, // only the Today counterpart is present
      recentActivities: [],
    });

    render(<DashboardPage />);

    expect(screen.getByText('Hospital Overview — Today')).toBeInTheDocument();
    expect(screen.queryByText('Hospital Overview — This Month')).not.toBeInTheDocument();
  });

  test('the 5 metric cards (formerly the Key Stats Strip) render in both sections with their own date-scoped values', () => {
    mockStats({
      lastUpdated: NOW,
      newRegistrationsToday: 4,
      newRegistrationsThisMonth: 60,
      activeIpdCountToday: 2,
      activeIpdCountThisMonth: 18,
      totalActiveStaffToday: 1,
      totalActiveStaffThisMonth: 5,
      labReportsToday: 3,
      labReportsThisMonth: 40,
      recentActivities: [],
    });

    render(<DashboardPage />);

    // "Total Patients" and "New Registrations" share the same underlying
    // value in each section (both registration-date-scoped). "New
    // Registrations" also appears a third time in the unrelated Today's
    // Activity row, so assert "at least" rather than an exact count there.
    expect(screen.getAllByText('Total Patients')).toHaveLength(2);
    expect(screen.getAllByText('New Registrations').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(2);   // Today: Total Patients + New Registrations
    expect(screen.getAllByText('60').length).toBeGreaterThanOrEqual(2); // This Month: Total Patients + New Registrations

    expect(screen.getAllByText('Active IPD')).toHaveLength(2);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();

    expect(screen.getAllByText('Active Staff')).toHaveLength(2);
    expect(screen.getByText('Joined today')).toBeInTheDocument();
    expect(screen.getByText('Joined this month')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    // "Lab Reports Today" keeps its literal label in the Today section; the
    // This Month section renames it so "Today" never appears under that heading.
    expect(screen.getByText('Lab Reports Today')).toBeInTheDocument();
    expect(screen.getByText('Lab Reports This Month')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});
