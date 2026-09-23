import { getSessionFromToken } from './session';

function makeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('getSessionFromToken', () => {
  test('extracts tenantId and userId from a valid token', () => {
    const token = makeToken({ userId: 'u1', tenantId: 't1', role: 'DOCTOR', email: 'a@b.com', isFirstLogin: false });
    expect(getSessionFromToken(token)).toEqual({ tenantId: 't1', userId: 'u1' });
  });

  test('returns null for a Super Admin token (tenantId is null)', () => {
    const token = makeToken({ userId: 'sa1', tenantId: null, role: 'SUPER_ADMIN', email: 'sa@b.com', isFirstLogin: false });
    expect(getSessionFromToken(token)).toBeNull();
  });

  test('returns null for a missing token', () => {
    expect(getSessionFromToken(null)).toBeNull();
    expect(getSessionFromToken(undefined)).toBeNull();
    expect(getSessionFromToken('')).toBeNull();
  });

  test('returns null for a malformed token', () => {
    expect(getSessionFromToken('not-a-jwt')).toBeNull();
    expect(getSessionFromToken('a.b')).toBeNull();
  });

  test('returns null when userId is missing', () => {
    const token = makeToken({ tenantId: 't1' });
    expect(getSessionFromToken(token)).toBeNull();
  });
});
