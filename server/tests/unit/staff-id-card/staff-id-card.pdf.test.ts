import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import {
  buildStaffIdCardPdf,
  buildS3Key,
  StaffIdCardPdfOptions,
} from '../../../src/modules/staff-id-card/staff-id-card.pdf';

// Card geometry (must match staff-id-card.pdf.ts)
const W = 340;
const H = 214;
const HEADER_H = 58;
const FOOTER_H = 30;
const BODY_TOP = HEADER_H;
const BODY_BOTTOM = H - FOOTER_H;

const VERIFY_URL = 'https://verify.test.example.com/verify-staff#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function options(overrides: Partial<StaffIdCardPdfOptions> = {}): StaffIdCardPdfOptions {
  return {
    name:            'Dr. Asha Verma',
    role:            'DOCTOR',
    employeeId:      '507f1f77bcf86cd799439011',
    issuedAt:        new Date('2026-01-01T00:00:00Z'),
    expiresAt:       new Date('2027-01-01T00:00:00Z'),
    primaryColor:    '#2563EB',
    verificationUrl: VERIFY_URL,
    logoUrl:         null,
    ...overrides,
  };
}

type Rect = { x: number; y: number; w: number; h: number };
type TextCall = { text: string; x: number; y: number; width?: number };

async function renderAndCapture(opts = options()) {
  const rects: Rect[] = [];
  const texts: TextCall[] = [];
  const proto = PDFDocument.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origRect = proto.rect;
  const origText = proto.text;
  const rectSpy = jest.spyOn(proto, 'rect').mockImplementation(function (this: unknown, ...a: unknown[]) {
    rects.push({ x: a[0] as number, y: a[1] as number, w: a[2] as number, h: a[3] as number });
    return origRect.apply(this, a);
  });
  const textSpy = jest.spyOn(proto, 'text').mockImplementation(function (this: unknown, ...a: unknown[]) {
    const o = (a[3] ?? {}) as { width?: number };
    texts.push({ text: String(a[0]), x: a[1] as number, y: a[2] as number, width: o.width });
    return origText.apply(this, a);
  });
  try {
    const pdf = await buildStaffIdCardPdf(opts);
    return { pdf, rects, texts };
  } finally {
    rectSpy.mockRestore();
    textSpy.mockRestore();
  }
}

// QR module rects are the only small (< 10pt tall) rects on the card.
function qrBounds(rects: Rect[]) {
  const qr = rects.filter((r) => r.h < 10);
  return {
    count:  qr.length,
    left:   Math.min(...qr.map((r) => r.x)),
    right:  Math.max(...qr.map((r) => r.x + r.w)),
    top:    Math.min(...qr.map((r) => r.y)),
    bottom: Math.max(...qr.map((r) => r.y + r.h)),
  };
}

describe('buildStaffIdCardPdf — QR code', () => {
  test('produces a valid PDF', async () => {
    const { pdf } = await renderAndCapture();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('encodes ONLY the verification URL — no name, employee ID, role or other data', async () => {
    const spy = jest.spyOn(QRCode, 'create');
    await buildStaffIdCardPdf(options());
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = spy.mock.calls[0][0];
    expect(payload).toBe(VERIFY_URL);
    expect(payload).not.toContain('507f1f77bcf86cd799439011');
    expect(payload).not.toContain('Asha');
    expect(payload).not.toContain('DOCTOR');
    spy.mockRestore();
  });

  test('QR sits in the WHITE body on the RIGHT side — not in header or footer', async () => {
    const { rects } = await renderAndCapture();
    const b = qrBounds(rects);
    expect(b.count).toBeGreaterThan(20);
    const EPS = 1e-6; // module widths are fractional
    expect(b.top).toBeGreaterThanOrEqual(BODY_TOP);
    expect(b.bottom).toBeLessThanOrEqual(BODY_BOTTOM + EPS);
    expect(b.left).toBeGreaterThan(W / 2);
    expect(b.right).toBeLessThanOrEqual(W - 18 + EPS); // right padding
  });

  test('QR is vertically centred in the body with a quiet zone above and below', async () => {
    const { rects } = await renderAndCapture();
    const b = qrBounds(rects);
    // Top-left finder pattern guarantees a dark module in row 0 and in the last row.
    const qrCentre   = (b.top + b.bottom) / 2;
    const bodyCentre = (BODY_TOP + BODY_BOTTOM) / 2;
    expect(Math.abs(qrCentre - bodyCentre)).toBeLessThan(0.5);
    expect(b.top - BODY_TOP).toBeGreaterThanOrEqual(12);
    expect(BODY_BOTTOM - b.bottom).toBeGreaterThanOrEqual(12);
  });

  test('Name, Role and Employee ID stay on the left and never overlap the QR', async () => {
    const { rects, texts } = await renderAndCapture(options({ name: 'A'.repeat(120) }));
    const b = qrBounds(rects);

    for (const value of ['A'.repeat(120), 'DOCTOR', '507f1f77bcf86cd799439011']) {
      const call = texts.find((t) => t.text === value);
      expect(call).toBeDefined();
      expect(call!.x).toBeLessThan(W / 2);
      expect(call!.x + (call!.width ?? 0)).toBeLessThan(b.left);
      expect(call!.y).toBeGreaterThanOrEqual(BODY_TOP);
      expect(call!.y + 11).toBeLessThanOrEqual(BODY_BOTTOM);
    }

    // Field rows are spaced, not stacked on top of each other.
    const ys = ['NAME', 'ROLE', 'EMPLOYEE ID'].map((l) => texts.find((t) => t.text === l)!.y);
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(24);
    expect(ys[2] - ys[1]).toBeGreaterThanOrEqual(24);
  });

  test('rejects when the URL cannot be encoded', async () => {
    await expect(buildStaffIdCardPdf(options({ verificationUrl: '' }))).rejects.toThrow();
  });
});

describe('buildS3Key', () => {
  test('is unique per generation so a PDF is never overwritten in place', () => {
    expect(buildS3Key('t1', 'u1', 'g1')).toBe('tenants/t1/staff-id-cards/u1/g1.pdf');
    expect(buildS3Key('t1', 'u1', 'g1')).not.toBe(buildS3Key('t1', 'u1', 'g2'));
  });
});
