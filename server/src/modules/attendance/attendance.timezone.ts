// Hospital-local (IST, UTC+5:30) calendar-day helpers for the attendance module.
//
// Attendance must bucket by the *hospital's* local calendar day, not the
// server process's OS timezone (which may be UTC in production) and not raw
// UTC. India does not observe DST, so a fixed +5:30 offset is safe and exact
// year-round — no timezone database / Intl dependency needed.
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface IstDateParts {
  year:  number;
  month: number; // 1-12
  day:   number;
}

// The IST calendar date (y/m/d) containing the given instant.
export function getIstDateParts(date: Date): IstDateParts {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year:  shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day:   shifted.getUTCDate(),
  };
}

// The instant corresponding to 00:00 IST on the given IST calendar date.
export function istMidnightFor(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MS);
}

// The instant representing 00:00 IST of the IST calendar day containing `date`
// — i.e. the hospital-local equivalent of "midnight today". Used as the
// `attendanceDate` bucket key so a check-in just after 12:00 AM IST always
// lands on the correct (new) local day, regardless of server OS timezone.
export function toIstMidnight(date: Date): Date {
  const { year, month, day } = getIstDateParts(date);
  return istMidnightFor(year, month, day);
}

// YYYY-MM-DD key for the IST calendar date containing the given instant.
export function toIstDateKey(date: Date): string {
  const { year, month, day } = getIstDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
