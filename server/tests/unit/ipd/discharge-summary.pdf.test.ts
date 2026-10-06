import http from 'http';
import zlib from 'zlib';
import {
  buildDischargeSummaryPdf, getContrastTextColor, hexToRgb, formatCurrency, fontSupportsRupeeSymbol,
} from '../../../src/modules/ipd/discharge-summary.pdf';
import { DischargeSummaryData } from '../../../src/modules/ipd/ipd.types';

// Decompresses every FlateDecode content stream in a generated PDF and
// concatenates them — lets a test assert on the actual PDF drawing
// operators (e.g. the `r g b scn` fill-color operator) rather than just
// "it didn't crash", which is what would have caught this module's real
// bug: pdfkit silently no-ops `.fill()`/`.fillColor()` for color values it
// can't normalize (only #hex, named colors, and [r,g,b] arrays are
// supported — a CSS `rgb(r,g,b)` string is not), leaving shapes painted in
// whatever fill color was last actually set instead of the brand color.
function decompressContentStreams(buf: Buffer): string {
  const parts: string[] = [];
  let idx = 0;
  for (;;) {
    const start = buf.indexOf('stream', idx);
    if (start === -1) break;
    let dataStart = start + 'stream'.length;
    if (buf[dataStart] === 0x0d) dataStart++; // \r
    if (buf[dataStart] === 0x0a) dataStart++; // \n
    const end = buf.indexOf('endstream', dataStart);
    if (end === -1) break;
    try { parts.push(zlib.inflateSync(buf.subarray(dataStart, end)).toString('latin1')); } catch { /* not Flate (e.g. image XObject) — skip */ }
    idx = end + 'endstream'.length;
  }
  return parts.join('\n');
}

// The exact `r g b scn` fill-color operator pdfkit emits for a given hex —
// mirrors pdfkit's own [0-255] → [0-1] normalization (plain division, no
// rounding), so this must match byte-for-byte with what the real renderer
// writes for a color that normalizes correctly.
function fillOperatorFor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r / 255} ${g / 255} ${b / 255} scn`;
}

// A minimal, valid 1x1 PNG — used to exercise the "logo present" letterhead
// path without a real network fetch.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

// Spins up a throwaway local HTTP server that serves ONE_PX_PNG, hands the
// caller its URL, and tears it down afterward — buildDischargeSummaryPdf
// fetches the logo over http(s), so this exercises the real fetch path
// without reaching the network.
async function withLogoServer(fn: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(ONE_PX_PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}/logo.png`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function makeData(overrides: Partial<DischargeSummaryData> = {}): DischargeSummaryData {
  return {
    hospital: {
      name: 'City Hospital', logoUrl: null, primaryColor: '#1A73E8',
      address: '123 Main St, Springfield', email: 'admin@cityhospital.test', registrationNumber: '22AAAAA0000A1Z5',
    },
    patient: {
      patientId: 'PAT-ABCD1234', fullName: 'Ravi Kumar', age: 45, gender: 'MALE', mobileNumber: '9876543210',
      address: '45 Park Lane', registeredAt: '2026-01-01T10:00:00.000Z', registeredByName: 'Reception Staff',
    },
    opdVisits: [
      {
        visitId: 'OPD-0001', visitDate: '2026-01-05T09:00:00.000Z', status: 'COMPLETED',
        departmentName: 'Cardiology', doctorNames: ['Dr. Asha Rao'],
        diagnosis: 'Mild hypertension', prescription: 'Amlodipine 5mg once daily',
        notesHtml: '<p><strong>Patient</strong> reports <em>occasional</em> dizziness.</p><ul><li>BP checked</li><li>ECG normal</li></ul>',
      },
    ],
    admission: {
      admissionId: 'ADM-0001', wardName: 'General Ward', bedNumber: 'B-12', departmentName: 'Cardiology',
      assignedDoctorNames: ['Dr. Asha Rao'], assignedNurseNames: ['Nurse Priya'],
      admissionDate: '2026-01-06T08:00:00.000Z', dischargeDate: '2026-01-10T14:30:00.000Z',
      dischargedByName: 'Dr. Asha Rao',
      dischargeSummaryNotes: 'Discharged in stable condition.\nContinue oral antibiotics for 5 days.',
      progressNotes: [
        { authorName: 'Nurse Priya', authorRole: 'NURSE', timestamp: '2026-01-07T09:00:00.000Z', noteHtml: 'Vitals stable. <u>No complaints</u>.' },
        { authorName: null, authorRole: null, timestamp: '2026-01-08T09:00:00.000Z', noteHtml: 'Legacy plain-text note with no author on record.' },
      ],
      vitals: { spo2: 98, bloodPressure: '120/80', bodyTemperature: 98.6, sugar: 110, height: 170, weight: 72, pulse: 76 },
    },
    labRequests: [
      {
        requestId: 'LAB-0001', category: 'PATHOLOGY', type: 'Complete Blood Count', status: 'COMPLETED', priority: 'NORMAL',
        requestedByName: 'Dr. Asha Rao', departmentName: 'Cardiology', requestedAt: '2026-01-06T10:00:00.000Z',
        notesHtml: 'Routine check', reportUrl: 'https://s3.test/report.pdf',
      },
    ],
    billing: {
      payments: [
        { amount: 500, paymentMethod: 'CASH', status: 'COMPLETED', description: 'OPD Consultation', createdAt: '2026-01-05T09:30:00.000Z' },
        { amount: 5000, paymentMethod: 'UPI', status: 'COMPLETED', description: 'IPD Admission', createdAt: '2026-01-06T08:30:00.000Z' },
      ],
      total: 5500,
    },
    generatedAt: '2026-01-10T15:00:00.000Z',
    ...overrides,
  };
}

function pageCount(buf: Buffer): number {
  const match = /\/Count\s+(\d+)/.exec(buf.toString('latin1'));
  return match ? parseInt(match[1], 10) : 0;
}

describe('buildDischargeSummaryPdf', () => {
  test('generates a valid single-page PDF buffer with full data', async () => {
    const buf = await buildDischargeSummaryPdf(makeData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThanOrEqual(1);
  });

  test('handles minimal data — no OPD visits, no lab requests, no billing, no attributions — without crashing', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [],
      labRequests: [],
      billing: null,
      patient: { ...base.patient, registeredByName: null, address: null },
      admission: { ...base.admission, dischargedByName: null, assignedDoctorNames: [], assignedNurseNames: [], progressNotes: [] },
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('overflows onto multiple pages for a long progress-note history, with correct page numbering', async () => {
    const base = makeData();
    const manyNotes = Array.from({ length: 60 }, (_, i) => ({
      authorName: 'Dr. Asha Rao', authorRole: 'DOCTOR', timestamp: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
      noteHtml: `<p>Progress note number ${i + 1} with <strong>bold</strong> and <em>italic</em> text describing the patient's ongoing condition in reasonable detail so the paragraph wraps across multiple lines.</p>`,
    }));
    const buf = await buildDischargeSummaryPdf({ ...base, admission: { ...base.admission, progressNotes: manyNotes } });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThan(1);
  });

  test('renders the Discharge Summary Notes section only when notes were recorded', async () => {
    const base = makeData();
    const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex');
    const withNotes    = decompressContentStreams(await buildDischargeSummaryPdf(makeData())).toLowerCase();
    const withoutNotes = decompressContentStreams(await buildDischargeSummaryPdf({
      ...base, admission: { ...base.admission, dischargeSummaryNotes: null },
    })).toLowerCase();

    expect(withNotes).toContain(hex('Notes'));
    expect(withNotes).toContain(hex('antibiotics'));
    // "Discharged On:" — matched as "ed On:" because kerning splits the word;
    // "Registered On:" also matches, so assert exactly one extra occurrence.
    const count = (t: string) => t.split(hex('ed On:')).length - 1;
    expect(count(withNotes)).toBe(count(withoutNotes) + 1);
    expect(withoutNotes).not.toContain(hex('antibiotics'));
  });

  test('handles legacy plain-text notes (pre-rich-text data) safely', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [{ ...base.opdVisits[0], notesHtml: 'Plain legacy note.\nSecond line.' }],
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('does not attempt a network fetch (and does not hang/crash) when the hospital has no logo', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, logoUrl: null } });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('an unreachable logo URL degrades gracefully instead of failing generation', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      hospital: { ...base.hospital, logoUrl: 'http://127.0.0.1:1/nonexistent-logo.png' },
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 10000);

  test('multiple OPD visits and lab requests are all included', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [base.opdVisits[0], { ...base.opdVisits[0], visitId: 'OPD-0002', diagnosis: 'Follow-up: improving' }],
      labRequests: [base.labRequests[0], { ...base.labRequests[0], requestId: 'LAB-0002', category: 'RADIOLOGY', type: 'Chest X-Ray' }],
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  // ─── Letterhead (downloaded copy) ───────────────────────────────────────────
  describe('letterhead', () => {
    test('renders a real logo image on the letterhead without crashing (aspect ratio preserved via `fit`, never stretched)', async () => {
      await withLogoServer(async (logoUrl) => {
        const base = makeData();
        const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, logoUrl } });
        expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
        expect(buf.toString('latin1')).toContain('/Subtype /Image');
      });
    }, 10000);

    test('the Print copy never fetches or embeds the logo', async () => {
      await withLogoServer(async (logoUrl) => {
        const base = makeData();
        const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, logoUrl } }, { print: true });
        expect(buf.toString('latin1')).not.toContain('/Subtype /Image');
      });
    }, 10000);

    test('clips a long hospital name and address to the top band without crashing', async () => {
      const base = makeData();
      const buf = await buildDischargeSummaryPdf({
        ...base,
        hospital: {
          ...base.hospital,
          name: 'The Very Long Regional Multi-Specialty Super-Speciality Institute of Advanced Medical Sciences and Research',
          address: 'Plot No. 45/B, Sector 7, Near Old Water Tank Road, Behind Community Health Centre, Metropolis, State, 100001',
        },
      });
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      expect(pageCount(buf)).toBe(pageCount(await buildDischargeSummaryPdf(base)));
    });

    test('falls back cleanly with no logo, no address, no email, and no GSTIN', async () => {
      const buf = await buildDischargeSummaryPdf({
        ...makeData(),
        hospital: { name: 'Minimal Hospital', logoUrl: null, primaryColor: '#1A73E8', address: null, email: null, registrationNumber: null },
      });
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });
  });
});

// ─── Download vs Print copy, page layout ──────────────────────────────────────
describe('Download / Print layout', () => {
  const hex = (t: string) => Buffer.from(t, 'latin1').toString('hex');
  const longData = () => {
    const base = makeData();
    const manyNotes = Array.from({ length: 60 }, (_, i) => ({
      authorName: 'Dr. Asha Rao', authorRole: 'DOCTOR', timestamp: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
      noteHtml: `<p>Progress note number ${i + 1} describing the patient's ongoing condition in reasonable detail so the paragraph wraps across multiple lines.</p>`,
    }));
    return { ...base, admission: { ...base.admission, progressNotes: manyNotes } };
  };

  test('is A4', async () => {
    const buf = await buildDischargeSummaryPdf(makeData());
    expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  test('the downloaded copy prints the letterhead (GSTIN line) on every page; the Print copy has none', async () => {
    const data = longData();
    const download = await buildDischargeSummaryPdf(data);
    const print    = await buildDischargeSummaryPdf(data, { print: true });
    const pages    = pageCount(download);
    expect(pages).toBeGreaterThan(1);

    const marker = hex('22AAAAA0000A1Z5');   // the GSTIN — only ever drawn by the letterhead
    const occurrences = (buf: Buffer) => decompressContentStreams(buf).toLowerCase().split(marker).length - 1;
    expect(occurrences(download)).toBe(pages);
    expect(occurrences(print)).toBe(0);
  });

  test('Download and Print carry the same content on the same number of pages', async () => {
    for (const data of [makeData(), longData()]) {
      const download = await buildDischargeSummaryPdf(data);
      const print    = await buildDischargeSummaryPdf(data, { print: true });
      expect(pageCount(print)).toBe(pageCount(download));
      const content = decompressContentStreams(print).toLowerCase();
      expect(decompressContentStreams(download).toLowerCase()).toContain(content.slice(0, 2000));
    }
  });

  test('short content fits one page — no trailing blank page', async () => {
    const short = makeData({ opdVisits: [], labRequests: [] });
    expect(pageCount(await buildDischargeSummaryPdf(short))).toBe(1);
    expect(pageCount(await buildDischargeSummaryPdf(short, { print: true }))).toBe(1);
  });

  test('has no "Generated on" footer or page numbers', async () => {
    for (const buf of [await buildDischargeSummaryPdf(longData()), await buildDischargeSummaryPdf(longData(), { print: true })]) {
      const content = decompressContentStreams(buf).toLowerCase();
      expect(content).not.toContain(hex('Generated'));
      expect(content).not.toContain(hex(' of '));
    }
  });

  test('uses only black for text and rules — no brand-colour fills', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, primaryColor: '#7B1FA2' } });
    const content = decompressContentStreams(buf);
    const colours = content.match(/[\d.]+ [\d.]+ [\d.]+ (scn|SCN)/g) ?? [];
    expect(colours.length).toBeGreaterThan(0);
    colours.forEach((op) => expect(op).toMatch(/^0 0 0 (scn|SCN)$/));
  });

  // Content stream text with pdfkit's kerning adjustments (`<..> 30 <..>` inside
  // a TJ array) removed, so whole words can be matched by their hex encoding.
  const unkerned = (buf: Buffer) => decompressContentStreams(buf).toLowerCase().replace(/>\s*-?[\d.]+\s*</g, '');

  test('renders the Vitals grid in order SpO2 | BP | Temperature, Sugar | Height | Weight', async () => {
    const content = unkerned(await buildDischargeSummaryPdf(makeData(), { print: true }));
    const positions = ['SpO2', 'BP', 'Temperature', 'Sugar', 'Height', 'Weight', 'mmHg', 'mg/dL']
      .map((label) => content.indexOf(hex(label)));
    positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
    expect(positions.slice(0, 6)).toEqual([...positions.slice(0, 6)].sort((x, y) => x - y));
  });

  test('a partially recorded vitals set keeps the grid; no recorded vitals omits the section', async () => {
    const base = makeData({ opdVisits: [], labRequests: [] });
    const partial = { spo2: null, bloodPressure: '120/80', bodyTemperature: null, sugar: null, height: null, weight: 72, pulse: null };
    const empty   = { spo2: null, bloodPressure: null, bodyTemperature: null, sugar: null, height: null, weight: null, pulse: null };
    const withPartial = unkerned(await buildDischargeSummaryPdf({ ...base, admission: { ...base.admission, vitals: partial } }));
    expect(withPartial).toContain(hex('SpO2'));
    expect(withPartial).toContain(hex('Height'));
    for (const vitals of [empty, null, undefined]) {
      const buf = await buildDischargeSummaryPdf({ ...base, admission: { ...base.admission, vitals } });
      expect(unkerned(buf)).not.toContain(hex('SpO2'));
      expect(pageCount(buf)).toBe(1);
    }
  });

  test('the Lab section never prints a "View Report" link', async () => {
    for (const print of [false, true]) {
      const buf = await buildDischargeSummaryPdf(makeData(), { print });
      expect(unkerned(buf)).not.toContain(hex('View Report'));
      expect(buf.toString('latin1')).not.toContain('s3.test/report.pdf');
    }
  });

  test('a long billing description wraps in full instead of being cut off', async () => {
    const base = makeData({ opdVisits: [], labRequests: [] });
    const description = 'IPD Admission package including room charges nursing care medicines consumables and final settlementzz';
    const buf = await buildDischargeSummaryPdf({
      ...base, billing: { payments: [{ ...base.billing!.payments[0], description }], total: 500 },
    }, { print: true });
    expect(unkerned(buf)).toContain(hex('settlementzz'));
    expect(pageCount(buf)).toBe(1);
  });

  test('the patient grid follows the OPD slip labels', async () => {
    const content = decompressContentStreams(await buildDischargeSummaryPdf(makeData(), { print: true })).toLowerCase();
    for (const label of ['UHID', 'Admission', 'Discharge', 'Mobile']) {
      expect(content).toContain(hex(label));
    }
  });
});

describe('getContrastTextColor', () => {
  test('picks white text for a dark brand color', () => {
    expect(getContrastTextColor('#0B1B34')).toBe('#ffffff');
  });

  test('picks dark text for a light/pastel brand color', () => {
    expect(getContrastTextColor('#F5F5F5')).toBe('#1a1a1a');
  });

  test('picks dark text for pure white', () => {
    expect(getContrastTextColor('#FFFFFF')).toBe('#1a1a1a');
  });

  test('picks white text for pure black', () => {
    expect(getContrastTextColor('#000000')).toBe('#ffffff');
  });

  test('falls back to black (reads as dark, picks white text) for an invalid/empty hex', () => {
    expect(getContrastTextColor('')).toBe('#ffffff');
  });
});

describe('hexToRgb', () => {
  test('parses a valid custom branding color', () => {
    expect(hexToRgb('#7B1FA2')).toEqual([0x7B, 0x1F, 0xA2]);
  });

  test('falls back to black when no valid primary color is configured (missing hex)', () => {
    expect(hexToRgb('')).toEqual([0, 0, 0]);
  });

  test('falls back to black when no valid primary color is configured (malformed hex)', () => {
    expect(hexToRgb('not-a-color')).toEqual([0, 0, 0]);
  });
});

describe('currency formatting', () => {
  test('renders the ₹ symbol for a font known to support the glyph', () => {
    expect(fontSupportsRupeeSymbol('NotoSansEmbedded')).toBe(true);
    expect(formatCurrency(100, 'NotoSansEmbedded')).toBe('₹100.00');
  });

  test('omits the ₹ symbol for the standard Helvetica fonts used in this document, showing only the formatted amount', () => {
    expect(fontSupportsRupeeSymbol('Helvetica')).toBe(false);
    expect(fontSupportsRupeeSymbol('Helvetica-Bold')).toBe(false);
    expect(formatCurrency(100, 'Helvetica')).toBe('100.00');
    expect(formatCurrency(5000, 'Helvetica')).toBe('5,000.00');
    expect(formatCurrency(10100, 'Helvetica-Bold')).toBe('10,100.00');
  });

  test('never produces a broken/replacement character when the symbol is unsupported', () => {
    const formatted = formatCurrency(100, 'Helvetica');
    expect(formatted).not.toMatch(/[¹�□]/);
    expect(formatted).not.toContain('₹');
  });
});
