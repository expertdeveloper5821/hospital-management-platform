import PDFDocument from 'pdfkit';
import {
  buildPaymentExportPdf, formatInr, formatDateKey,
} from '../../../src/modules/payment/payment-export.pdf';
import {
  resolveExportRange, PaymentExportReport, PaymentExportRow, PaymentExportMethodTotals,
} from '../../../src/modules/payment/payment-export';

const NOW = new Date('2026-10-09T08:30:00.000Z'); // 2026-10-09 14:00 IST

const PAGE_WIDTH  = 595.28;
const PAGE_HEIGHT = 841.89;

function report(rows: PaymentExportRow[]): PaymentExportReport {
  const methodTotals: PaymentExportMethodTotals = {
    CASH: { count: 0, paise: 0 }, UPI: { count: 0, paise: 0 },
    CARD: { count: 0, paise: 0 }, CHEQUE: { count: 0, paise: 0 },
  };
  let grandTotalPaise = 0;
  for (const r of rows) {
    const t = methodTotals[r.paymentMethod as keyof PaymentExportMethodTotals];
    t.count += 1; t.paise += r.amountPaise; grandTotalPaise += r.amountPaise;
  }
  return {
    hospitalName: 'Narayan Hospital',
    range:        resolveExportRange({ period: 'WEEKLY', date: '2026-10-09' }, NOW),
    generatedAt:  NOW,
    generatedBy:  'fin@test.com',
    rows, methodTotals, grandTotalPaise,
    excludedCounts: { PENDING: 2, FAILED: 0, CANCELLED: 1 },
  };
}

function row(i: number, overrides: Partial<PaymentExportRow> = {}): PaymentExportRow {
  return {
    paymentId:     `pay-${String(i).padStart(6, '0')}`,
    createdAt:     new Date(NOW.getTime() - i * 60_000),
    patientId:     `PAT-NH${i + 1}`,
    patientName:   'Asha Verma',
    description:   'OPD Consultation',
    paymentMethod: ['CASH', 'UPI', 'CARD'][i % 3],
    transactionId: i % 3 === 1 ? `UTR${100000000000 + i}` : null,
    amountPaise:   50000 + i,
    ...overrides,
  };
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

// Records every string drawn, with where it was drawn.
function captureText(): { calls: Array<{ text: string; x: number; y: number; width?: number }>; restore: () => void } {
  const calls: Array<{ text: string; x: number; y: number; width?: number }> = [];
  const original = PDFDocument.prototype.text;
  const spy = jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (this: PDFKit.PDFDocument, ...args: any[]) {
    const [text, x, y, opts] = args;
    if (typeof x === 'number' && typeof y === 'number') {
      calls.push({ text: String(text), x, y, width: opts?.width });
    }
    return (original as any).apply(this, args);
  });
  return { calls, restore: () => spy.mockRestore() };
}

describe('formatInr', () => {
  test('uses Indian digit grouping with two decimals', () => {
    expect(formatInr(0)).toBe('0.00');
    expect(formatInr(5)).toBe('0.05');
    expect(formatInr(99999)).toBe('999.99');
    expect(formatInr(123456)).toBe('1,234.56');
    expect(formatInr(12345678)).toBe('1,23,456.78');
    expect(formatInr(123456789012)).toBe('1,23,45,67,890.12');
  });
});

describe('formatDateKey', () => {
  test('renders YYYY-MM-DD as DD Mon YYYY', () => {
    expect(formatDateKey('2026-10-09')).toBe('09 Oct 2026');
    expect(formatDateKey('2025-01-31')).toBe('31 Jan 2025');
  });
});

describe('buildPaymentExportPdf', () => {
  test('produces a single-page PDF with the summary for a small report', async () => {
    const cap = captureText();
    const pdf = await buildPaymentExportPdf(report([row(0), row(1), row(2)]));
    cap.restore();

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    const texts = cap.calls.map((c) => c.text);
    expect(texts).toEqual(expect.arrayContaining([
      'Narayan Hospital', 'Payment Collection Report', 'Weekly', '05 Oct 2026 – 11 Oct 2026',
      '09 Oct 2026, 14:00 IST', 'fin@test.com',
      'Total Collections', 'Transactions', 'Cash', 'UPI', 'Card', 'Grand Total',
      '1,500.03',                       // grand total (50000 + 50001 + 50002 paise)
      'Asha Verma\nPAT-NH2',
      'pay-000001\nRef: UTR100000000001',
      'Page 1 of 1',
    ]));
    // Cheque is listed only when used, so the visible lines add up to the total.
    expect(texts).not.toContain('Cheque');
  });

  test('flows long tables onto further pages with the column header repeated', async () => {
    const cap = captureText();
    const pdf = await buildPaymentExportPdf(report(Array.from({ length: 120 }, (_, i) => row(i))));
    cap.restore();

    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(2);
    expect(cap.calls.filter((c) => c.text === 'Receipt / Ref No.')).toHaveLength(pages);
    expect(cap.calls.filter((c) => /^Page \d+ of \d+$/.test(c.text))).toHaveLength(pages);
    expect(cap.calls.some((c) => c.text === `Page ${pages} of ${pages}`)).toBe(true);
    // Every row is printed exactly once.
    for (let i = 0; i < 120; i++) {
      expect(cap.calls.filter((c) => c.text.startsWith(`pay-${String(i).padStart(6, '0')}`))).toHaveLength(1);
    }
  });

  test('never draws text outside the printable area, even with long names, descriptions and amounts', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i, i % 10 === 0 ? {
      patientName:   'Venkatanarasimharajuvaripeta Subramanyam Krishnamurthy '.repeat(3),
      description:   'OPD Consultation – follow-up review with extended billing notes '.repeat(10),
      transactionId: 'UTR-VERY-LONG-REFERENCE-NUMBER-1234567890',
      amountPaise:   9_999_999_999,
    } : {}));
    const cap = captureText();
    const pdf = await buildPaymentExportPdf(report(rows));
    cap.restore();

    expect(pageCount(pdf)).toBeGreaterThan(1);
    for (const c of cap.calls) {
      expect(c.x).toBeGreaterThanOrEqual(40 - 0.01);
      expect(c.y).toBeGreaterThanOrEqual(40 - 0.01);
      expect(c.y).toBeLessThan(PAGE_HEIGHT - 40);
      if (c.width !== undefined) expect(c.x + c.width).toBeLessThanOrEqual(PAGE_WIDTH - 40 + 0.01);
    }
  });

  test('an empty period still renders the summary with zero totals', async () => {
    const cap = captureText();
    const pdf = await buildPaymentExportPdf(report([]));
    cap.restore();

    expect(pageCount(pdf)).toBe(1);
    const texts = cap.calls.map((c) => c.text);
    expect(texts).toContain('No completed payments in this period.');
    expect(texts).toContain('0.00');
    expect(texts).toContain('Grand Total (0 transactions)');
  });
});
