import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { PdfService, ReceiptData } from '../../../src/shared/services/pdf.service';

// PDFKit writes standard-font text as hex strings, split wherever Helvetica
// kerns a pair — so assertions search kerning-free substrings (digits,
// lowercase runs), the same as pdf.lab-receipt.test.ts.
function hexInPdf(buf: Buffer, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex');
  return buf.toString('binary').includes(hex);
}

const baseData: ReceiptData = {
  receiptNumber:              'pay-uuid-001',
  paymentDate:                new Date('2026-05-19T10:00:00Z'), // 03:30 PM IST
  hospitalName:               'City General Hospital',
  hospitalRegistrationNumber: 'REG-778899',
  hospitalAddress:            '321 Main Street, Mumbai, Maharashtra - 400001',
  patientName:                'Priya Sharma',
  patientId:                  'PAT-00000001',
  patientAge:                 34,
  patientGender:              'FEMALE',
  patientMobile:              '9876543210',
  description:                'Consultation fee',
  amountInr:                  1250.5,
  paymentMethod:              'CASH',
  transactionId:              'txn998877665544',
  createdBy:                  'reception desk',
};

const UNCOMPRESSED = { compress: false };

describe('PdfService.generateReceipt() — content', () => {
  const service = new PdfService();

  test('returns a non-empty Buffer starting with %PDF', async () => {
    const buf = await service.generateReceipt(baseData);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('letterhead: hospital name, registration number and "Address -" prefix', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(buf.toString('binary')).toContain(baseData.hospitalName); // metadata Author
    expect(hexInPdf(buf, 'eneral')).toBe(true);
    expect(hexInPdf(buf, '778899')).toBe(true);
    expect(hexInPdf(buf, 'Reg.')).toBe(true);
    expect(hexInPdf(buf, 'ddress - 321')).toBe(true);
  });

  test('omits the registration and address lines when the tenant has none', async () => {
    const buf = await service.generateReceipt(
      { ...baseData, hospitalRegistrationNumber: null, hospitalAddress: null }, UNCOMPRESSED,
    );
    expect(hexInPdf(buf, 'Reg.')).toBe(false);
    expect(hexInPdf(buf, 'ddress -')).toBe(false);
  });

  test('title, receipt number and IST date/time', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(buf.toString('binary')).toContain('Payment Receipt'); // metadata Subject
    expect(hexInPdf(buf, 'uuid-001')).toBe(true);
    expect(hexInPdf(buf, '03:30')).toBe(true);
    expect(hexInPdf(buf, 'IST')).toBe(true);
  });

  test('patient details: name, UHID, age/gender, mobile', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'harma')).toBe(true);
    expect(hexInPdf(buf, '00000001')).toBe(true);
    expect(hexInPdf(buf, '34 yr')).toBe(true);
    expect(hexInPdf(buf, 'emale')).toBe(true);
    expect(hexInPdf(buf, '9876543210')).toBe(true);
  });

  test('payment details: description, method label, transaction ID, creator, amount and words', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'onsultation f')).toBe(true);
    expect(hexInPdf(buf, 'ash')).toBe(true);         // "Cash", not the raw enum
    expect(hexInPdf(buf, 'CASH')).toBe(false);
    expect(hexInPdf(buf, '998877665544')).toBe(true);
    expect(hexInPdf(buf, 'ansaction ID')).toBe(true);
    expect(hexInPdf(buf, 'reception desk')).toBe(true);
    expect(hexInPdf(buf, '1,250.50')).toBe(true);
    expect(hexInPdf(buf, 'Thousand')).toBe(true);
  });

  test('prints a Razorpay payment ID as the transaction ID', async () => {
    const buf = await service.generateReceipt(
      { ...baseData, paymentMethod: 'UPI', transactionId: 'pay_rzp00112233' }, UNCOMPRESSED,
    );
    expect(hexInPdf(buf, 'UPI')).toBe(true);
    expect(hexInPdf(buf, 'rzp00112233')).toBe(true);
  });

  test('omits the optional rows when values are missing', async () => {
    const buf = await service.generateReceipt({
      ...baseData, transactionId: null, createdBy: null, patientAge: null, patientGender: null, patientMobile: null,
    }, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ansaction ID')).toBe(false);
    expect(hexInPdf(buf, 'reated By')).toBe(false);
    expect(hexInPdf(buf, 'ge / Gender')).toBe(false);
    expect(hexInPdf(buf, 'obile')).toBe(false);
  });

  test('carries no Lab-only rows', async () => {
    const buf = await service.generateReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'equest ID')).toBe(false);
    expect(hexInPdf(buf, 'eferred By')).toBe(false);
  });
});

describe('PdfService.generateReceipt() — same A5 print layout as the Lab receipt', () => {
  const service = new PdfService();

  test('single A5 portrait page', async () => {
    const pdf = await PdfLibDocument.load(await service.generateReceipt(baseData));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBe(419);
    expect(height).toBe(595);
  });

  test('all text and rules are pure black on a white page — no brand colour', async () => {
    const raw = (await service.generateReceipt(baseData, UNCOMPRESSED)).toString('binary');
    const ops = raw.match(/[\d.]+ [\d.]+ [\d.]+ (?:scn|SCN)/g) ?? [];
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.filter((op) => op !== '0 0 0 scn' && op !== '0 0 0 SCN')).toEqual(['1 1 1 scn']);
    expect(raw.match(/\nf\n/g)).toHaveLength(1); // only the white paper is filled
  });

  test('does not accept a brand colour input', () => {
    // @ts-expect-error — primaryColor is intentionally not part of ReceiptData.
    const withColour: ReceiptData = { ...baseData, primaryColor: '#1A73E8' };
    expect(withColour).toBeDefined();
  });

  test('keeps the signature line and footer on one page with maximum-length values', async () => {
    const long = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n);
    const buf = await service.generateReceipt({
      ...baseData,
      hospitalName: long(150), hospitalRegistrationNumber: 'x'.repeat(50), hospitalAddress: long(300),
      patientName: long(120), description: long(500), createdBy: long(120),
      transactionId: 'x'.repeat(100), amountInr: 9999999999.99,
    }, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ised Signator')).toBe(true);
    expect(hexInPdf(buf, 'computer-gener')).toBe(true);
    expect((await PdfLibDocument.load(buf)).getPageCount()).toBe(1);
  });
});
