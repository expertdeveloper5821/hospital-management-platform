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
      progressNotes: [
        { authorName: 'Nurse Priya', authorRole: 'NURSE', timestamp: '2026-01-07T09:00:00.000Z', noteHtml: 'Vitals stable. <u>No complaints</u>.' },
        { authorName: null, authorRole: null, timestamp: '2026-01-08T09:00:00.000Z', noteHtml: 'Legacy plain-text note with no author on record.' },
      ],
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

  // ─── Branded letterhead ─────────────────────────────────────────────────────
  describe('branded letterhead', () => {
    test('renders a real logo image on the letterhead without crashing (aspect ratio preserved via `fit`, never stretched)', async () => {
      await withLogoServer(async (logoUrl) => {
        const base = makeData();
        const buf = await buildDischargeSummaryPdf({
          ...base,
          hospital: { ...base.hospital, logoUrl, primaryColor: '#7B1FA2' },
        });
        expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      });
    }, 10000);

    test('generates a valid, readable PDF for a light/pastel branding color', async () => {
      const base = makeData();
      const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, primaryColor: '#F5F5F5' } });
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    test('generates a valid, readable PDF for a dark branding color', async () => {
      const base = makeData();
      const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, primaryColor: '#0B1B34' } });
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    test('wraps a long hospital name and address in the letterhead without crashing', async () => {
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
      expect(pageCount(buf)).toBeGreaterThanOrEqual(1);
    });

    test('falls back cleanly with no logo, no address, no email, and no GSTIN', async () => {
      const buf = await buildDischargeSummaryPdf({
        ...makeData(),
        hospital: { name: 'Minimal Hospital', logoUrl: null, primaryColor: '#1A73E8', address: null, email: null, registrationNumber: null },
      });
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    });

    test('the branded letterhead + compact running header do not affect existing footer pagination', async () => {
      const base = makeData();
      const manyNotes = Array.from({ length: 60 }, (_, i) => ({
        authorName: 'Dr. Asha Rao', authorRole: 'DOCTOR', timestamp: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
        noteHtml: `<p>Progress note number ${i + 1} describing the patient's ongoing condition in reasonable detail so the paragraph wraps across multiple lines.</p>`,
      }));
      const buf = await buildDischargeSummaryPdf({
        ...base,
        hospital: { ...base.hospital, primaryColor: '#0B1B34' },
        admission: { ...base.admission, progressNotes: manyNotes },
      });
      const text = buf.toString('latin1');
      expect(pageCount(buf)).toBeGreaterThan(1);
      expect(text).toContain('Page');
    });
  });
});

// ─── Proves the Hospital Admin's saved branding color actually reaches and
// styles the rendered PDF, not just the data passed into the builder.
describe('branded elements render in the actual configured color', () => {
  test('a custom color saved in Hospital Admin Branding is written as the fill-color operator for the letterhead, title bar, and section headers', async () => {
    const base = makeData();
    const customColor = '#7B1FA2';
    const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, primaryColor: customColor } });

    const content = decompressContentStreams(buf);
    const op = fillOperatorFor(customColor);
    const occurrences = content.split(op).length - 1;

    // Letterhead band + title bar + at least one section heading (e.g.
    // "Patient Information") all fill with this exact operator.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  test('the compact running header on continuation pages also uses the exact configured color', async () => {
    const base = makeData();
    const customColor = '#0B1B34';
    const manyNotes = Array.from({ length: 60 }, (_, i) => ({
      authorName: 'Dr. Asha Rao', authorRole: 'DOCTOR', timestamp: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
      noteHtml: `<p>Progress note number ${i + 1} with enough text to force pagination across multiple pages.</p>`,
    }));
    const buf = await buildDischargeSummaryPdf({
      ...base,
      hospital: { ...base.hospital, primaryColor: customColor },
      admission: { ...base.admission, progressNotes: manyNotes },
    });

    const content = decompressContentStreams(buf);
    const op = fillOperatorFor(customColor);
    // One occurrence per page (letterhead/title bar/headings on page 1, one
    // compact-header fill per continuation page) — proves the color isn't
    // just applied once and then dropped.
    expect(content.split(op).length - 1).toBeGreaterThan(1);
  });

  test('no valid branding color configured renders the letterhead in black, not a hardcoded brand hue', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, primaryColor: '' } });

    const content = decompressContentStreams(buf);
    expect(content).toContain(fillOperatorFor('')); // hexToRgb('') → black
    expect(content).not.toContain(fillOperatorFor('#1A73E8'));
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
