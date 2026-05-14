import * as fc from 'fast-check';
import { tenantCache } from '../../../src/shared/config/tenant-cache';
import { TenantStatus } from '../../../src/shared/types/common.types';

beforeEach(() => tenantCache.clear());

const tenantStatusArb = fc.constantFrom(...Object.values(TenantStatus));

// ─── PBT: Stateful — command sequences preserve invariants ───────────────────
describe('TenantCache — PBT stateful', () => {
  test('invariant: set then get within TTL always returns set value', () => {
    fc.assert(
      fc.property(fc.uuid(), tenantStatusArb, (tenantId, status) => {
        tenantCache.clear();
        tenantCache.set(tenantId, status);
        expect(tenantCache.get(tenantId)).toBe(status);
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  test('invariant: get after invalidate always returns null', () => {
    fc.assert(
      fc.property(fc.uuid(), tenantStatusArb, (tenantId, status) => {
        tenantCache.clear();
        tenantCache.set(tenantId, status);
        tenantCache.invalidate(tenantId);
        expect(tenantCache.get(tenantId)).toBeNull();
      }),
      { numRuns: 200, seed: 42 },
    );
  });

  test('invariant: get on unknown tenantId always returns null', () => {
    fc.assert(
      fc.property(fc.uuid(), (tenantId) => {
        tenantCache.clear();
        expect(tenantCache.get(tenantId)).toBeNull();
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// ─── Example-based tests ──────────────────────────────────────────────────────
describe('TenantCache — example-based', () => {
  test('cache miss returns null', () => {
    expect(tenantCache.get('unknown-id')).toBeNull();
  });

  test('set and get returns correct status', () => {
    tenantCache.set('t1', TenantStatus.ACTIVE);
    expect(tenantCache.get('t1')).toBe(TenantStatus.ACTIVE);
  });

  test('invalidate removes entry', () => {
    tenantCache.set('t2', TenantStatus.ACTIVE);
    tenantCache.invalidate('t2');
    expect(tenantCache.get('t2')).toBeNull();
  });

  test('overwrite updates cached status', () => {
    tenantCache.set('t3', TenantStatus.ACTIVE);
    tenantCache.set('t3', TenantStatus.INACTIVE);
    expect(tenantCache.get('t3')).toBe(TenantStatus.INACTIVE);
  });

  test('multiple tenants are independent', () => {
    tenantCache.set('ta', TenantStatus.ACTIVE);
    tenantCache.set('tb', TenantStatus.INACTIVE);
    expect(tenantCache.get('ta')).toBe(TenantStatus.ACTIVE);
    expect(tenantCache.get('tb')).toBe(TenantStatus.INACTIVE);
  });
});
