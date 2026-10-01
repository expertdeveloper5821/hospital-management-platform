import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import https from 'https';
import http from 'http';

export interface StaffIdCardPdfOptions {
  name:            string;
  role:            string;
  employeeId:      string;
  issuedAt:        Date;
  expiresAt:       Date;
  primaryColor:    string;
  // Public verification URL — the ONLY content encoded in the QR code.
  verificationUrl: string;
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

// One object per generation (never overwritten in place), so a PDF and the
// token hash recorded alongside it can't be split apart by a concurrent regenerate.
export function buildS3Key(tenantId: string, userId: string, generationId: string): string {
  return `tenants/${tenantId}/staff-id-cards/${userId}/${generationId}.pdf`;
}

export function computeExpiryDate(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
}

export async function buildStaffIdCardPdf(options: StaffIdCardPdfOptions): Promise<Buffer> {
  // Build the QR matrix up front so an encoding failure rejects before any
  // drawing starts. It is rendered as vector squares (not a raster PNG) so it
  // stays sharp at any print resolution.
  const qr = QRCode.create(options.verificationUrl, { errorCorrectionLevel: 'M' });

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

    // White content area between header and footer: fields on the left,
    // verification QR on the right, both vertically centred in it.
    const BODY_TOP = HEADER_H;
    const BODY_H   = H - HEADER_H - FOOTER_H;
    const QR_SIZE  = 88;
    const QR_GAP   = 14;
    const qrX      = W - PAD - QR_SIZE;
    const qrY      = BODY_TOP + (BODY_H - QR_SIZE) / 2;

    // The surrounding white body (≥ 16pt on every side) doubles as the QR quiet zone.
    const modules = qr.modules;
    const cell    = QR_SIZE / modules.size;
    for (let row = 0; row < modules.size; row++) {
      let col = 0;
      while (col < modules.size) {
        if (!modules.get(row, col)) { col++; continue; }
        // Merge horizontal runs into one rect so no hairline seams appear between modules.
        const start = col;
        while (col < modules.size && modules.get(row, col)) col++;
        doc.rect(qrX + start * cell, qrY + row * cell, (col - start) * cell, cell);
      }
    }
    doc.fill('black');

    doc.fillColor('#777777').fontSize(6).font('Helvetica')
      .text('Scan to verify', qrX, qrY + QR_SIZE + 3, { width: QR_SIZE, align: 'center', lineBreak: false });

    // Body fields — left column, clear of the QR
    const FIELD_W = qrX - QR_GAP - PAD;
    const rowH    = 30;
    const FIELDS_H = rowH * 2 + 10 + 11; // two row gaps + last label + last value
    let y = BODY_TOP + (BODY_H - FIELDS_H) / 2;

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
