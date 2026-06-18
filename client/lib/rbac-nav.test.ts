import { getNavItems } from './rbac-nav';
import type { UserRole } from '@/store/types';

describe('getNavItems — RBAC nav filtering', () => {
  it('SUPER_ADMIN sees Tenants and Audit Logs only', () => {
    const items = getNavItems('SUPER_ADMIN');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/super-admin');
    expect(hrefs).toContain('/audit');
    // Must NOT see hospital-specific modules
    expect(hrefs).not.toContain('/patients');
    expect(hrefs).not.toContain('/opd');
    expect(hrefs).not.toContain('/payments');
  });

  it('HOSPITAL_ADMIN sees all hospital modules', () => {
    const items = getNavItems('HOSPITAL_ADMIN');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/patients');
    expect(hrefs).toContain('/opd');
    expect(hrefs).toContain('/ipd');
    expect(hrefs).toContain('/lab');
    expect(hrefs).toContain('/inventory');
    expect(hrefs).toContain('/payments');
    expect(hrefs).toContain('/admin');
    expect(hrefs).toContain('/audit');
  });

  it('DOCTOR sees patient, OPD, IPD, lab — not payments or inventory', () => {
    const items = getNavItems('DOCTOR');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/patients');
    expect(hrefs).toContain('/opd');
    expect(hrefs).toContain('/ipd');
    expect(hrefs).toContain('/lab');
    expect(hrefs).not.toContain('/payments');
    expect(hrefs).not.toContain('/inventory');
    expect(hrefs).not.toContain('/admin');
  });

  it('NURSE sees patients, OPD, and IPD — not payments or lab', () => {
    const items = getNavItems('NURSE');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/patients');
    expect(hrefs).toContain('/opd');
    expect(hrefs).toContain('/ipd');
    expect(hrefs).not.toContain('/payments');
    expect(hrefs).not.toContain('/lab');
  });

  it('RECEPTIONIST sees patient, OPD, IPD, payments — not lab or inventory', () => {
    const items = getNavItems('RECEPTIONIST');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/patients');
    expect(hrefs).toContain('/opd');
    expect(hrefs).toContain('/ipd');
    expect(hrefs).toContain('/payments');
    expect(hrefs).not.toContain('/lab');
    expect(hrefs).not.toContain('/inventory');
  });

  it('PATHOLOGIST sees only lab', () => {
    const items = getNavItems('PATHOLOGIST');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/lab');
    expect(hrefs).not.toContain('/patients');
    expect(hrefs).not.toContain('/payments');
  });

  it('RADIOLOGIST sees only lab', () => {
    const items = getNavItems('RADIOLOGIST');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/lab');
    expect(hrefs).not.toContain('/opd');
    expect(hrefs).not.toContain('/ipd');
  });

  it('FINANCE_MANAGER sees only payments', () => {
    const items = getNavItems('FINANCE_MANAGER');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/payments');
    expect(hrefs).not.toContain('/patients');
    expect(hrefs).not.toContain('/lab');
  });

  it('HR sees only users', () => {
    const items = getNavItems('HR');
    const hrefs = items.map((i) => i.href);
    expect(hrefs).toContain('/admin');
    expect(hrefs).not.toContain('/patients');
    expect(hrefs).not.toContain('/payments');
  });

  it('STAFF sees only dashboard', () => {
    const items = getNavItems('STAFF');
    expect(items).toHaveLength(1);
    expect(items[0].href).toBe('/dashboard');
  });

  it('all nav items have label, href, and icon', () => {
    const roles: UserRole[] = [
      'SUPER_ADMIN', 'HOSPITAL_ADMIN', 'MANAGER', 'DOCTOR', 'NURSE',
      'RECEPTIONIST', 'PATHOLOGIST', 'RADIOLOGIST', 'FINANCE_MANAGER',
      'HR', 'ADMIN', 'STAFF',
    ];
    for (const role of roles) {
      for (const item of getNavItems(role)) {
        expect(item.label).toBeTruthy();
        expect(item.href).toMatch(/^\//);
        expect(item.icon).toBeTruthy();
      }
    }
  });
});
