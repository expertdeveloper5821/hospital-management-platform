import * as fc from 'fast-check';
import { PDFService, MedicalCardData } from '../../../src/shared/services/pdf.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseData: MedicalCardData = {
  patientId:        'HMS-0001',
  name:             'Priya Sharma',
  dateOfBirth:      new Date('1990-04-15'),
  gender:           'Female',
  bloodGroup:       'B+',
  contactNumber:    '9876543210',
  address:          '42 MG Road, Bengaluru, Karnataka 560001',
  emergencyContact: 'Rohit Sharma - 9812345678',
  tenantBranding: {
    displayName:  'City General Hospital',
    primaryColor: '#1A73E8',
  },
  issuedAt: new Date('2026-05-14T00:00:00.000Z'),
};

// Uncompressed option — makes the content stream directly text-searchable.
const UNCOMPRESSED = { compress: false };

/**
 * PDFKit encodes text as hex strings inside TJ operators, e.g. <484d532d30303031>.
 * This helper checks whether the hex-encoded form of `text` appears anywhere in
 * the raw PDF binary. For strings split by kerning values, test a distinctive
 * substring rather than the full value.
 */
function hexInPdf(buf: Buffer, text: string): boolean {
  const hex = Buffer.from(text, 'latin1').toString('hex');
  return buf.toString('binary').includes(hex);
}

// ─── U2-C-02: Example-based — required fields present ────────────────────────

describe('PDFService.generateMedicalCard() — example-based', () => {
  let service: PDFService;

  beforeEach(() => {
    service = new PDFService();
  });

  test('returns a non-empty Buffer', async () => {
    const buf = await service.generateMedicalCard(baseData);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('output starts with PDF magic bytes %PDF', async () => {
    const buf = await service.generateMedicalCard(baseData);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('PDF stream contains patient ID', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.patientId)).toBe(true);
  });

  test('PDF stream contains patient last name', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // "Sharma" is a unique substring unlikely to be split by kerning
    expect(hexInPdf(buf, 'Sharma')).toBe(true);
  });

  test('PDF stream contains blood group', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.bloodGroup)).toBe(true);
  });

  test('PDF stream contains contact number', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.contactNumber)).toBe(true);
  });

  test('PDF stream contains hospital display name', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // Display name is also in PDF metadata as a plain string
    expect(buf.toString('binary')).toContain(baseData.tenantBranding.displayName);
  });

  test('PDF stream contains gender', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    expect(hexInPdf(buf, baseData.gender)).toBe(true);
  });

  test('optional address field is included when provided', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // "MG Road" is a distinctive address substring
    expect(hexInPdf(buf, 'MG Road')).toBe(true);
  });

  test('optional emergencyContact field is included when provided', async () => {
    const buf = await service.generateMedicalCard(baseData, UNCOMPRESSED);
    // "Rohit" is a distinctive emergency contact substring
    expect(hexInPdf(buf, 'Rohit')).toBe(true);
  });

  test('generates valid PDF without optional fields', async () => {
    const minimal: MedicalCardData = {
      patientId:     'HMS-0002',
      name:          'Arjun Mehta',
      dateOfBirth:   new Date('1985-01-01'),
      gender:        'Male',
      bloodGroup:    'O+',
      contactNumber: '9000000001',
      tenantBranding: {
        displayName:  'Apollo Clinic',
        primaryColor: '#E53935',
      },
    };
    const buf = await service.generateMedicalCard(minimal);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  test('defaults issuedAt to current date when not provided', async () => {
    const data = { ...baseData, issuedAt: undefined };
    const buf  = await service.generateMedicalCard(data, UNCOMPRESSED);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('different primary colors produce different PDF content', async () => {
    const blueData = { ...baseData, tenantBranding: { ...baseData.tenantBranding, primaryColor: '#1A73E8' } };
    const redData  = { ...baseData, tenantBranding: { ...baseData.tenantBranding, primaryColor: '#E53935' } };

    const [blueBuf, redBuf] = await Promise.all([
      service.generateMedicalCard(blueData, UNCOMPRESSED),
      service.generateMedicalCard(redData,  UNCOMPRESSED),
    ]);

    expect(blueBuf.equals(redBuf)).toBe(false);
  });

  test('same input with fixed issuedAt produces identical PDFs (deterministic)', async () => {
    const fixed = { ...baseData, issuedAt: new Date('2026-01-01T00:00:00.000Z') };
    const [buf1, buf2] = await Promise.all([
      service.generateMedicalCard(fixed, UNCOMPRESSED),
      service.generateMedicalCard(fixed, UNCOMPRESSED),
    ]);
    expect(buf1.equals(buf2)).toBe(true);
  });
});

// ─── U2-C-03: PBT — branding round-trip invariants ───────────────────────────

describe('PDFService.generateMedicalCard() — PBT', () => {
  let service: PDFService;

  beforeEach(() => {
    service = new PDFService();
  });

  const hexColorArb = fc
    .tuple(
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    )
    .map(([r, g, b]) => `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);

  const genderArb = fc.constantFrom<'Male' | 'Female' | 'Other'>('Male', 'Female', 'Other');

  // Restrict to ASCII alphanumeric + space to avoid kerning splits and encoding edge cases.
  const safeStringArb = (min: number, max: number) =>
    fc.stringOf(
      fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
      { minLength: min, maxLength: max },
    ).filter(s => s.trim().length >= min);

  const medicalCardArb = fc.record<MedicalCardData>({
    patientId:     fc.stringMatching(/^HMS-\d{4}$/),
    name:          safeStringArb(2, 30),
    dateOfBirth:   fc.date({ min: new Date('1920-01-01'), max: new Date('2010-12-31') }),
    gender:        genderArb,
    bloodGroup:    fc.constantFrom('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'),
    contactNumber: fc.stringMatching(/^\d{10}$/),
    tenantBranding: fc.record({
      displayName:  safeStringArb(2, 30),
      primaryColor: hexColorArb,
    }),
    issuedAt: fc.constant(new Date('2026-01-01T00:00:00.000Z')),
  });

  test('any valid medical card data produces a valid PDF buffer', async () => {
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

  test('hospital display name always appears in generated PDF', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data, UNCOMPRESSED);
        // Display name is stored as a plain PDF string in metadata (Author field)
        expect(buf.toString('binary')).toContain(data.tenantBranding.displayName);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('patient ID always appears in generated PDF', async () => {
    await fc.assert(
      fc.asyncProperty(medicalCardArb, async (data) => {
        const buf = await service.generateMedicalCard(data, UNCOMPRESSED);
        expect(hexInPdf(buf, data.patientId)).toBe(true);
      }),
      { numRuns: 50, seed: 42 },
    );
  });

  test('PDF size grows when optional fields are included', async () => {
    const withOptionals: MedicalCardData = {
      ...baseData,
      address:          '1 Main Street',
      emergencyContact: '1234567890',
      issuedAt:         new Date('2026-01-01T00:00:00.000Z'),
    };
    const withoutOptionals: MedicalCardData = {
      patientId:     baseData.patientId,
      name:          baseData.name,
      dateOfBirth:   baseData.dateOfBirth,
      gender:        baseData.gender,
      bloodGroup:    baseData.bloodGroup,
      contactNumber: baseData.contactNumber,
      tenantBranding: baseData.tenantBranding,
      issuedAt:      new Date('2026-01-01T00:00:00.000Z'),
    };
    const [bufWith, bufWithout] = await Promise.all([
      service.generateMedicalCard(withOptionals,    UNCOMPRESSED),
      service.generateMedicalCard(withoutOptionals, UNCOMPRESSED),
    ]);
    expect(bufWith.length).toBeGreaterThan(bufWithout.length);
  });

  test('branding color change always produces different PDF content', async () => {
    await fc.assert(
      fc.asyncProperty(
        medicalCardArb,
        hexColorArb,
        hexColorArb,
        async (data, color1, color2) => {
          if (color1 === color2) return;
          const d1 = { ...data, tenantBranding: { ...data.tenantBranding, primaryColor: color1 } };
          const d2 = { ...data, tenantBranding: { ...data.tenantBranding, primaryColor: color2 } };
          const [b1, b2] = await Promise.all([
            service.generateMedicalCard(d1, UNCOMPRESSED),
            service.generateMedicalCard(d2, UNCOMPRESSED),
          ]);
          expect(b1.equals(b2)).toBe(false);
        },
      ),
      { numRuns: 20, seed: 42 },
    );
  });
});
