import manifest from './manifest';

describe('PWA manifest', () => {
  const result = manifest();

  test('has a name, short name, and description', () => {
    expect(result.name).toBe('Hospital Management Platform');
    expect(result.short_name).toBe('HMS');
    expect(result.description).toBeTruthy();
  });

  test('is installable as standalone, starting at /dashboard (not "/", which is an uncacheable redirect() — see app/sw.ts)', () => {
    expect(result.start_url).toBe('/dashboard');
    expect(result.display).toBe('standalone');
  });

  test('theme_color matches the app\'s existing primary color (#2563EB)', () => {
    expect(result.theme_color).toBe('#2563EB');
  });

  test('declares 192 and 512 icons, each covering both any and maskable purposes', () => {
    const sizes = result.icons?.map((icon) => icon.sizes).sort();
    expect(sizes).toEqual(['192x192', '192x192', '512x512', '512x512']);

    const purposes = result.icons?.map((icon) => icon.purpose).sort();
    expect(purposes).toEqual(['any', 'any', 'maskable', 'maskable']);

    for (const icon of result.icons ?? []) {
      expect(icon.type).toBe('image/png');
      expect(icon.src).toMatch(/^\/icons\/icon-(192|512)\.png$/);
    }
  });
});
