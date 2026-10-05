import { getCurrentCoordinates, GeolocationError, GEOLOCATION_TIMEOUT_MS } from './geolocation';

const mockGetCurrentPosition = jest.fn();

function setGeolocation(value: unknown) {
  Object.defineProperty(global.navigator, 'geolocation', { configurable: true, value });
}

describe('getCurrentCoordinates', () => {
  beforeEach(() => {
    mockGetCurrentPosition.mockReset();
    setGeolocation({ getCurrentPosition: mockGetCurrentPosition });
  });

  it('resolves latitude/longitude from a fresh, high-accuracy fix', async () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: 19.076, longitude: 72.8777, accuracy: 12 } } as GeolocationPosition));

    await expect(getCurrentCoordinates()).resolves.toEqual({ latitude: 19.076, longitude: 72.8777 });
    expect(mockGetCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });

  it.each([
    [1, 'PERMISSION_DENIED'],
    [2, 'POSITION_UNAVAILABLE'],
    [3, 'TIMEOUT'],
  ])('maps error code %i to %s', async (code, reason) => {
    mockGetCurrentPosition.mockImplementation((_s: PositionCallback, error: PositionErrorCallback) =>
      error({ code } as GeolocationPositionError));

    await expect(getCurrentCoordinates()).rejects.toMatchObject({ name: 'GeolocationError', reason });
  });

  it('rejects as UNSUPPORTED when the browser has no geolocation API', async () => {
    setGeolocation(undefined);

    const err = await getCurrentCoordinates().catch((e) => e);
    expect(err).toBeInstanceOf(GeolocationError);
    expect(err.reason).toBe('UNSUPPORTED');
  });

  it('rejects a fix with non-finite coordinates instead of passing it on', async () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) =>
      success({ coords: { latitude: NaN, longitude: 72.8777 } } as GeolocationPosition));

    await expect(getCurrentCoordinates()).rejects.toMatchObject({ reason: 'POSITION_UNAVAILABLE' });
  });
});
