import { APP_SHELL_ROUTES, APP_SHELL_CACHE_NAME } from './shell-routes';

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

// A minimal stand-in for a fetch() Response — jsdom (unlike Node) does not
// provide a global `Response` constructor, and shell-cache.ts only ever
// touches `.ok` and `.clone()`, so a real Response isn't needed here.
function mockResponse(status: number) {
  const ok = status >= 200 && status < 300;
  return { ok, status, clone: () => ({ ok, status }) };
}

function mockCaches() {
  const store = new Map<string, Map<string, unknown>>();
  const cacheApi = {
    put: jest.fn(async (req: string, res: unknown) => {
      store.get(APP_SHELL_CACHE_NAME)!.set(req, res);
    }),
  };
  const caches = {
    open: jest.fn(async (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      return cacheApi;
    }),
  };
  Object.defineProperty(window, 'caches', { value: caches, configurable: true });
  return { store, cacheApi, caches };
}

describe('primeAppShellCache', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.resetModules();
    global.fetch = originalFetch;
    setNavigatorOnLine(true);
  });

  test('fetches every shell route and writes it into the app-shell cache', async () => {
    const { caches, cacheApi } = mockCaches();
    const fetchMock = jest.fn(async () => mockResponse(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await primeAppShellCache();

    expect(caches.open).toHaveBeenCalledWith(APP_SHELL_CACHE_NAME);
    expect(fetchMock).toHaveBeenCalledTimes(APP_SHELL_ROUTES.length);
    for (const route of APP_SHELL_ROUTES) {
      expect(fetchMock).toHaveBeenCalledWith(route, { credentials: 'same-origin' });
    }
    expect(cacheApi.put).toHaveBeenCalledTimes(APP_SHELL_ROUTES.length);
  });

  test('never issues a request carrying Next.js RSC transition headers — plain GET only', async () => {
    mockCaches();
    const fetchMock = jest.fn(async (_route: string, _init?: RequestInit) => mockResponse(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await primeAppShellCache();

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toBeUndefined();
    }
  });

  test('is a no-op when the browser already knows it is offline', async () => {
    const { caches } = mockCaches();
    setNavigatorOnLine(false);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await primeAppShellCache();

    expect(caches.open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a non-ok response for one route is not cached, and does not stop the others', async () => {
    const { cacheApi } = mockCaches();
    const fetchMock = jest.fn(async (route: string) =>
      route === '/opd' ? mockResponse(500) : mockResponse(200),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await primeAppShellCache();

    expect(cacheApi.put).toHaveBeenCalledTimes(APP_SHELL_ROUTES.length - 1);
    expect(cacheApi.put).not.toHaveBeenCalledWith('/opd', expect.anything());
  });

  test('a fetch rejection for one route does not throw or stop the others', async () => {
    const { cacheApi } = mockCaches();
    const fetchMock = jest.fn(async (route: string) => {
      if (route === '/ipd') throw new TypeError('Failed to fetch');
      return mockResponse(200);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await expect(primeAppShellCache()).resolves.toBeUndefined();

    expect(cacheApi.put).toHaveBeenCalledTimes(APP_SHELL_ROUTES.length - 1);
  });

  test('concurrent calls share one in-flight priming run', async () => {
    const { caches } = mockCaches();
    const fetchMock = jest.fn(async () => mockResponse(200));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await Promise.all([primeAppShellCache(), primeAppShellCache(), primeAppShellCache()]);

    expect(caches.open).toHaveBeenCalledTimes(1);
  });

  test('caches.open throwing (e.g. private browsing) does not throw out of primeAppShellCache', async () => {
    Object.defineProperty(window, 'caches', {
      value: { open: jest.fn(async () => { throw new Error('Cache Storage disabled'); }) },
      configurable: true,
    });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const { primeAppShellCache } = await import('./shell-cache');
    await expect(primeAppShellCache()).resolves.toBeUndefined();
  });
});
