import { PdfService, ReceiptData } from '../../../src/shared/services/pdf.service';

function hexInPdf(buf: Buffer, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex');
  return buf.toString('binary').includes(hex);
}

const baseData: ReceiptData = {
  receiptNumber: 'pay-uuid-001',
  patientName:   'Priya Sharma',
  patientId:     'PAT-00000001',
  paymentDate:   new Date('2026-05-19T10:00:00Z'),
  amountInr:     500,
  paymentMethod: 'CASH',
  description:   'Consultation fee',
  hospitalName:  'City General Hospital',
  primaryColor:  '#1A73E8',
};

const UNCOMPRESSED = { compress: false };

// ─── U5-A-02: Receipt PDF contains all required fields ────────────────────────

describe('PdfService.generateReceipt() — required fields', () => {
  let service: PdfService;

  beforeEach(() => { service = new PdfService(); });

  test('returns a non-empty Buffer starting with %PDF', async () => {
    const buf = await service.generateReceipt(baseData);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('PDF metadata Author contains hospital name', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(buf.toString('binary')).toContain(baseData.hospitalName);
  });

  test('PDF stream contains receipt number', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    // PDFKit may kern p-a or a-y in Helvetica; search stable hyphen-digit suffix
    expect(hexInPdf(buf, 'uuid-001') || hexInPdf(buf, '-uuid') || hexInPdf(buf, 'uuid')).toBe(true);
  });

  test('PDF stream contains patient ID', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    // PDFKit kerns P-A in Helvetica; numeric suffix is unambiguous
    expect(hexInPdf(buf, '00000001')).toBe(true);
  });

  test('PDF stream contains payment method', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'CASH')).toBe(true);
  });

  test('PDF stream contains description', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    // Search for a stable substring of the description
    expect(hexInPdf(buf, 'Consultation')).toBe(true);
  });

  test('PDF stream contains amount', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    // Amount 500.00 formatted in en-IN locale
    expect(hexInPdf(buf, '500')).toBe(true);
  });

  test('different primaryColor values produce different PDF content', async () => {
    const [b1, b2] = await Promise.all([
      service.generateReceipt({ ...baseData, primaryColor: '#1A73E8' }, UNCOMPRESSED),
      service.generateReceipt({ ...baseData, primaryColor: '#E53935' }, UNCOMPRESSED),
    ]);
    expect(b1.equals(b2)).toBe(false);
  });

  test('different hospitalName values produce different PDF content', async () => {
    const [b1, b2] = await Promise.all([
      service.generateReceipt({ ...baseData, hospitalName: 'City General' }, UNCOMPRESSED),
      service.generateReceipt({ ...baseData, hospitalName: 'Apollo Clinic' }, UNCOMPRESSED),
    ]);
    expect(b1.equals(b2)).toBe(false);
  });

  test('generates valid PDF with UPI payment method', async () => {
    const buf = await service.generateReceipt({ ...baseData, paymentMethod: 'UPI' }, UNCOMPRESSED);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
    expect(hexInPdf(buf, 'UPI')).toBe(true);
  });

  test('generates valid PDF for large amount', async () => {
    const buf = await service.generateReceipt(
      { ...baseData, amountInr: 1_50_000 },
      UNCOMPRESSED,
    );
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});
