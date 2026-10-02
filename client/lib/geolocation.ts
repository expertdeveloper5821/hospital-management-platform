import type { GeoCoordinates } from '@/store/types';

// Attendance check-in/check-out must carry a fresh GPS fix. Any failure is
// surfaced as a GeolocationError with a user-facing message — callers must
// abort the attendance action rather than submit without coordinates.

export type GeolocationErrorReason = 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT';

const MESSAGES: Record<GeolocationErrorReason, string> = {
  UNSUPPORTED:          'This browser or device cannot share its location, so attendance cannot be recorded here.',
  PERMISSION_DENIED:    'Location access is blocked. Allow location for this site in your browser settings, then try again.',
  POSITION_UNAVAILABLE: 'Your location could not be determined. Turn on GPS / location services and try again.',
  TIMEOUT:              'Getting your location took too long. Move to an area with better signal and try again.',
};

export class GeolocationError extends Error {
  constructor(public readonly reason: GeolocationErrorReason) {
    super(MESSAGES[reason]);
    this.name = 'GeolocationError';
  }
}

export const GEOLOCATION_TIMEOUT_MS = 15_000;

// Codes per the W3C Geolocation spec (GeolocationPositionError).
function reasonForCode(code: number): GeolocationErrorReason {
  if (code === 1) return 'PERMISSION_DENIED';
  if (code === 3) return 'TIMEOUT';
  return 'POSITION_UNAVAILABLE';
}

export function getCurrentCoordinates(): Promise<GeoCoordinates> {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      reject(new GeolocationError('UNSUPPORTED'));
      return;
    }

    geo.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
          reject(new GeolocationError('POSITION_UNAVAILABLE'));
          return;
        }
        resolve({ latitude: coords.latitude, longitude: coords.longitude });
      },
      (err) => reject(new GeolocationError(reasonForCode(err.code))),
      // maximumAge: 0 — never reuse a cached fix from somewhere else.
      { enableHighAccuracy: true, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

export function geolocationErrorMessage(err: unknown): string {
  return err instanceof GeolocationError ? err.message : MESSAGES.POSITION_UNAVAILABLE;
}
