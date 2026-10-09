import { computeValidTill, isWithinValidity } from '../../../src/modules/opd/opd-validity';
import { toIstDateKey } from '../../../src/modules/attendance/attendance.timezone';

describe('OPD validity rule (IST, anchor day is day one)', () => {
  describe('computeValidTill', () => {
    test('5-day validity paid on Day 1 (15 May) ends on Day 5 (19 May), returned as 00:00 IST', () => {
      const validTill = computeValidTill(new Date('2026-05-15T05:00:00.000Z'), 5); // 10:30 IST
      expect(validTill.toISOString()).toBe('2026-05-18T18:30:00.000Z');
      expect(toIstDateKey(validTill)).toBe('2026-05-19');
    });

    test('a 1-day validity covers only the payment day', () => {
      expect(toIstDateKey(computeValidTill(new Date('2026-05-15T05:00:00.000Z'), 1))).toBe('2026-05-15');
    });

    test('a payment at 23:59 IST counts on that IST day, not the next UTC day', () => {
      // 2026-05-14T18:29:59Z is 14 May 23:59:59 IST.
      expect(toIstDateKey(computeValidTill(new Date('2026-05-14T18:29:59.000Z'), 5))).toBe('2026-05-18');
    });

    test('a payment at 00:00 IST counts on the new IST day although it is still the previous UTC day', () => {
      // 2026-05-14T18:30:00Z is 15 May 00:00 IST.
      expect(toIstDateKey(computeValidTill(new Date('2026-05-14T18:30:00.000Z'), 5))).toBe('2026-05-19');
    });

    test('rolls over month and year ends', () => {
      expect(toIstDateKey(computeValidTill(new Date('2026-05-30T05:00:00.000Z'), 5))).toBe('2026-06-03');
      expect(toIstDateKey(computeValidTill(new Date('2026-12-30T05:00:00.000Z'), 5))).toBe('2027-01-03');
    });
  });

  describe('isWithinValidity', () => {
    const validTill = computeValidTill(new Date('2026-05-15T05:00:00.000Z'), 5); // last day 19 May

    test('valid through 23:59:59 IST on the last day', () => {
      expect(isWithinValidity(validTill, new Date('2026-05-19T18:29:59.999Z'))).toBe(true);
    });

    test('expired from 00:00 IST on the next day — no extra day', () => {
      expect(isWithinValidity(validTill, new Date('2026-05-19T18:30:00.000Z'))).toBe(false);
    });

    test('valid on the payment day itself', () => {
      expect(isWithinValidity(validTill, new Date('2026-05-15T05:00:00.000Z'))).toBe(true);
    });
  });
});
