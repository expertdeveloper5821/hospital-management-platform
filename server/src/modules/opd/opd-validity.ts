import { getIstDateParts, istMidnightFor, toIstMidnight } from '../attendance/attendance.timezone';

// Single source of the OPD "Valid Till" rule, shared by the OPD slip (print
// page / PDF parcha) and the payment-validity fee check so the two can never
// disagree. Day boundaries are hospital-local IST (Asia/Kolkata), never the
// server's OS timezone.
//
// The anchor's IST calendar date is day one, so validityDays = 5 with a
// payment on 15 May covers 15–19 May inclusive; 20 May needs a new payment.
// Returns 00:00 IST of that last valid day.
export function computeValidTill(anchor: Date, validityDays: number): Date {
  const { year, month, day } = getIstDateParts(anchor);
  return istMidnightFor(year, month, day + validityDays - 1);
}

// True while `now` falls on or before the last valid IST calendar day.
export function isWithinValidity(validTill: Date, now: Date = new Date()): boolean {
  return toIstMidnight(now).getTime() <= toIstMidnight(validTill).getTime();
}
