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
  const [logoBuffer, profileBuffer] = await Promise.all([
    options.logoUrl        ? fetchBuffer(options.logoUrl).catch(() => null)        : Promise.resolve(null),
    options.profileImageUrl ? fetchBuffer(options.profileImageUrl).catch(() => null) : Promise.resolve(null),
  ]);

  return new Promise((resolve, reject) => {
    // A6 landscape: 148×105 mm → ~419×298 pt
    const doc = new PDFDocument({
      size:    [419, 298],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      compress: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = 419;
    const H = 298;
    const [pr, pg, pb] = hexToRgb(options.primaryColor ?? '#2563EB');

    // White background
    doc.rect(0, 0, W, H).fill('white');

    // Top color band
    doc.rect(0, 0, W, 52).fill([pr, pg, pb]);

    // Logo area (top-left of band)
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 12, 10, { width: 32, height: 32, fit: [32, 32] });
      } catch {
        // leave blank
      }
    }

    // Hospital / card title in band
    doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
      .text('STAFF ID CARD', 54, 18, { width: 240, lineBreak: false });

    // Photo / silhouette area (right side of band, extending into body)
    const PHOTO_X = W - 78;
    const PHOTO_Y = 14;
    const PHOTO_W = 60;
    const PHOTO_H = 70;

    if (profileBuffer) {
      try {
        doc.image(profileBuffer, PHOTO_X, PHOTO_Y, { width: PHOTO_W, height: PHOTO_H, fit: [PHOTO_W, PHOTO_H] });
      } catch {
        doc.rect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H).fill('#CCCCCC');
      }
    } else {
      doc.rect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H).fill('#CCCCCC');
      doc.fillColor('#888888').fontSize(8).font('Helvetica')
        .text('Photo', PHOTO_X, PHOTO_Y + PHOTO_H / 2 - 4, { width: PHOTO_W, align: 'center', lineBreak: false });
    }

    // Body fields
    const BODY_X  = 16;
    const FIELD_W = PHOTO_X - BODY_X - 12;
    let y = 62;
    const rowH = 26;

    const field = (label: string, value: string, fy: number): void => {
      doc.fillColor('#777777').fontSize(7).font('Helvetica-Bold')
        .text(label.toUpperCase(), BODY_X, fy, { width: FIELD_W, lineBreak: false });
      doc.fillColor('#111111').fontSize(10).font('Helvetica-Bold')
        .text(value, BODY_X, fy + 9, { width: FIELD_W, lineBreak: false });
    };

    field('Name',        options.name,       y); y += rowH;
    field('Role',        options.role,        y); y += rowH;
    field('Employee ID', options.employeeId,  y); y += rowH;

    // Footer band
    doc.rect(0, H - 36, W, 36).fill([pr, pg, pb]);
    const issued  = options.issuedAt.toISOString().slice(0, 10);
    const expires = options.expiresAt.toISOString().slice(0, 10);
    doc.fillColor('white').fontSize(7).font('Helvetica')
      .text(`Issued: ${issued}`, BODY_X, H - 24, { width: 140, lineBreak: false })
      .text(`Expires: ${expires}`, BODY_X + 150, H - 24, { width: 140, lineBreak: false });

    doc.end();
  });
}
