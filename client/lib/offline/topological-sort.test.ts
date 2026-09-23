import { topologicalOrder } from './topological-sort';
import type { OutboxEntry } from './types';

function makeEntry(overrides: Partial<OutboxEntry> & { clientOpId: string }): OutboxEntry {
  return {
    tenantId: 't1', userId: 'u1', entityType: 'PATIENT', operation: 'CREATE',
    endpoint: '/api/patients', method: 'POST', payloadCiphertext: 'enc:client:v1:x',
    dependsOn: [], tempIdRefs: [], status: 'PENDING', attempts: 0,
    lastAttemptAt: null, lastError: null, createdAt: 0,
    ...overrides,
  };
}

describe('topologicalOrder', () => {
  test('independent entries keep their original relative order', () => {
    const a = makeEntry({ clientOpId: 'a' });
    const b = makeEntry({ clientOpId: 'b' });
    const c = makeEntry({ clientOpId: 'c' });

    expect(topologicalOrder([c, a, b]).map((e) => e.clientOpId)).toEqual(['c', 'a', 'b']);
  });

  test('a dependent entry is always ordered after its dependency', () => {
    const patient = makeEntry({ clientOpId: 'patient-create' });
    const payment = makeEntry({ clientOpId: 'payment-create', dependsOn: ['patient-create'] });

    // Even queued in reverse order, the dependency must come first.
    const ordered = topologicalOrder([payment, patient]);
    expect(ordered.map((e) => e.clientOpId)).toEqual(['patient-create', 'payment-create']);
  });

  test('a dependsOn id not present in the batch (already synced) is treated as satisfied', () => {
    const payment = makeEntry({ clientOpId: 'payment-create', dependsOn: ['already-synced-and-removed'] });

    const ordered = topologicalOrder([payment]);
    expect(ordered.map((e) => e.clientOpId)).toEqual(['payment-create']);
  });

  test('multi-level chain orders correctly regardless of input order', () => {
    const patient = makeEntry({ clientOpId: 'patient' });
    const visit   = makeEntry({ clientOpId: 'visit', dependsOn: ['patient'] });
    const payment = makeEntry({ clientOpId: 'payment', dependsOn: ['visit'] });

    const ordered = topologicalOrder([payment, visit, patient]);
    expect(ordered.map((e) => e.clientOpId)).toEqual(['patient', 'visit', 'payment']);
  });

  test('a dependent with multiple dependencies waits for all of them', () => {
    const a = makeEntry({ clientOpId: 'a' });
    const b = makeEntry({ clientOpId: 'b' });
    const c = makeEntry({ clientOpId: 'c', dependsOn: ['a', 'b'] });

    const ordered = topologicalOrder([c, b, a]);
    const indexOf = (id: string) => ordered.findIndex((e) => e.clientOpId === id);
    expect(indexOf('c')).toBeGreaterThan(indexOf('a'));
    expect(indexOf('c')).toBeGreaterThan(indexOf('b'));
  });

  test('does not drop entries even in the (unexpected) presence of a cycle', () => {
    const a = makeEntry({ clientOpId: 'a', dependsOn: ['b'] });
    const b = makeEntry({ clientOpId: 'b', dependsOn: ['a'] });

    const ordered = topologicalOrder([a, b]);
    expect(ordered).toHaveLength(2);
    expect(new Set(ordered.map((e) => e.clientOpId))).toEqual(new Set(['a', 'b']));
  });

  test('empty input returns empty output', () => {
    expect(topologicalOrder([])).toEqual([]);
  });
});
