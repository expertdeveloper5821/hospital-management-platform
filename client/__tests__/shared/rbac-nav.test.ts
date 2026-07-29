import { getNavItems } from '@/lib/rbac-nav';
import type { UserRole } from '@/store/types';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rbac-nav — Revenue sidebar visibility', () => {
  test.each<UserRole>(['HOSPITAL_ADMIN', 'MANAGER', 'FINANCE_MANAGER', 'ADMIN'])(
    '%s sees a Revenue item pointing at /revenue, directly after Payments',
    (role) => {
      const items = getNavItems(role);
      const paymentsIndex = items.findIndex((item) => item.label === 'Payments');
      const revenueIndex = items.findIndex((item) => item.label === 'Revenue');

      expect(paymentsIndex).toBeGreaterThan(-1);
      expect(revenueIndex).toBe(paymentsIndex + 1);
      expect(items[revenueIndex]).toEqual({ label: 'Revenue', href: '/revenue', icon: 'trending-up' });
    },
  );

  test.each<UserRole>(['SUPER_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'PATHOLOGIST', 'RADIOLOGIST', 'HR', 'STAFF'])(
    '%s does not see a Revenue item',
    (role) => {
      const items = getNavItems(role);
      expect(items.some((item) => item.label === 'Revenue')).toBe(false);
    },
  );

  test('RECEPTIONIST still sees Payments (unchanged) but not Revenue', () => {
    const items = getNavItems('RECEPTIONIST');
    expect(items.some((item) => item.label === 'Payments')).toBe(true);
    expect(items.some((item) => item.label === 'Revenue')).toBe(false);
  });
});
