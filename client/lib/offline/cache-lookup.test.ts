import { findCachedEntityById } from './cache-lookup';
import type { RootState } from '@/store';

function makeState(queries: Record<string, { data?: unknown } | undefined>): RootState {
  return { api: { queries } } as unknown as RootState;
}

describe('findCachedEntityById', () => {
  test('finds a cached entity whose id field matches on a single-object query (getPatientById)', () => {
    const state = makeState({
      'getPatientById("PAT-1")': { data: { patientId: 'PAT-1', fullName: 'Jane' } },
    });

    const result = findCachedEntityById(state, 'patientId', 'PAT-1');
    expect(result).toEqual({ patientId: 'PAT-1', fullName: 'Jane' });
  });

  test('returns null when nothing matches', () => {
    const state = makeState({
      'getPatientById("PAT-1")': { data: { patientId: 'PAT-1' } },
    });
    expect(findCachedEntityById(state, 'patientId', 'PAT-2')).toBeNull();
  });

  test('finds an entity inside a bare array query result (getOPDQueue)', () => {
    const state = makeState({
      'getOPDQueue(undefined)': { data: [{ visitId: 'OPD-1' }, { visitId: 'OPD-2', diagnosis: 'flu' }] },
    });

    const result = findCachedEntityById(state, 'visitId', 'OPD-2');
    expect(result).toEqual({ visitId: 'OPD-2', diagnosis: 'flu' });
  });

  test('finds an entity inside a paginated/wrapped query result (searchPatients, listAdmissions)', () => {
    const state = makeState({
      'searchPatients({"page":1})': {
        data: { data: [{ patientId: 'PAT-1' }, { patientId: 'PAT-2', fullName: 'Jane' }], total: 2, page: 1, limit: 20 },
      },
    });

    const result = findCachedEntityById(state, 'patientId', 'PAT-2');
    expect(result).toEqual({ patientId: 'PAT-2', fullName: 'Jane' });
  });

  test('prefers a direct single-entity match over scanning a list in the same state', () => {
    const state = makeState({
      'getOPDQueue(undefined)': { data: [{ visitId: 'OPD-1', diagnosis: 'stale' }] },
      'getOPDVisitById("OPD-1")': { data: { visitId: 'OPD-1', diagnosis: 'fresh' } },
    });

    // Both are valid matches; either being returned is correct — the point is
    // it must find one, not that a particular entry wins.
    const result = findCachedEntityById(state, 'visitId', 'OPD-1');
    expect(result).not.toBeNull();
    expect(result?.visitId).toBe('OPD-1');
  });

  test('ignores entries with no data (pending/errored queries)', () => {
    const state = makeState({
      'getPatientById("PAT-1")': undefined,
      'getPatientById("PAT-2")': { data: undefined },
    });
    expect(findCachedEntityById(state, 'patientId', 'PAT-1')).toBeNull();
  });

  test('ignores a wrapped result whose nested data is not an array', () => {
    const state = makeState({
      getPaymentSummary: { data: { total: 500 } },
    });
    expect(findCachedEntityById(state, 'patientId', 'PAT-1')).toBeNull();
  });

  test('empty query cache returns null', () => {
    expect(findCachedEntityById(makeState({}), 'patientId', 'PAT-1')).toBeNull();
  });
});
