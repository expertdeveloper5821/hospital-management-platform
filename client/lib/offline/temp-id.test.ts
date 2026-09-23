import { resolveTempIdRefs, UnresolvedTempIdError } from './temp-id';

describe('resolveTempIdRefs', () => {
  test('returns the payload unchanged when there are no tempIdRefs', () => {
    const payload = { amount: 500 };
    expect(resolveTempIdRefs(payload, [], new Map())).toEqual(payload);
  });

  test('rewrites a top-level field to the resolved id', () => {
    const payload = { patientId: 'temp-abc', amount: 500 };
    const resolved = new Map([['temp-abc', 'PAT-real-123']]);

    const result = resolveTempIdRefs(payload, [{ path: 'patientId', tempId: 'temp-abc' }], resolved);

    expect(result).toEqual({ patientId: 'PAT-real-123', amount: 500 });
  });

  test('rewrites a nested field via a dot-path', () => {
    const payload = { reference: { patientId: 'temp-abc' } };
    const resolved = new Map([['temp-abc', 'PAT-real-123']]);

    const result = resolveTempIdRefs(payload, [{ path: 'reference.patientId', tempId: 'temp-abc' }], resolved);

    expect(result).toEqual({ reference: { patientId: 'PAT-real-123' } });
  });

  test('does not mutate the original payload', () => {
    const payload = { patientId: 'temp-abc' };
    const resolved = new Map([['temp-abc', 'PAT-real-123']]);

    resolveTempIdRefs(payload, [{ path: 'patientId', tempId: 'temp-abc' }], resolved);

    expect(payload.patientId).toBe('temp-abc');
  });

  test('throws UnresolvedTempIdError when the dependency has not synced yet', () => {
    const payload = { patientId: 'temp-abc' };

    expect(() =>
      resolveTempIdRefs(payload, [{ path: 'patientId', tempId: 'temp-abc' }], new Map()),
    ).toThrow(UnresolvedTempIdError);
  });

  test('resolves multiple refs in one payload', () => {
    const payload = { patientId: 'temp-p', visitId: 'temp-v' };
    const resolved = new Map([['temp-p', 'PAT-1'], ['temp-v', 'OPD-1']]);

    const result = resolveTempIdRefs(
      payload,
      [{ path: 'patientId', tempId: 'temp-p' }, { path: 'visitId', tempId: 'temp-v' }],
      resolved,
    );

    expect(result).toEqual({ patientId: 'PAT-1', visitId: 'OPD-1' });
  });
});
