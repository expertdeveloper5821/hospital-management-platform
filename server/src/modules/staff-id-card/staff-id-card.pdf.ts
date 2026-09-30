import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';

export interface StaffIdCardPdfOptions {
  name:            string;
  role:            string;
  employeeId:      string;
  issuedAt:        Date;
  expiresAt:       Date;
  primaryColor:    string;
  logoUrl?:        string | null;
  // Accepted for call-site compatibility; the card no longer renders a photo.
  profileImageUrl?: string | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex ?? '#2563EB').replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [isNaN(r) ? 37 : r, isNaN(g) ? 99 : g, isNaN(b) ? 235 : b];
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => { req.destroy(); resolve(null); });
  });
}

export function buildS3Key(tenantId: string, userId: string): string {
  return `tenants/${tenantId}/staff-id-cards/${userId}.pdf`;
}

export function computeExpiryDate(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
}

export async function buildStaffIdCardPdf(options: StaffIdCardPdfOptions): Promise<Buffer> {
  const logoBuffer = options.logoUrl
    ? await fetchBuffer(options.logoUrl).catch(() => null)
    : null;

  return new Promise((resolve, reject) => {
    // Compact landscape card: 340×214 pt (~120×75 mm, ID-1 aspect ratio)
    const W = 340;
    const H = 214;

    const doc = new PDFDocument({
      size:    [W, H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      compress: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const [pr, pg, pb] = hexToRgb(options.primaryColor ?? '#2563EB');
    const PAD      = 18;
    const HEADER_H = 58;
    const FOOTER_H = 30;

    // White background
    doc.rect(0, 0, W, H).fill('white');

    // Header band
    doc.rect(0, 0, W, HEADER_H).fill([pr, pg, pb]);

    // Logo on a white tile so it stays legible against any brand colour
    const LOGO_TILE = 44;
    const LOGO_SIZE = 38;
    const logoTileY = (HEADER_H - LOGO_TILE) / 2;
    let titleX = PAD;

    if (logoBuffer) {
      try {
        doc.roundedRect(PAD, logoTileY, LOGO_TILE, LOGO_TILE, 6).fill('white');
        const inset = (LOGO_TILE - LOGO_SIZE) / 2;
        doc.image(logoBuffer, PAD + inset, logoTileY + inset, {
          fit: [LOGO_SIZE, LOGO_SIZE], align: 'center', valign: 'center',
        });
        titleX = PAD + LOGO_TILE + 12;
      } catch {
        // unreadable logo — title falls back to the left edge
      }
    }

    // Card title, vertically centred in the header
    doc.fillColor('white').fontSize(13).font('Helvetica-Bold')
      .text('STAFF ID CARD', titleX, HEADER_H / 2 - 6, { width: W - titleX - PAD, lineBreak: false });

    // Body fields — full width now that there is no photo column
    const FIELD_W = W - PAD * 2;
    const rowH    = 30;
    let y = HEADER_H + 14;

    const field = (label: string, value: string, fy: number): void => {
      doc.fillColor('#777777').fontSize(7).font('Helvetica-Bold')
        .text(label.toUpperCase(), PAD, fy, { width: FIELD_W, lineBreak: false, characterSpacing: 0.5 });
      doc.fillColor('#111111').fontSize(11).font('Helvetica-Bold')
        .text(value, PAD, fy + 10, { width: FIELD_W, lineBreak: false, ellipsis: true });
    };

    field('Name',        options.name,       y); y += rowH;
    field('Role',        options.role,       y); y += rowH;
    field('Employee ID', options.employeeId, y);

    // Footer band — issued on the left, expiry on the right
    doc.rect(0, H - FOOTER_H, W, FOOTER_H).fill([pr, pg, pb]);
    const issued  = options.issuedAt.toISOString().slice(0, 10);
    const expires = options.expiresAt.toISOString().slice(0, 10);
    const footerY = H - FOOTER_H / 2 - 3.5;
    const halfW   = (W - PAD * 2) / 2;
    doc.fillColor('white').fontSize(8).font('Helvetica')
      .text(`Issued: ${issued}`,   PAD,         footerY, { width: halfW, lineBreak: false })
      .text(`Expires: ${expires}`, PAD + halfW, footerY, { width: halfW, align: 'right', lineBreak: false });

    doc.end();
  });
}
