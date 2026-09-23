jest.mock('./processor', () => ({
  offlineSyncProcessor: { triggerSync: jest.fn() },
}));

import { offlineSyncProcessor } from './processor';
import { registerBackgroundSync, listenForBackgroundSyncMessages, BACKGROUND_SYNC_TAG } from './background-sync';

const mockTriggerSync = offlineSyncProcessor.triggerSync as jest.Mock;

function setServiceWorker(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

describe('registerBackgroundSync', () => {
  const originalServiceWorker = (navigator as { serviceWorker?: unknown }).serviceWorker;

  afterEach(() => {
    setServiceWorker(originalServiceWorker);
    jest.clearAllMocks();
  });

  test('does nothing when service workers are unsupported', async () => {
    setServiceWorker(undefined);
    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });

  test('registers the outbox-flush tag when Background Sync is supported', async () => {
    const register = jest.fn().mockResolvedValue(undefined);
    setServiceWorker({
      ready: Promise.resolve({ sync: { register } }),
    });

    await registerBackgroundSync();

    expect(register).toHaveBeenCalledWith(BACKGROUND_SYNC_TAG);
  });

  test('is a no-op when the registration has no sync manager (Safari/Firefox)', async () => {
    setServiceWorker({
      ready: Promise.resolve({}),
    });

    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });

  test('swallows a rejected registration (best-effort only)', async () => {
    setServiceWorker({
      ready: Promise.resolve({ sync: { register: jest.fn().mockRejectedValue(new Error('denied')) } }),
    });

    await expect(registerBackgroundSync()).resolves.toBeUndefined();
  });
});

describe('listenForBackgroundSyncMessages', () => {
  const originalServiceWorker = (navigator as { serviceWorker?: unknown }).serviceWorker;

  afterEach(() => {
    setServiceWorker(originalServiceWorker);
    jest.clearAllMocks();
  });

  test('triggers a foreground sync when the service worker relays the outbox-flush message', () => {
    const listeners: Record<string, (event: { data: unknown }) => void> = {};
    setServiceWorker({
      addEventListener: (type: string, handler: (event: { data: unknown }) => void) => { listeners[type] = handler; },
      removeEventListener: jest.fn(),
    });

    listenForBackgroundSyncMessages();
    listeners.message({ data: { type: BACKGROUND_SYNC_TAG } });

    expect(mockTriggerSync).toHaveBeenCalledTimes(1);
  });

  test('ignores unrelated messages', () => {
    const listeners: Record<string, (event: { data: unknown }) => void> = {};
    setServiceWorker({
      addEventListener: (type: string, handler: (event: { data: unknown }) => void) => { listeners[type] = handler; },
      removeEventListener: jest.fn(),
    });

    listenForBackgroundSyncMessages();
    listeners.message({ data: { type: 'some-other-message' } });
    listeners.message({ data: undefined });

    expect(mockTriggerSync).not.toHaveBeenCalled();
  });

  test('the returned unsubscribe function removes the listener', () => {
    const removeEventListener = jest.fn();
    setServiceWorker({ addEventListener: jest.fn(), removeEventListener });

    const unsubscribe = listenForBackgroundSyncMessages();
    unsubscribe();

    expect(removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });

  test('returns a harmless no-op unsubscribe when service workers are unsupported', () => {
    setServiceWorker(undefined);
    expect(() => listenForBackgroundSyncMessages()()).not.toThrow();
  });
});
