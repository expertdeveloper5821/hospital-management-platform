import { isAllowedOrigin, normalizeOrigin } from '../../../src/shared/utils/cors';

describe('cors origin matching', () => {
  test('normalizes trailing slashes', () => {
    expect(normalizeOrigin('https://hospital-management-platform-sakt.vercel.app/')).toBe(
      'https://hospital-management-platform-sakt.vercel.app',
    );
  });

  test('allows exact origin matches', () => {
    expect(
      isAllowedOrigin(
        'https://hospital-management-platform-sakt.vercel.app',
        ['https://hospital-management-platform-sakt.vercel.app'],
      ),
    ).toBe(true);
  });

  test('allows vercel preview deployments for an allowed production vercel domain', () => {
    expect(
      isAllowedOrigin(
        'https://hospital-management-platform-sakt-expertdeveloper5821s-projects.vercel.app',
        ['https://hospital-management-platform-sakt.vercel.app'],
      ),
    ).toBe(true);
  });

  test('blocks unrelated vercel projects', () => {
    expect(
      isAllowedOrigin(
        'https://another-project-expertdeveloper5821s-projects.vercel.app',
        ['https://hospital-management-platform-sakt.vercel.app'],
      ),
    ).toBe(false);
  });

  test('supports explicit wildcard origins when configured', () => {
    expect(
      isAllowedOrigin(
        'https://hospital-management-platform-sakt-expertdeveloper5821s-projects.vercel.app',
        ['https://hospital-management-platform-sakt-*.vercel.app'],
      ),
    ).toBe(true);
  });
});
