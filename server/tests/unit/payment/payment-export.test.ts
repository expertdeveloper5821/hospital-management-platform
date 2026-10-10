jest.mock('../../../src/modules/payment/payment.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/modules/department/department.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/pdf.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('razorpay');

import { paymentRepository } from '../../../src/modules/payment/payment.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { tenantRepository }  from '../../../src/modules/tenant/tenant.repository';
import { PaymentService, MAX_EXPORT_ROWS } from '../../../src/modules/payment/payment.service';
import {
  resolveExportRange, toPaise, PaymentExportRangeError, paymentExportFilename, PaymentExportReport,
} from '../../../src/modules/payment/payment-export';
import * as exportPdf from '../../../src/modules/payment/payment-export.pdf';
import { IPayment } from '../../../src/modules/payment/payment.model';
import { ITenant }  from '../../../src/modules/tenant/tenant.model';
import { AppError } from '../../../src/shared/middleware/error-handler';

const mockPayRepo    = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockPatRepo    = patientRepository as jest.Mocked<typeof patientRepository>;
const mockTenantRepo = tenantRepository  as jest.Mocked<typeof tenantRepository>;

// 2026-10-09 14:00 IST (a Friday)
const NOW = new Date('2026-10-09T08:30:00.000Z');

describe('resolveExportRange (IST)', () => {
  test('DAILY defaults to today in IST, as a half-open IST-midnight range', () => {
    const r = resolveExportRange({ period: 'DAILY' }, NOW);
    expect(r.fromKey).toBe('2026-10-09');
    expect(r.toKey).toBe('2026-10-09');
    expect(r.from.toISOString()).toBe('2026-10-08T18:30:00.000Z');
    expect(r.toExclusive.toISOString()).toBe('2026-10-09T18:30:00.000Z');
  });

  test('DAILY uses the IST day even when UTC is still on the previous day', () => {
    // 2026-10-09 00:30 IST == 2026-10-08 19:00 UTC
    const r = resolveExportRange({ period: 'DAILY' }, new Date('2026-10-08T19:00:00.000Z'));
    expect(r.fromKey).toBe('2026-10-09');
  });

  test('DAILY for a past date', () => {
    const r = resolveExportRange({ period: 'DAILY', date: '2026-03-01' }, NOW);
    expect(r.fromKey).toBe('2026-03-01');
    expect(r.toKey).toBe('2026-03-01');
  });

  test('WEEKLY is the Monday–Sunday week containing the date', () => {
    const r = resolveExportRange({ period: 'WEEKLY', date: '2026-10-09' }, NOW);
    expect(r.fromKey).toBe('2026-10-05');
    expect(r.toKey).toBe('2026-10-11');
    // Sunday belongs to the week that started the previous Monday
    expect(resolveExportRange({ period: 'WEEKLY', date: '2026-10-04' }, NOW).fromKey).toBe('2026-09-28');
    // Monday starts its own week
    expect(resolveExportRange({ period: 'WEEKLY', date: '2026-10-05' }, NOW).fromKey).toBe('2026-10-05');
  });

  test('MONTHLY is the calendar month containing the date (incl. Feb / December)', () => {
    const feb = resolveExportRange({ period: 'MONTHLY', date: '2024-02-10' }, NOW);
    expect([feb.fromKey, feb.toKey]).toEqual(['2024-02-01', '2024-02-29']);
    const dec = resolveExportRange({ period: 'MONTHLY', date: '2025-12-31' }, NOW);
    expect([dec.fromKey, dec.toKey]).toEqual(['2025-12-01', '2025-12-31']);
    expect(dec.toExclusive.toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  test('CUSTOM is inclusive of both ends', () => {
    const r = resolveExportRange({ period: 'CUSTOM', dateFrom: '2026-09-01', dateTo: '2026-09-03' }, NOW);
    expect(r.from.toISOString()).toBe('2026-08-31T18:30:00.000Z');
    expect(r.toExclusive.toISOString()).toBe('2026-09-03T18:30:00.000Z');
  });

  test('rejects future dates and over-long custom ranges', () => {
    expect(() => resolveExportRange({ period: 'DAILY', date: '2026-10-10' }, NOW)).toThrow(PaymentExportRangeError);
    expect(() => resolveExportRange({ period: 'CUSTOM', dateFrom: '2026-10-01', dateTo: '2026-10-10' }, NOW)).toThrow(PaymentExportRangeError);
    expect(() => resolveExportRange({ period: 'CUSTOM', dateFrom: '2025-01-01', dateTo: '2026-10-09' }, NOW)).toThrow(/366/);
  });

  test('filename reflects period and span', () => {
    expect(paymentExportFilename(resolveExportRange({ period: 'DAILY' }, NOW))).toBe('payments-daily-2026-10-09.pdf');
    expect(paymentExportFilename(resolveExportRange({ period: 'WEEKLY' }, NOW))).toBe('payments-weekly-2026-10-05_to_2026-10-11.pdf');
  });
});

describe('amount helpers', () => {
  test('toPaise avoids floating point drift', () => {
    expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
    expect(toPaise(1234.56)).toBe(123456);
  });
});

// ─── PaymentService.exportPayments ────────────────────────────────────────────

function payment(i: number, method: string, amount: number, createdAt = new Date('2026-10-09T05:00:00.000Z')): IPayment {
  return {
    paymentId: `pay-${String(i).padStart(6, '0')}`, tenantId: 'tenant-001', patientId: 'PAT-NH01',
    fullName: 'Snapshot Name', amount, paymentMethod: method, description: 'OPD Consultation',
    transactionId: null, status: 'COMPLETED', createdAt,
  } as unknown as IPayment;
}

// The service hands the finished report to the PDF renderer; capture it to
// assert on rows and totals without parsing the PDF itself.
let pdfSpy: jest.SpyInstance;
function lastReport(): PaymentExportReport {
  return pdfSpy.mock.calls[pdfSpy.mock.calls.length - 1][0];
}

describe('PaymentService.exportPayments', () => {
  let service: PaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentService();
    mockTenantRepo.findById = jest.fn().mockResolvedValue({ name: 'Narayan Hospital', branding: { displayName: 'Narayan Hospital' } } as unknown as ITenant);
    mockPatRepo.findNamesByPatientIds = jest.fn().mockResolvedValue(new Map([['PAT-NH01', 'Asha Verma']]));
    mockPayRepo.countNonCompletedByStatus = jest.fn().mockResolvedValue({ PENDING: 2, CANCELLED: 1 });
    pdfSpy = jest.spyOn(exportPdf, 'buildPaymentExportPdf');
  });

  afterEach(() => pdfSpy.mockRestore());

  test('pages through every keyset page until a short page, passing the last row as the cursor', async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => payment(i, 'CASH', 10));
    const page2 = Array.from({ length: 500 }, (_, i) => payment(500 + i, 'UPI', 20));
    const page3 = Array.from({ length: 3 },   (_, i) => payment(1000 + i, 'CARD', 30.5));
    mockPayRepo.findCompletedExportPage = jest.fn()
      .mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce(page3);

    const { pdf, filename } = await service.exportPayments('tenant-001', { period: 'DAILY' }, 'fin@test.com', NOW);

    expect(filename).toBe('payments-daily-2026-10-09.pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mockPayRepo.findCompletedExportPage).toHaveBeenCalledTimes(3);
    const calls = mockPayRepo.findCompletedExportPage.mock.calls;
    expect(calls[0][3]).toBeNull();
    expect(calls[1][3]).toEqual({ createdAt: page1[499].createdAt, paymentId: 'pay-000499' });
    expect(calls[2][3]).toEqual({ createdAt: page2[499].createdAt, paymentId: 'pay-000999' });

    const report = lastReport();
    expect(report.rows).toHaveLength(1003);
    expect(report.methodTotals).toEqual({
      CASH:   { count: 500, paise: 500000 },
      UPI:    { count: 500, paise: 1000000 },
      CARD:   { count: 3,   paise: 9150 },
      CHEQUE: { count: 0,   paise: 0 },
    });
    expect(report.grandTotalPaise).toBe(1509150);
    expect(report.grandTotalPaise).toBe(report.rows.reduce((sum, r) => sum + r.amountPaise, 0));
    expect(report.excludedCounts).toEqual({ PENDING: 2, FAILED: 0, CANCELLED: 1 });
  });

  test('never double-counts a payment returned on two pages', async () => {
    const dup = payment(1, 'CASH', 100);
    mockPayRepo.findCompletedExportPage = jest.fn().mockResolvedValueOnce([dup, dup]);
    await service.exportPayments('tenant-001', { period: 'DAILY' }, 'x', NOW);
    expect(lastReport().rows).toHaveLength(1);
    expect(lastReport().grandTotalPaise).toBe(10000);
  });

  test('passes header metadata and the patient name from the patient record', async () => {
    mockPayRepo.findCompletedExportPage = jest.fn().mockResolvedValueOnce([
      payment(1, 'UPI', 250, new Date('2026-10-08T19:15:00.000Z')), // 2026-10-09 00:45 IST
    ]);
    await service.exportPayments('tenant-001', { period: 'DAILY' }, 'fin@test.com', NOW);
    const report = lastReport();
    expect(report.hospitalName).toBe('Narayan Hospital');
    expect(report.range).toMatchObject({ period: 'DAILY', fromKey: '2026-10-09', toKey: '2026-10-09' });
    expect(report.generatedAt).toBe(NOW);
    expect(report.generatedBy).toBe('fin@test.com');
    expect(report.rows[0]).toEqual({
      paymentId: 'pay-000001', createdAt: new Date('2026-10-08T19:15:00.000Z'), patientId: 'PAT-NH01',
      patientName: 'Asha Verma', description: 'OPD Consultation', paymentMethod: 'UPI',
      transactionId: null, amountPaise: 25000,
    });
  });

  test('empty period exports zero totals', async () => {
    mockPayRepo.findCompletedExportPage = jest.fn().mockResolvedValueOnce([]);
    const { pdf } = await service.exportPayments('tenant-001', { period: 'MONTHLY' }, 'x', NOW);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(lastReport().rows).toHaveLength(0);
    expect(lastReport().grandTotalPaise).toBe(0);
    expect(mockPatRepo.findNamesByPatientIds).not.toHaveBeenCalled();
  });

  test('a future date is a 400 AppError', async () => {
    await expect(service.exportPayments('tenant-001', { period: 'DAILY', date: '2026-12-01' }, 'x', NOW))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('fails with 422 instead of truncating when the row cap is exceeded', async () => {
    let n = 0;
    mockPayRepo.findCompletedExportPage = jest.fn().mockImplementation(async () =>
      Array.from({ length: 500 }, () => payment(n++, 'CASH', 1)));
    const err = await service.exportPayments('tenant-001', { period: 'DAILY' }, 'x', NOW).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(422);
    expect(n).toBeGreaterThan(MAX_EXPORT_ROWS);
  });
});
