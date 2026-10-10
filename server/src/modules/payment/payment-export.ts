import {
  IST_OFFSET_MS, getIstDateParts, istMidnightFor, toIstDateKey,
} from '../attendance/attendance.timezone';
import { ExportPaymentsQuery, PaymentExportPeriod } from './payment.types';

// Payment Export (collection report) helpers — pure functions, no DB access.
//
// Every period is a range of whole hospital-local (IST) calendar days,
// independent of the server OS timezone — same convention as the dashboard
// and OPD validity (see attendance.timezone.ts). The range is half-open:
// createdAt >= from && createdAt < toExclusive.

export const MAX_CUSTOM_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentExportRange {
  period:      PaymentExportPeriod;
  from:        Date;   // 00:00 IST of the first day
  toExclusive: Date;   // 00:00 IST of the day after the last day
  fromKey:     string; // YYYY-MM-DD (IST), first day
  toKey:       string; // YYYY-MM-DD (IST), last day (inclusive)
}

export class PaymentExportRangeError extends Error {}

function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

function addDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * DAY_MS);
}

// Resolves the requested period to an IST day range. `now` is injected for
// tests. DAILY / WEEKLY / MONTHLY are anchored on `date` (default: today IST):
// that day, its Monday–Sunday week, or its calendar month. CUSTOM is the
// inclusive dateFrom..dateTo range. Ranges starting in the future (IST) are
// rejected; a custom range may not end in the future either.
export function resolveExportRange(query: ExportPaymentsQuery, now: Date): PaymentExportRange {
  const todayKey = toIstDateKey(now);
  let from: Date;
  let toExclusive: Date;

  if (query.period === 'CUSTOM') {
    const a = parseDateKey(query.dateFrom!);
    const b = parseDateKey(query.dateTo!);
    from        = istMidnightFor(a.year, a.month, a.day);
    toExclusive = addDays(istMidnightFor(b.year, b.month, b.day), 1);
    if (query.dateTo! > todayKey) {
      throw new PaymentExportRangeError('dateTo cannot be in the future');
    }
    if ((toExclusive.getTime() - from.getTime()) / DAY_MS > MAX_CUSTOM_RANGE_DAYS) {
      throw new PaymentExportRangeError(`Custom range cannot exceed ${MAX_CUSTOM_RANGE_DAYS} days`);
    }
  } else {
    const anchorKey = query.date ?? todayKey;
    if (anchorKey > todayKey) {
      throw new PaymentExportRangeError('date cannot be in the future');
    }
    const { year, month, day } = parseDateKey(anchorKey);
    const anchor = istMidnightFor(year, month, day);

    if (query.period === 'DAILY') {
      from        = anchor;
      toExclusive = addDays(anchor, 1);
    } else if (query.period === 'WEEKLY') {
      // getUTCDay of the UTC date with the same y/m/d: 0 = Sunday … 6 = Saturday.
      const weekday       = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const daysSinceMon  = (weekday + 6) % 7;
      from        = addDays(anchor, -daysSinceMon);
      toExclusive = addDays(from, 7);
    } else {
      from        = istMidnightFor(year, month, 1);
      toExclusive = month === 12 ? istMidnightFor(year + 1, 1, 1) : istMidnightFor(year, month + 1, 1);
    }
  }

  return {
    period:  query.period,
    from,
    toExclusive,
    fromKey: toIstDateKey(from),
    toKey:   toIstDateKey(new Date(toExclusive.getTime() - 1)),
  };
}

// "YYYY-MM-DD HH:mm" in IST.
export function formatIstDateTime(date: Date): { date: string; time: string } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const { year, month, day } = getIstDateParts(date);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${hh}:${mm}`,
  };
}

// Amounts are summed in integer paise so totals never drift from the rows.
export function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

export interface PaymentExportRow {
  paymentId:     string;
  createdAt:     Date;
  patientId:     string;
  patientName:   string | null;
  description:   string;
  paymentMethod: string;
  transactionId: string | null;
  amountPaise:   number;
}

export type PaymentExportMethodTotals = Record<'CASH' | 'UPI' | 'CARD' | 'CHEQUE', { count: number; paise: number }>;

export interface PaymentExportReport {
  hospitalName:    string;
  range:           PaymentExportRange;
  generatedAt:     Date;
  generatedBy:     string;
  rows:            PaymentExportRow[];
  methodTotals:    PaymentExportMethodTotals;
  grandTotalPaise: number;
  excludedCounts:  { PENDING: number; FAILED: number; CANCELLED: number };
}

export const PERIOD_LABELS: Record<PaymentExportPeriod, string> = {
  DAILY:   'Daily',
  WEEKLY:  'Weekly',
  MONTHLY: 'Monthly',
  CUSTOM:  'Custom Range',
};

export const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque',
};

export function paymentExportFilename(range: PaymentExportRange): string {
  const span = range.fromKey === range.toKey ? range.fromKey : `${range.fromKey}_to_${range.toKey}`;
  return `payments-${range.period.toLowerCase()}-${span}.pdf`;
}
