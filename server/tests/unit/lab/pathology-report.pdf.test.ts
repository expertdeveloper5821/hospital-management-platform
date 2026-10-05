import zlib from 'zlib';
import { buildPathologyReportPdf, PathologyReportPdfData } from '../../../src/modules/lab/pathology-report.pdf';
import { PathologyResultValue } from '../../../src/modules/lab/lab.types';

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
      remarks: 'Clinical correlation advised.',
    },
    reportedByName: 'Lab Pathologist',
    reportedAt:     '2026-05-20T06:30:00.000Z',
    generatedAt:    '2026-05-20T07:00:00.000Z',
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

  test('carries the patient/UHID, encounter, test, results, units, ranges and report date', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of [
      'John Doe', 'PAT-001', '45 years / Male', '1234567890', 'Lab Doctor', 'Cardiology', 'OPD', 'OPD-LABTEST01',
      'Report Date', '20 May 2026', '123 Test Street',
      'CBC (Complete Blood Count)', 'Haemoglobin (Hb)', '10.2', 'g/dL', '13.0 - 17.0',
      'Differential Leucocyte Count', 'Remarks', 'Clinical correlation advised.',
    ]) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: true });
    }
  });

  test('has no hospital header, signature block, reporter details, request date or request id', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of [
      'Lab Test Hospital', '321 Lab Street', 'admin@labtest.com', 'GSTIN', 'GST001',
      'Requested On', 'Lab Request ID', '11111111-1111-4111-8111-111111111111',
      'Pathologist', 'Reported By', 'Reported On', 'Department of Pathology',
    ]) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: false });
    }
  });

  test('is plain black-on-white: no colour, no filled bars/backgrounds, no images', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      hospital: { ...makeData().hospital, logoUrl: 'http://127.0.0.1:1/logo.png', primaryColor: '#ff0000' },
    }));
    const content = contentOf(pdf);
    const colours = [...content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (?:scn|SCN)/g)].map((m) => m.slice(1, 4).join(' '));
    expect(colours.length).toBeGreaterThan(0);
    expect(colours.every((c) => c === '0 0 0')).toBe(true);
    expect(content).not.toMatch(/re\s+f/);          // no filled rectangles
    expect(pdf.toString('latin1')).not.toMatch(/\/Subtype \/Image/);
  });

  test('IPD encounters print ward / bed (no admission date, no OPD visit id)', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      encounter: {
        type: 'IPD', encounterId: 'ADM-1', date: '2026-05-18T00:00:00.000Z',
        departmentName: null, doctorNames: [], wardName: 'Ward A', bedNumber: 'B-12',
      },
    }));
    expect(has(pdf, 'Ward A / B-12')).toBe(true);
    expect(has(pdf, 'Patient Type')).toBe(true);
    expect(has(pdf, 'Admission Date')).toBe(false);
    expect(has(pdf, '18 May 2026')).toBe(false);
    expect(has(pdf, 'OPD Visit ID')).toBe(false);
  });

  test('omits empty optional rows (no encounter, no remarks, no address)', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      encounter: null,
      patient: { fullName: 'John Doe', patientId: 'PAT-001', age: null, gender: null, mobileNumber: null, address: null },
      test: { testName: 'ESR', values: [value({ key: 'esr', name: 'ESR (Westergren)', value: '12', unit: 'mm/hr', referenceRange: '0 - 15' })], remarks: null },
    }));
    expect(has(pdf, 'Patient Type')).toBe(false);
    expect(has(pdf, 'Remarks')).toBe(false);
    expect(has(pdf, 'Address')).toBe(false);
    expect(has(pdf, 'ESR (Westergren)')).toBe(true);
  });

  test('long results never truncate — they wrap and flow onto further pages with numbered footers', async () => {
    const longList = Array.from({ length: 40 }, (_, i) => `Antibiotic-${i + 1}`).join(', ');
    const values = Array.from({ length: 60 }, (_, i) =>
      value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: i === 0 ? longList : String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
    const pdf = await buildPathologyReportPdf(makeData({ test: { testName: 'Urine Culture & Sensitivity', values, remarks: null } }));
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(has(pdf, 'Parameter 60')).toBe(true);           // last row present
    expect(has(pdf, 'Antibiotic-40')).toBe(true);          // tail of the wrapped long value present
    expect(has(pdf, `Page ${pageCount(pdf)} of ${pageCount(pdf)}`)).toBe(true);
    // Continuation pages carry a plain one-line identifier.
    expect(has(pdf, 'Pathology Report')).toBe(true);
    expect(has(pdf, 'continued')).toBe(true);
  });

  test('a test name with β ("Pregnancy Test (Urine β-hCG)") prints exactly, β drawn from the Symbol font', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      test: {
        testName: 'Pregnancy Test (Urine β-hCG)',
        values: [value({ key: 'urineHcg', name: 'Urine hCG (Qualitative)', value: 'Positive', referenceRange: 'Negative' })],
        remarks: 'Repeat β-hCG in 48 hours.',
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
    const remarks = `${'Long remark text that wraps across several lines. '.repeat(6)}β-hCG rising.`;
    const pdf = await buildPathologyReportPdf(makeData({ test: { ...makeData().test, remarks } }));
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

  test('has no title heading, end-of-report footer or Flag column', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    for (const text of ['PATHOLOGY REPORT', 'End of Report', 'Flag', 'Low', 'High', 'Abnormal']) {
      expect({ text, found: has(pdf, text) }).toEqual({ text, found: false });
    }
  });

  test('out-of-range results print bold, normal results regular, with no rule under each row', async () => {
    const pdf = await buildPathologyReportPdf(makeData({
      test: {
        testName: 'Lipid Profile',
        values: [
          value({ key: 'a', name: 'Total Cholesterol', value: '264', unit: 'mg/dL', referenceRange: '0 - 200', flag: 'HIGH' }),
          value({ key: 'b', name: 'HDL Cholesterol',   value: '48',  unit: 'mg/dL', referenceRange: '40 - 60' }),
        ],
        remarks: null,
      },
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
    // Only the patient-grid divider and the table header's two rules remain.
    expect(content.match(/ l\s+S/g)).toHaveLength(3);
  });

  test('keeps the top 3.5 cm and bottom 2 cm of every page blank', async () => {
    const values = Array.from({ length: 60 }, (_, i) =>
      value({ key: `p${i}`, name: `Parameter ${i + 1}`, value: String(i), unit: 'mg/dL', referenceRange: '1 - 100' }));
    const pdf = await buildPathologyReportPdf(makeData({ test: { testName: 'Panel', values, remarks: 'Note.' } }));
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

  test('the footer never spills onto an extra blank page', async () => {
    const pdf = await buildPathologyReportPdf(makeData());
    expect(has(pdf, 'Page 1 of 1')).toBe(true);
    expect(pageCount(pdf)).toBe(1);
  });

});
