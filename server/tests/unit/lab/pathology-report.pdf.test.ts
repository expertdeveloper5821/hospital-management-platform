import zlib from 'zlib';
import { buildPathologyReportPdf, PathologyReportPdfData } from '../../../src/modules/lab/pathology-report.pdf';
import { PathologyResultValue } from '../../../src/modules/lab/lab.types';
import { DOCTOR_SIGNATURE_IMAGE } from '../../../src/modules/lab/doctor-signature.image';

// Decompresses every FlateDecode content stream so assertions run on the
// actual drawn text (same helper approach as discharge-summary.pdf.test.ts).
function contentOf(buf: Buffer): string {
  const parts: string[] = [];
  let idx = 0;
  for (;;) {
    const start = buf.indexOf('stream', idx);
    if (start === -1) break;
    let dataStart = start + 'stream'.length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = buf.indexOf('endstream', dataStart);
    if (end === -1) break;
    try { parts.push(zlib.inflateSync(buf.subarray(dataStart, end)).toString('latin1')); } catch { /* not Flate */ }
    idx = end + 'endstream'.length;
  }
  return parts.join('\n');
}

// PDFKit writes text as hex glyph strings split into kerned TJ fragments —
// decode every fragment in drawing order and search the joined text.
function textOf(pdf: Buffer): string {
  return [...contentOf(pdf).matchAll(/<([0-9a-fA-F]*)>/g)]
    .map((m) => Buffer.from(m[1], 'hex').toString('latin1'))
    .join('');
}
const has = (pdf: Buffer, text: string) => textOf(pdf).includes(text);
// Text-matrix position (x, y — PDF y-up) of the signing doctor's name.
const signatureAt = (content: string): RegExpMatchArray => {
  const hex = Buffer.from('Dr Manish').toString('hex');
  const m = content.match(new RegExp(String.raw`1 0 0 1 ([\d.]+) ([\d.]+) Tm\s+/F\d+ [\d.]+ Tf\s+\[<${hex}`));
  expect(m).not.toBeNull();
  return m!;
};
// 1x1 PNG, standing in for the signature image.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

const value = (o: Partial<PathologyResultValue> & { key: string; name: string; value: string }): PathologyResultValue => ({
  section: null, unit: null, referenceRange: null, flag: null, ...o,
});

function makeData(overrides: Partial<PathologyReportPdfData> = {}): PathologyReportPdfData {
  return {
    hospital: {
      name: 'Lab Test Hospital', logoUrl: null, primaryColor: '#0f5c8a',
      address: '321 Lab Street, Mumbai, Maharashtra - 400001', email: 'admin@labtest.com', registrationNumber: 'GST001',
    },
    patient: {
      fullName: 'John Doe', patientId: 'PAT-001', age: 45, gender: 'MALE',
      mobileNumber: '1234567890', address: '123 Test Street',
    },
    request: { requestId: '11111111-1111-4111-8111-111111111111', requestedAt: '2026-05-19T10:00:00.000Z', referredByName: 'Lab Doctor' },
    encounter: {
      type: 'OPD', encounterId: 'OPD-LABTEST01', date: '2026-05-19T00:00:00.000Z',
      departmentName: 'Cardiology', doctorNames: ['Lab Doctor'], wardName: null, bedNumber: null,
    },
    test: {
      testName: 'CBC (Complete Blood Count)',
      values: [
        value({ key: 'hemoglobin', name: 'Haemoglobin (Hb)', value: '10.2', unit: 'g/dL', referenceRange: '13.0 - 17.0', flag: 'LOW' }),
        value({ key: 'wbc', name: 'Total Leucocyte Count (TLC / WBC)', value: '12500', unit: 'cells/µL', referenceRange: '4000 - 11000', flag: 'HIGH' }),
        value({ key: 'neutrophils', name: 'Neutrophils', value: '60', unit: '%', referenceRange: '40 - 80', section: 'Differential Leucocyte Count' }),
      ],
      clinicalNote: 'Values may vary with hydration status.',
      comment:      null,
    },
    correlateClinically: 'Findings pertain only to the sample tested; interpret with clinical history.',
    reportedByName: 'Lab Pathologist',
    reportedAt:     '2026-05-20T06:30:00.000Z',
    ...overrides,
  };
}

describe('buildPathologyReportPdf', () => {
  test('produces a single-page A4 PDF for a typical test', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pageCount(pdf)).toBe(1);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  test('carries the patient/UHID, encounter, test, results, units, ranges and dates', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of [
      'John Doe 45/M', 'PAT-001', 'Lab Doctor', 'Cardiology',
      'Collection Date', '19 May 2026', 'Reporting Date', '20 May 2026',
      'CBC (Complete Blood Count)', 'Haemoglobin (Hb)', '10.2', 'g/dL', '13.0 - 17.0',
      'Differential Leucocyte Count', 'Clinical Notes', 'Values may vary with hydration status.',
      'Please Correlate Clinically', 'Findings pertain only to the sample tested; interpret with clinical history.',
    ]) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: true });
    }
  });

  test('the details grid has no Doctor field; Referred By stays', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      request:   { ...makeData().request, referredByName: 'Referring Doc' },
      encounter: { ...makeData().encounter!, doctorNames: ['Visit Doctor'] },
    }));
    expect(has(pdf, 'Doctor: ')).toBe(false);
    expect(has(pdf, 'Visit Doctor')).toBe(false);
    expect(has(pdf, 'Referred By: ')).toBe(true);
    expect(has(pdf, 'Referring Doc')).toBe(true);
    // The signing doctor in the signature block is unaffected.
    expect(has(pdf, 'Dr Manish Kumar')).toBe(true);
    expect(has(pdf, 'MBBS, MD Path')).toBe(true);
  });

  test('has no hospital header, reporter details, request date or request id', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of [
      'Lab Test Hospital', '321 Lab Street', 'admin@labtest.com', 'GSTIN', 'GST001',
      'Requested On', 'Lab Request ID', '11111111-1111-4111-8111-111111111111',
      'Pathologist', 'Reported By', 'Reported On', 'Department of Pathology',
    ]) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: false });
    }
  });

  test('is plain black-on-white: no colour, no filled bars/backgrounds, no hospital logo', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      hospital: { ...makeData().hospital, logoUrl: 'http://127.0.0.1:1/logo.png', primaryColor: '#ff0000' },
    }));
    const content = contentOf(pdf);
    const colours = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:scn|SCN)/g)].map((m) => m.slice(1, 4).join(' '));
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.every((c) => c === '0 0 0')).toBe(true);
    expect(content).not.toMatch(/re\s+f/);          // no filled rectangles
    // The only image drawn is the doctor's signature (none while it is unset).
    expect(content.match(/\/I\d+ Do/g) ?? []).toHaveLength(DOCTOR_SIGNATURE_IMAGE ? 1 : 0);
  });

  test('IPD encounters print ward / bed (no admission date, no OPD visit id)', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      encounter: {
        type: 'IPD', encounterId: 'ADM-1', date: '2026-05-18T00:00:00.000Z',
        departmentName: null, doctorNames: [], wardName: 'Ward A', bedNumber: 'B-12',
      },
    }));
    expect(has(pdf, 'Ward A / B-12')).toBe(true);
    expect(has(pdf, 'Admission Date')).toBe(false);
    expect(has(pdf, '18 May 2026')).toBe(false);
    expect(has(pdf, 'OPD Visit ID')).toBe(false);
  });

  test('patient details are a fixed 4-row, 2-column grid in reading order', async () => {
    const content = contentOf(await buildPathologyReportPdf(makeData()));
    // Text-matrix (x, y — PDF y-up) of each label's run. Kerning splits a run
    // into TJ fragments, so match the fragments in order.
    const at = (label: string) => {
      const frags = Buffer.from(label).toString('hex').match(/../g)!.join(String.raw`(?:> -?[\d.]+ <)?`);
      const m = content.match(new RegExp(String.raw`1 0 0 1 ([\d.]+) ([\d.]+) Tm\s+/F\d+ [\d.]+ Tf\s+\[<${frags}`));
      expect({ label, found: !!m }).toEqual({ label, found: true });
      return m!.slice(1, 3).map(Number);
    };
    const rows = [
      ['Patient Name', 'Collection Date'],
      ['UHID', 'Reporting Date'],
      ['Referred By', 'Ward/Bed'],
      ['Department'],
    ].map((labels) => labels.map(at));
    rows.forEach((row, r) => {
      expect(row[0][0]).toBeCloseTo(40, 0);                           // left column at the margin
      if (row[1]) {
        expect(row[1][1]).toBeCloseTo(row[0][1], 1);                  // same baseline
        expect(row[1][0]).toBeGreaterThan(595.28 / 2 - 10);           // right column
      }
      if (r > 0) expect(row[0][1]).toBeLessThan(rows[r - 1][0][1]);   // each row below the previous
    });
  });

  test('missing detail values print "—" and no extra rows (no encounter, no clinical note / comment, no address)', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      encounter: null,
      patient: { fullName: 'John Doe', patientId: 'PAT-001', age: null, gender: null, mobileNumber: null, address: null },
      test: { testName: 'ESR', values: [value({ key: 'esr', name: 'ESR (Westergren)', value: '12', unit: 'mm/hr', referenceRange: '0 - 15' })], clinicalNote: null, comment: '  ' },
    }));
    expect(has(pdf, 'Patient Type')).toBe(false);
    expect(has(pdf, 'Ward/Bed: ')).toBe(true);
    expect(has(pdf, 'Department: ')).toBe(true);
    expect(has(pdf, 'Clinical Notes')).toBe(false);
    expect(has(pdf, 'Comment')).toBe(false);
    expect(has(pdf, 'Address')).toBe(false);
    expect(has(pdf, 'ESR (Westergren)')).toBe(true);
  });

  test('long results never truncate — they wrap and flow onto further pages', async () => {
    const longList = Array.from({ length: 40 }, (_, i) => `Antibiotic-${i + 1}`).join(', ');
    const values = Array.from({ length: 60 }, (_, i) =>
      value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: i === 0 ? longList : String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
    const pdf = await buildPathologyReportPdf(makeData({ test: { testName: 'Urine Culture & Sensitivity', values, clinicalNote: null, comment: null } }));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(has(pdf, 'Parameter 60')).toBe(true);           // last row present
    expect(has(pdf, 'Antibiotic-40')).toBe(true);          // tail of the wrapped long value present
    expect(has(pdf, `of ${pageCount(pdf)}`)).toBe(false);   // no page-number footer
    // Continuation pages carry a plain one-line identifier.
    expect(has(pdf, 'Pathology Report')).toBe(true);
    expect(has(pdf, 'continued')).toBe(true);
  });

  test('a test name with β ("Pregnancy Test (Urine β-hCG)") prints exactly, β drawn from the Symbol font', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      test: {
        testName: 'Pregnancy Test (Urine β-hCG)',
        values: [value({ key: 'urineHcg', name: 'Urine hCG (Qualitative)', value: 'Positive', referenceRange: 'Negative' })],
        clinicalNote: 'Repeat β-hCG in 48 hours.',
        comment:      null,
      },
    }));
    expect(pdf.toString('latin1')).toMatch(/\/BaseFont \/Symbol/);
    // Helvetica runs on either side of the β, which is the Symbol glyph at 'b'.
    expect(has(pdf, 'Pregnancy Test (Urine ')).toBe(true);
    expect(has(pdf, '-hCG)')).toBe(true);
    expect(has(pdf, 'Repeat ')).toBe(true);
    expect(has(pdf, 'Urine hCG (Qualitative)')).toBe(true);
    expect(pageCount(pdf)).toBe(1);
  });

  test('text containing β that has to wrap spells it out instead of drawing a broken glyph', async () => {
    const clinicalNote = `${'Long note text that wraps across several lines. '.repeat(6)}β-hCG rising.`;
    const pdf = await buildPathologyReportPdf(makeData({ test: { ...makeData().test, clinicalNote } }));
    expect(has(pdf, 'beta-hCG rising.')).toBe(true);
  });

  test('results table columns are Parameter | Value | Unit | Bio. Ref. Interval', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    const text = textOf(pdf);
    const at = ['Parameter', 'Value', 'Unit', 'Bio. Ref. Interval'].map((t) => text.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((x, y) => x - y)).toEqual(at);               // drawn left-to-right in this order
    expect(text.indexOf('CBC (Complete Blood Count)')).toBeLessThan(at[0]); // test name above the table
    expect(has(pdf, 'Result')).toBe(false);
    expect(has(pdf, 'Reference Range')).toBe(false);
  });

  test('has no title heading, generation notice or Flag column', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of ['PATHOLOGY REPORT', 'Computer-generated', 'Generated on', 'Flag', 'Low', 'High', 'Abnormal']) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: false });
    }
  });

  test('a bold "End of Report" line precedes the Doctor Signature block', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    const text = textOf(pdf);
    expect(text.split('End of Report').length - 1).toBe(1);
    expect(text.indexOf('Clinical correlation advised.')).toBeLessThan(text.indexOf('End of Report'));
    expect(text.indexOf('End of Report')).toBeLessThan(text.lastIndexOf('Dr Manish Kumar'));
    const content = contentOf(pdf);
    const fontOf = (t: string) => content.match(new RegExp(String.raw`/(F\d+) [\d.]+ Tf\s+\[<${Buffer.from(t).toString('hex')}`))?.[1];
    expect(fontOf('End')).toBeDefined();
    expect(fontOf('End')).toBe(fontOf('John'));   // bold, like the patient-grid values
    // A short rule on each side of the text, with a gap: same y, left rule
    // ends before the text starts, right rule starts after it ends.
    const endX = Number(content.match(new RegExp(String.raw`1 0 0 1 ([\d.]+) [\d.]+ Tm\s+/F\d+ [\d.]+ Tf\s+\[<${Buffer.from('End').toString('hex')}`))?.[1]);
    const rules = [...content.matchAll(/([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l\s+S/g)]
      .map((m) => m.slice(1, 5).map(Number))
      .filter(([x1, y1, x2, y2]) => y1 === y2 && Math.abs(x2 - x1 - 60) < 0.01);
    expect(rules).toHaveLength(2);
    expect(rules[0][1]).toBe(rules[1][1]);
    expect(rules[0][2]).toBeLessThan(endX);
    expect(rules[1][0]).toBeGreaterThan(endX + 50);
    expect(rules[0][0] + rules[1][2]).toBeCloseTo(595.28, 0);   // symmetric about the page centre
  });

  test('out-of-range results print bold, normal results regular, with no rule under each row', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      test: {
        testName: 'Lipid Profile',
        values: [
          value({ key: 'a', name: 'Total Cholesterol', value: '264', unit: 'mg/dL', referenceRange: '0 - 200', flag: 'HIGH' }),
          value({ key: 'b', name: 'HDL Cholesterol',   value: '48',  unit: 'mg/dL', referenceRange: '40 - 60' }),
        ],
        clinicalNote: null,
        comment:      null,
      },
      correlateClinically: null,
    }));
    const content = contentOf(pdf);
    // Font resource used for the 9pt text run starting with `text`.
    const fontOf = (text: string) => content
      .match(new RegExp(String.raw`/(F\d+) 9 Tf\s+\[<${Buffer.from(text).toString('hex')}`))?.[1];
    const bold    = fontOf('John');   // patient-grid values are bold
    const regular = fontOf('HD');     // parameter names are regular
    expect(bold).toBeDefined();
    expect(regular).toBeDefined();
    expect(bold).not.toBe(regular);
    expect(fontOf('264')).toBe(bold);
    expect(fontOf('48')).toBe(regular);
    // Only the patient-grid divider, the table header's two rules, the two
    // "End of Report" side rules and the Doctor Signature line remain.
    expect(content.match(/ l\s+S/g)).toHaveLength(6);
  });

  test('keeps the top 3.5 cm and bottom 2 cm of every page blank', async () => {
    const values = Array.from({ length: 60 }, (_, i) =>
      value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
    const pdf = await buildPathologyReportPdf(makeData({ test: { testName: 'Panel', values, clinicalNote: 'Note.', comment: 'Comment.' } }));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    const content = contentOf(pdf);
    const PAGE_H = 841.89, TOP = (35 * 72) / 25.4, BOTTOM = (20 * 72) / 25.4;
    // Text baselines (PDF y-up coordinates): nothing above the top band's
    // edge (allowing for the glyph ascent) or inside the bottom band.
    const baselines = [...content.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map((m) => Number(m[1]));
    expect(baselines.length).toBeGreaterThan(0);
    expect(Math.max(...baselines)).toBeLessThan(PAGE_H - TOP);
    expect(Math.min(...baselines)).toBeGreaterThan(BOTTOM);
    // Rules (drawn in PDFKit's y-down coordinates) stay within the same band.
    const ruleYs = [...content.matchAll(/[\d.]+ ([\d.]+) m\s/g)].map((m) => Number(m[1]));
    expect(Math.min(...ruleYs)).toBeGreaterThanOrEqual(TOP);
    expect(Math.max(...ruleYs)).toBeLessThanOrEqual(PAGE_H - BOTTOM);
  });

  test('the test name is centred', async () => {
    const pdf = await buildPathologyReportPdf(makeData({ test: { ...makeData().test, testName: 'ESR' } }));
    const x = Number(contentOf(pdf).match(/1 0 0 1 ([\d.]+) [\d.]+ Tm\s+\/F\d+ 12 Tf\s+\[<455352>/)?.[1]);
    const width = 595.28 - 80;
    // "ESR" at 12pt is ~22pt wide; its left edge sits near the page centre.
    expect(x).toBeGreaterThan(40 + width / 2 - 20);
    expect(x).toBeLessThan(40 + width / 2);
  });

  test('the print copy (no letterhead) carries the Doctor Signature at the bottom-right of the last page', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    expect(textOf(pdf).split('Dr Manish Kumar').length - 1).toBe(1);
    expect(has(pdf, 'MBBS, MD Path')).toBe(true);
    expect(has(pdf, 'Doctor Signature')).toBe(false);
    expect(has(pdf, 'Registration No.')).toBe(false);
    const m = signatureAt(contentOf(pdf));
    expect(Number(m[1])).toBeGreaterThan(595.28 / 2);   // right half
    expect(Number(m[2])).toBeLessThan(841.89 / 4);      // bottom quarter (PDF y-up)
  });

  test('embeds the provided doctor signature (transparent PNG) once, above the name, aspect ratio kept', async () => {
    expect(DOCTOR_SIGNATURE_IMAGE!.subarray(0, 4).toString('hex')).toBe('89504e47');
    expect(DOCTOR_SIGNATURE_IMAGE!.readUInt32BE(16)).toBe(440);   // IHDR width
    expect(DOCTOR_SIGNATURE_IMAGE!.readUInt32BE(20)).toBe(314);   // IHDR height
    const pdf = await buildPathologyReportPdf(makeData());
    expect(pdf.toString('latin1')).toMatch(/\/SMask \d+ 0 R/);   // alpha channel → no background box
    const content = contentOf(pdf);
    const img = content.match(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\s+\/I\d+ Do/);
    expect(img).not.toBeNull();
    const [w, h, x, y] = img!.slice(1, 5).map(Number);
    expect(h).toBeLessThanOrEqual(42);
    expect(w / h).toBeCloseTo(440 / 314, 1);
    expect(x).toBeGreaterThan(595.28 / 2);
    expect(841.89 - y).toBeGreaterThan(Number(signatureAt(content)[2]));
  });

  test("the signature image sits above the doctor's name, inside the signature block", async () => {
    jest.resetModules();
    jest.doMock('../../../src/modules/lab/doctor-signature.image', () => ({
      ...jest.requireActual('../../../src/modules/lab/doctor-signature.image'),
      DOCTOR_SIGNATURE_IMAGE: Buffer.from(TINY_PNG, 'base64'),
    }));
    const { buildPathologyReportPdf: build } = await import('../../../src/modules/lab/pathology-report.pdf');
    jest.dontMock('../../../src/modules/lab/doctor-signature.image');
    const content = contentOf(await build(makeData()));
    // Image placement matrix: `w 0 0 -h x y cm` (PDFKit's y-down space, y = image bottom).
    const img = content.match(/([\d.]+) 0 0 -([\d.]+) ([\d.]+) ([\d.]+) cm\s+\/I\d+ Do/);
    expect(img).not.toBeNull();
    const [w, h, x, y] = img!.slice(1, 5).map(Number);
    const name = signatureAt(content);
    expect(h).toBeLessThanOrEqual(42);                    // proportionate, fitted to the box
    expect(w).toBeCloseTo(h, 1);                          // aspect ratio kept (square test image)
    expect(x).toBeGreaterThan(595.28 / 2);                // right half, with the name
    expect(841.89 - y).toBeGreaterThan(Number(name[2])); // image bottom (y-up) above the name
  });

  describe('downloaded copy (letterhead)', () => {
    const withLetterhead = (o: Partial<PathologyReportPdfData> = {}) => makeData({ letterhead: { logo: null }, ...o });

    test('carries the hospital name, registration number and address, plus a Doctor Signature', async () => {
      const pdf = await buildPathologyReportPdf(withLetterhead());
      for (const text of ['Lab Test Hospital', 'Registration No.: GST001', '321 Lab Street', 'End of Report', 'Dr Manish Kumar', 'MBBS, MD Path']) {
        expect({ text, found: has(pdf, text) }).toEqual({ text, found: true });
      }
      expect(has(pdf, 'admin@labtest.com')).toBe(false);
      expect(pageCount(pdf)).toBe(1);
    });

    test('letterhead is black text with no background fill', async () => {
      const content = contentOf(await buildPathologyReportPdf(withLetterhead()));
      const fills = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:rg|scn)/g)].map((m) => m.slice(1, 4).map(Number));
      expect(fills.every((c) => c.every((v) => v === 0))).toBe(true);
      expect(content).not.toMatch(/ re\s+f/);
    });

    test('the letterhead sits in the top band of every page; content stays below it', async () => {
      const values = Array.from({ length: 60 }, (_, i) =>
        value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
      const pdf = await buildPathologyReportPdf(withLetterhead({ test: { testName: 'Panel', values, clinicalNote: null, comment: null } }));
      const pages = pageCount(pdf);
      expect(pages).toBeGreaterThan(1);
      expect(textOf(pdf).split('Lab Test Hospital').length - 1).toBe(pages);
      expect(textOf(pdf).split('Dr Manish Kumar').length - 1).toBe(1);
    });

    test('the Doctor Signature is at the bottom-right of the last page', async () => {
      const m = signatureAt(contentOf(await buildPathologyReportPdf(withLetterhead())));
      expect(Number(m[1])).toBeGreaterThan(595.28 / 2);   // right half
      expect(Number(m[2])).toBeLessThan(841.89 / 4);      // bottom quarter (PDF y-up)
    });
  });

  describe('Test Master clinical content', () => {
    test('prints Clinical Notes, then Comment, then End of Report, then the Please Correlate Clinically footer last', async () => {
      const pdf = await buildPathologyReportPdf(makeData({
        test: { ...makeData().test, clinicalNote: 'Note text.', comment: 'Screening comment.' },
      }));
      const text = textOf(pdf);
      const order = ['Clinical Notes', 'Note text.', 'Comment', 'Screening comment.', 'End of Report', 'Dr Manish Kumar', 'Please Correlate Clinically']
        .map((t) => text.indexOf(t));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(pageCount(pdf)).toBe(1);
    });

    test('the Please Correlate Clinically footer sits below the Doctor Signature, inside the bottom margin', async () => {
      const content = contentOf(await buildPathologyReportPdf(makeData()));
      const hex = Buffer.from('Please Correlate').toString('hex');
      const footerY = Number(content.match(new RegExp(String.raw`1 0 0 1 [\d.]+ ([\d.]+) Tm\s+/F\d+ [\d.]+ Tf\s+\[<${hex}`))?.[1]);
      expect(footerY).toBeLessThan(Number(signatureAt(content)[2]));   // PDF y-up: below the name
      expect(footerY).toBeGreaterThan((20 * 72) / 25.4);               // above the blank bottom 2 cm
    });

    test('never prints a Remarks section', async () => {
      expect(has(await buildPathologyReportPdf(makeData()), 'Remarks')).toBe(false);
    });

    test('a comment prints only when set, and each section prints once', async () => {
      const without = await buildPathologyReportPdf(makeData());
      expect(has(without, 'Comment')).toBe(false);
      const withComment = await buildPathologyReportPdf(makeData({ test: { ...makeData().test, comment: 'Confirm by PCR.' } }));
      expect(textOf(withComment).split('Confirm by PCR.').length - 1).toBe(1);
      expect(textOf(withComment).split('Clinical Notes').length - 1).toBe(1);
      expect(textOf(withComment).split('Please Correlate Clinically').length - 1).toBe(1);
    });

    test('a long report keeps the footer on the last page only, below the signature', async () => {
      const values = Array.from({ length: 60 }, (_, i) =>
        value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
      const pdf = await buildPathologyReportPdf(makeData({ test: { ...makeData().test, values } }));
      expect(pageCount(pdf)).toBeGreaterThan(1);
      expect(textOf(pdf).split('Please Correlate Clinically').length - 1).toBe(1);
      const text = textOf(pdf);
      expect(text.indexOf('Please Correlate Clinically')).toBeGreaterThan(text.indexOf('Dr Manish Kumar'));
    });
  });

  test('has no "Page X of Y" footer and no extra blank page', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    expect(has(pdf, 'Page 1 of 1')).toBe(false);
    expect(pageCount(pdf)).toBe(1);
  });

});
