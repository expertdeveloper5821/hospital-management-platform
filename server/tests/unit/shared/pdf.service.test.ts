import * as fc from 'fast-check';
import { PdfService, MedicalCardData } from '../../../src/shared/services/pdf.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * PDFKit encodes text as hex inside TJ operators, e.g. <484d532d30303031>.
 * Search for the hex-encoded form of `text` inside the raw PDF binary.
 * For strings that PDFKit may split with kerning, search a distinctive substring.
 */
function hexInPdf(buf: Buffer, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex');
  return buf.toString('binary').includes(hex);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: MedicalCardData = {
  patientId:    'HMS-0001',
  fullName:     'Priya Sharma',
  dateOfBirth:  new Date('1990-04-15'),
  gender:       'Female',
  bloodGroup:   'B+',
  mobileNumber: '9876543210',
  hospitalName: 'City General Hospital',
  primaryColor: '#1A73E8',
};

// Disables FlateDecode so the content stream is plain text and hex-searchable.
const UNCOMPRESSED = { compress: false };

// ─── U2-C-02: Example-based — required fields present in PDF ─────────────────

describe('PdfService.generateMedicalCard() — example-based', () => {
  let service: PdfService;

  beforeEach(() => { service = new PdfService(); });

  test('returns a non-empty Buffer', async () => {
    const buf = await service.generateMedicalCard(baseData);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('starts with PDF magic bytes %PDF', async () => {
    const buf = await service.generateMedicalCard(baseData);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('PDF stream contains patient ID', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.patientId)).toBe(true);
  });

  test('PDF stream contains patient last name', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // PDFKit kerns 'r'+'m' in Helvetica, splitting 'Sharma' → 'Shar' | kern | 'ma'
    expect(hexInPdf(buf, 'Shar')).toBe(true);
  });

  test('PDF stream contains gender', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // PDFKit kerns 'F'+'e' in Helvetica, splitting the TJ segment — search the post-kern run
    expect(hexInPdf(buf, 'emale')).toBe(true);
  });

  test('PDF stream contains blood group', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.bloodGroup!)).toBe(true);
  });

  test('PDF stream contains mobile number', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.mobileNumber)).toBe(true);
  });

  test('PDF metadata contains hospital name (Author field)', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(buf.toString('binary')).toContain(baseData.hospitalName);
  });

  test('PDF stream renders "—" when bloodGroup is omitted', async () => {
    const noBlood: MedicalCardData = { ...baseData, bloodGroup: undefined };
    const buf = await service.generateMedicalCard(noBlood, UNCOMPRESSED);
    // em-dash fallback character
    expect(hexInPdf(buf, '—') || hexInPdf(buf, '--') || hexInPdf(buf, '—')).toBe(true);
  });

  test('generates valid PDF with no optional fields', async () => {
    const minimal: MedicalCardData = {
      patientId:    'HMS-0099',
      fullName:     'Arjun Mehta',
      dateOfBirth:  new Date('1985-01-01'),
      gender:       'Male',
      mobileNumber: '9000000001',
      hospitalName: 'Apollo Clinic',
      primaryColor: '#E53935',
    };
    const buf = await service.generateMedicalCard(minimal);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('different primaryColor values produce different PDF content', async () => {
    const blue = { ...baseData, primaryColor: '#1A73E8' };
    const red  = { ...baseData, primaryColor: '#E53935' };
    const [b1, b2] = await Promise.all([
      service.generateMedicalCard(blue, UNCOMPRESSED),
      service.generateMedicalCard(red,  UNCOMPRESSED),
    ]);
    expect(b1.equals(b2)).toBe(false);
  });

  test('different hospitalName values produce different PDF content', async () => {
    const d1 = { ...baseData, hospitalName: 'City General Hospital' };
    const d2 = { ...baseData, hospitalName: 'Apollo Multi-Specialty Clinic' };
    const [b1, b2] = await Promise.all([
      service.generateMedicalCard(d1, UNCOMPRESSED),
      service.generateMedicalCard(d2, UNCOMPRESSED),
    ]);
    expect(b1.equals(b2)).toBe(false);
  });
});

// ─── U2-C-03: PBT — branding round-trip invariants ───────────────────────────

describe('PdfService.generateMedicalCard() — PBT', () => {
  let service: PdfService;

  beforeEach(() => { service = new PdfService(); });

  const hexColorArb = fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    )
    .map(([r, g, b]) =>
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
    );

  // ASCII-only names so PDFKit's hex encoding is predictable across kerning splits.
  const asciiNameArb = fc
    .stringOf(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
      { minLength: 2, maxLength: 30 },
    )
    .filter(s => s.trim().length >= 2);

  const medicalCardArb = fc.record<MedicalCardData>({
    patientId:    fc.stringMatching(/^HMS-\d{4}$/),
    fullName:     asciiNameArb,
    dateOfBirth:  fc.date({ min: new Date('1920-01-01'), max: new Date('2010-12-31') }),
    gender:       fc.constantFrom('Male', 'Female', 'Other'),
    mobileNumber: fc.stringMatching(/^\d{10}$/),
    bloodGroup:   fc.constantFrom('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'),
    hospitalName: asciiNameArb,
    primaryColor: hexColorArb,
  });

  test('any valid card data produces a well-formed PDF buffer', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data);
        expect(Buffer.isBuffer(buf)).toBe(true);
        expect(buf.length).toBeGreaterThan(100);
        expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('hospital name always appears in PDF metadata', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data, UNCOMPRESSED);
        // hospitalName is stored in the Author metadata field as a plain string
        expect(buf.toString('binary')).toContain(data.hospitalName);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('patient ID always appears in PDF content stream', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data, UNCOMPRESSED);
        expect(hexInPdf(buf, data.patientId)).toBe(true);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('mobile number always appears in PDF content stream', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data, UNCOMPRESSED);
        expect(hexInPdf(buf, data.mobileNumber)).toBe(true);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('different primaryColor values always produce different PDF content', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, hexColorArb, hexColorArb, async (data, c1, c2) => {
        if (c1 === c2) return;
        const [b1, b2] = await Promise.all([
          service.generateMedicalCard({ ...data, primaryColor: c1 }, UNCOMPRESSED),
          service.generateMedicalCard({ ...data, primaryColor: c2 }, UNCOMPRESSED),
        ]);
        expect(b1.equals(b2)).toBe(false);
      }),
      { numRuns: 20, seed: 42 },
    );
  });
});
