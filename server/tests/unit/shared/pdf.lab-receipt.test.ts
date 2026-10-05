import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { PdfService, LabReceiptData, amountInWords } from '../../../src/shared/services/pdf.service';

// PDFKit writes standard-font text as hex strings, split wherever Helvetica
// kerns a pair — so assertions search kerning-free substrings (digits,
// lowercase runs) the same way pdf.receipt.test.ts does.
function hexInPdf(buf: Buffer, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex');
  return buf.toString('binary').includes(hex);
}

const baseData: LabReceiptData = {
  receiptNumber:              '7f3c2a10-5b6e-4d8f-9a01-123456789abc',
  paymentDate:                new Date('2026-05-19T10:00:00Z'), // 03:30 PM IST
  hospitalName:               'City General Hospital',
  hospitalRegistrationNumber: 'REG-778899',
  hospitalAddress:            '321 Lab Street, Mumbai, Maharashtra - 400001',
  patientName:                'John Doe',
  patientId:                  'PAT-00000042',
  patientAge:                 46,
  patientGender:              'MALE',
  patientMobile:              '9876543210',
  labCategory:                'PATHOLOGY',
  labRequestId:               'a1b2c3d4-e5f6-4711-8899-001122334455',
  testName:                   'complete blood count',
  referredBy:                 'Dr. smith',
  createdBy:                  'reception desk',
  amountInr:                  1250.5,
  paymentMethod:              'UPI',
  transactionId:              'txn998877665544',
};

const UNCOMPRESSED = { compress: false };

// A5 portrait in PostScript points, matching the existing generic receipt.
const A5_WIDTH  = 419;
const A5_HEIGHT = 595;

describe('PdfService.generateLabReceipt() — content', () => {
  const service = new PdfService();

  test('returns a PDF buffer', async () => {
    const buf = await service.generateLabReceipt(baseData);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('contains hospital name (metadata), registration number and address', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(buf.toString('binary')).toContain('City General Hospital');
    expect(hexInPdf(buf, '778899')).toBe(true);
    expect(hexInPdf(buf, '400001')).toBe(true);
    expect(hexInPdf(buf, 'Mumbai')).toBe(true);
  });

  test('contains patient name, UHID, age and mobile', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ohn Doe') || hexInPdf(buf, 'John Doe')).toBe(true);
    expect(hexInPdf(buf, '00000042')).toBe(true);
    expect(hexInPdf(buf, '46 yr')).toBe(true);
    expect(hexInPdf(buf, '9876543210')).toBe(true);
  });

  test('contains lab request ID, test name, referred-by and created-by', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, '001122334455')).toBe(true);
    expect(hexInPdf(buf, 'lood count')).toBe(true);
    expect(hexInPdf(buf, 'smith')).toBe(true);
    expect(hexInPdf(buf, 'reception desk')).toBe(true);
  });

  test('contains receipt number, amount, payment method and transaction ID', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, '123456789abc')).toBe(true);
    expect(hexInPdf(buf, '1,250.50')).toBe(true);
    expect(hexInPdf(buf, 'UPI')).toBe(true);
    expect(hexInPdf(buf, 'txn998877665544')).toBe(true);
  });

  test('prints the payment date and time in IST', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, '19 Ma')).toBe(true);
    expect(hexInPdf(buf, 'y 2026,')).toBe(true);
    expect(hexInPdf(buf, ' 03:30 PM IST')).toBe(true);
  });

  test('labels the test row per category', async () => {
    const path = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    const rad  = await service.generateLabReceipt({ ...baseData, labCategory: 'RADIOLOGY' }, UNCOMPRESSED);
    expect(hexInPdf(path, 'athology ')).toBe(true);
    expect(hexInPdf(rad,  'ging ')).toBe(true);
    expect(hexInPdf(path, 'ging ')).toBe(false);
    expect(hexInPdf(rad,  'athology')).toBe(false);
  });

  test('omits the Transaction ID row when there is none', async () => {
    const buf = await service.generateLabReceipt({ ...baseData, transactionId: null }, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ransaction ID')).toBe(false);
  });

  test('omits the registration line when no registration number is available', async () => {
    const buf = await service.generateLabReceipt({ ...baseData, hospitalRegistrationNumber: null }, UNCOMPRESSED);
    expect(hexInPdf(buf, '778899')).toBe(false);
  });
});

describe('PdfService.generateLabReceipt() — A5 layout', () => {
  const service = new PdfService();

  test('is exactly one A5 portrait page', async () => {
    const pdf = await PdfLibDocument.load(await service.generateLabReceipt(baseData));
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.round(width)).toBe(A5_WIDTH);
    expect(Math.round(height)).toBe(A5_HEIGHT);
  });

  test('stays on a single A5 page with maximum-length values', async () => {
    const long = (n: number) => 'x'.repeat(n);
    const pdf = await PdfLibDocument.load(await service.generateLabReceipt({
      ...baseData,
      hospitalName:               `Very Long Hospital Name ${long(150)}`,
      hospitalRegistrationNumber: long(50),
      hospitalAddress:            `Address ${long(300)}`,
      patientName:                long(120),
      testName:                   long(200),   // lab.model maxlength
      referredBy:                 long(120),
      createdBy:                  long(120),
      transactionId:              long(100),   // CollectLabPaymentSchema max
      amountInr:                  9999999999.99,
    }));
    expect(pdf.getPageCount()).toBe(1);
  });

  test('stays on a single page for the radiology variant without optional fields', async () => {
    const pdf = await PdfLibDocument.load(await service.generateLabReceipt({
      ...baseData,
      labCategory: 'RADIOLOGY', hospitalRegistrationNumber: null, hospitalAddress: null,
      patientAge: null, patientGender: null, patientMobile: null, transactionId: null,
    }));
    expect(pdf.getPageCount()).toBe(1);
  });
});

describe('PdfService.generateLabReceipt() — print-ready black-on-white design', () => {
  const service = new PdfService();

  // Every colour operator PDFKit emitted: "<r g b> scn" (fill/text) or
  // "<r g b> SCN" (stroke).
  const colourOps = (raw: string): string[] =>
    raw.match(/[\d.]+ [\d.]+ [\d.]+ (?:scn|SCN)/g) ?? [];

  test('all text and rules are pure black — no brand or grey colour anywhere', async () => {
    const raw = (await service.generateLabReceipt(baseData, UNCOMPRESSED)).toString('binary');
    const ops = colourOps(raw);
    expect(ops.length).toBeGreaterThan(0);
    // The single non-black colour is the white paper fill.
    expect(ops.filter((op) => op !== '0 0 0 scn' && op !== '0 0 0 SCN')).toEqual(['1 1 1 scn']);
  });

  test('the only filled shape is the white page background', async () => {
    const raw = (await service.generateLabReceipt(baseData, UNCOMPRESSED)).toString('binary');
    expect(raw.match(/\nf\n/g)).toHaveLength(1);
    expect(raw).toMatch(/0 0 419 595 re\n\/DeviceRGB cs\n1 1 1 scn\nf\n/);
  });

  test('has no page frame or title box — the amount box is the only outlined shape', async () => {
    const raw = (await service.generateLabReceipt(baseData, UNCOMPRESSED)).toString('binary');
    // Rectangles are the paper fill plus any outlined shape (stroke colour set
    // right after `re`); only the amount box is outlined.
    expect(raw.match(/ re\n/g)).toHaveLength(2);
    expect(raw.match(/ re\n\/DeviceRGB CS\n/g)).toHaveLength(1);
  });

  test('prefixes the hospital address with "Address -"', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ddress - 321')).toBe(true);
  });

  test('omits the address line entirely when no address is available', async () => {
    const buf = await service.generateLabReceipt({ ...baseData, hospitalAddress: null }, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ddress -')).toBe(false);
  });

  test('does not accept a brand colour input', () => {
    // @ts-expect-error — primaryColor is intentionally not part of LabReceiptData.
    const withColour: LabReceiptData = { ...baseData, primaryColor: '#1A73E8' };
    expect(withColour).toBeDefined();
  });

  test('shows the amount in words', async () => {
    const buf = await service.generateLabReceipt(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, 'Thousand')).toBe(true);
    expect(hexInPdf(buf, 'aise Only')).toBe(true);
  });

  test('keeps the signature line and footer with maximum-length values (compact layout)', async () => {
    const long = (n: number) => 'word '.repeat(Math.ceil(n / 5)).slice(0, n);
    const buf = await service.generateLabReceipt({
      ...baseData,
      hospitalName: long(150), hospitalRegistrationNumber: 'x'.repeat(50), hospitalAddress: long(300),
      patientName: long(120), testName: long(200), referredBy: long(120), createdBy: long(120),
      transactionId: 'x'.repeat(100), amountInr: 9999999999.99,
    }, UNCOMPRESSED);
    expect(hexInPdf(buf, 'ised Signator')).toBe(true);
    expect(hexInPdf(buf, 'computer-gener')).toBe(true);
    expect((await PdfLibDocument.load(buf)).getPageCount()).toBe(1);
  });
});

describe('amountInWords()', () => {
  test.each([
    [1,             'Rupees One Only'],
    [450,           'Rupees Four Hundred Fifty Only'],
    [1250.5,        'Rupees One Thousand Two Hundred Fifty and Fifty Paise Only'],
    [100000,        'Rupees One Lakh Only'],
    [2345678.09,    'Rupees Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Nine Paise Only'],
    [10000000,      'Rupees One Crore Only'],
    [0.75,          'Rupees Zero and Seventy Five Paise Only'],
    [9999999999.99, 'Rupees Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only'],
  ])('%p → %s', (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });
});
