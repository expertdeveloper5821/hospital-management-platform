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
    // Sanity check: the rest of the Key Stats Strip still renders normally.
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
      pendingLabCount: 4,
      labReportsToday: 1,
      recentActivities: [],
    });

    render(<DashboardPage />);

    // Total Patients + Active IPD render in the Key Stats Strip.
    expect(screen.getByText('Total Patients')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Active IPD')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Today's OPD Visits surfaces via the "Today's Appointments" alert and
    // the "OPD Visits" row in Today's Activity.
    expect(screen.getByText("Today's Appointments")).toBeInTheDocument();
    expect(screen.getByText('OPD Visits')).toBeInTheDocument();
    // Pending Lab Reports (Critical Alerts) + Lab Reports Today (Key Stats Strip).
    expect(screen.getByText('Pending Lab Reports')).toBeInTheDocument();
    expect(screen.getByText('Lab Reports Today')).toBeInTheDocument();
  });

  test('does not render hospital-wide sections not in the doctor-scoped field list', () => {
    mockStats({
      lastUpdated: NOW,
      totalPatients: 7,
      todayOpdCount: 3,
      activeIpdCount: 2,
      pendingLabCount: 4,
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
