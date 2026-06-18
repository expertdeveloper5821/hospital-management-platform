import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import https from 'https';
import http from 'http';
import { IPatient } from './patient.model';

export interface BrandingConfig {
  logoUrl?:     string | null;
  displayName:  string;
  primaryColor: string;
}

export function maskAadhaar(aadhaar: string): string {
  const digits = aadhaar.replace(/\D/g, '');
  return `XXXX-XXXX-${digits.slice(-4)}`;
}

// 85.6 × 54 mm landscape at 72 pt/in → 243 × 153 pt
const W = 243;
const H = 153;

const ORANGE  = '#EB6A14';
const NAVY    = '#0A2647';
const CARD_BG = '#E8F5FA';

async function fetchBuffer(url: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const proto = url.startsWith('https') ? https : http;
      const req = proto.get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data',  (c: Buffer) => chunks.push(c));
        res.on('end',   () => resolve(Buffer.concat(chunks)));
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(3000, () => { req.destroy(); resolve(null); });
    } catch {
      resolve(null);
    }
  });
}

export async function buildMedicalCardPdf(
  patient:  IPatient,
  branding: BrandingConfig,
): Promise<Buffer> {
  // QR must succeed or we abort (Req 2 AC-3)
  const qrPayload = JSON.stringify({ patientId: patient.patientId, tenantId: patient.tenantId });
  const qrBuffer  = await QRCode.toBuffer(qrPayload, { type: 'png', width: 220, margin: 1 });

  const accent = branding.primaryColor || '#00B2B2';

  const logo = branding.logoUrl
    ? await fetchBuffer(branding.logoUrl).catch(() => null)
    : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size:    [W, H],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      compress: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      // ── FRONT ───────────────────────────────────────────────────────────────

      // Card background
      doc.rect(0, 0, W, H).fill(CARD_BG);

      // ── Header strip (white) ─────────────────────────────────────────────────
      doc.rect(0, 0, W, 33).fill('white');

      // Logo or placeholder
      if (logo) {
        try { doc.image(logo, 7, 4, { width: 26, height: 26 }); } catch { /* skip */ }
      } else {
        doc.rect(7, 4, 26, 26).fill(accent);
        doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
          .text('H', 7, 10, { width: 26, align: 'center', lineBreak: false });
      }

      // Hospital name
      doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
        .text(branding.displayName.toUpperCase(), 37, 6, { width: W - 44, lineBreak: false });

      // Tagline (orange italic)
      doc.fillColor(ORANGE).fontSize(5.5).font('Helvetica-Oblique')
        .text('Trust of Generations', 37, 17, { width: W - 44, lineBreak: false });

      // Teal divider bar
      doc.rect(0, 33, W, 4).fill(accent);

      // ── Orange banner ────────────────────────────────────────────────────────
      doc.rect(0, 37, W, 14).fill(ORANGE);
      doc.fillColor('white').fontSize(6.5).font('Helvetica-Bold')
        .text('PATIENT DIGITAL HEALTH CARD', 0, 41, { width: W, align: 'center', lineBreak: false });

      // ── QR code (left) ───────────────────────────────────────────────────────
      doc.image(qrBuffer, 8, 53, { width: 74, height: 74 });

      // ── Patient info (right of QR) ───────────────────────────────────────────
      const IX = 88;
      let iy = 54;

      doc.fillColor(NAVY).fontSize(9.5).font('Helvetica-Bold')
        .text(patient.fullName.toUpperCase(), IX, iy, { width: W - IX - 6, lineBreak: false });
      iy += 14;

      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica-Bold')
        .text('Patient ID:', IX, iy, { width: 34, lineBreak: false });
      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica')
        .text(patient.patientId, IX + 35, iy, { width: W - IX - 41, lineBreak: false });
      iy += 9;

      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica-Bold')
        .text('DOB:', IX, iy, { width: 22, lineBreak: false });
      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica')
        .text(patient.dateOfBirth.toISOString().slice(0, 10), IX + 23, iy, { width: 60, lineBreak: false });
      iy += 9;

      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica-Bold')
        .text('Gender:', IX, iy, { width: 27, lineBreak: false });
      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica')
        .text(patient.gender, IX + 28, iy, { width: 50, lineBreak: false });
      iy += 9;

      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica-Bold')
        .text('Mobile:', IX, iy, { width: 27, lineBreak: false });
      doc.fillColor(NAVY).fontSize(5.8).font('Helvetica')
        .text(patient.mobileNumber, IX + 28, iy, { width: 70, lineBreak: false });
      iy += 9;

      if (patient.bloodGroup) {
        doc.rect(IX, iy, 52, 11).fill(accent);
        doc.fillColor('white').fontSize(5.8).font('Helvetica-Bold')
          .text('Blood: ' + patient.bloodGroup, IX + 3, iy + 3, { width: 46, lineBreak: false });
      }

      // ── Footer bar ───────────────────────────────────────────────────────────
      doc.rect(0, H - 18, W, 18).fill(accent);
      const genDate = new Date().toISOString().slice(0, 10);
      doc.fillColor('white').fontSize(4.8).font('Helvetica')
        .text('Issued: ' + genDate, 8, H - 11, { lineBreak: false, width: 100 });
      doc.fillColor('white').fontSize(4.8).font('Helvetica-Bold')
        .text('VALID FOR 1 YEAR', 130, H - 11, { width: W - 138, align: 'right', lineBreak: false });

      // ── BACK ────────────────────────────────────────────────────────────────
      doc.addPage({
        size:    [W, H],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });

      // Card background
      doc.rect(0, 0, W, H).fill(CARD_BG);

      // ── Header strip (same as front) ─────────────────────────────────────────
      doc.rect(0, 0, W, 33).fill('white');

      if (logo) {
        try { doc.image(logo, 7, 4, { width: 26, height: 26 }); } catch { /* skip */ }
      } else {
        doc.rect(7, 4, 26, 26).fill(accent);
        doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
          .text('H', 7, 10, { width: 26, align: 'center', lineBreak: false });
      }

      doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
        .text(branding.displayName.toUpperCase(), 37, 6, { width: W - 44, lineBreak: false });
      doc.fillColor(ORANGE).fontSize(5.5).font('Helvetica-Oblique')
        .text('Trust of Generations', 37, 17, { width: W - 44, lineBreak: false });
      doc.rect(0, 33, W, 4).fill(accent);

      // ── Orange banner ────────────────────────────────────────────────────────
      doc.rect(0, 37, W, 14).fill(ORANGE);
      doc.fillColor('white').fontSize(6.5).font('Helvetica-Bold')
        .text('PATIENT MEDICAL INFORMATION', 0, 41, { width: W, align: 'center', lineBreak: false });

      // ── Two-column body ──────────────────────────────────────────────────────
      const C1 = 10;
      const C2 = 130;
      const LW = 38;

      // Vertical divider (separate save/restore to avoid colour bleed)
      doc.save();
      doc.strokeColor(accent);
      doc.lineWidth(0.5);
      doc.moveTo(C2 - 6, 54);
      doc.lineTo(C2 - 6, H - 22);
      doc.stroke();
      doc.restore();

      // Left column helper
      const lfield = (label: string, value: string, y: number) => {
        doc.fillColor(NAVY).fontSize(5.5).font('Helvetica-Bold')
          .text(label, C1, y, { width: LW, lineBreak: false });
        doc.fillColor(NAVY).fontSize(5.5).font('Helvetica')
          .text(value, C1 + LW, y, { width: C2 - C1 - LW - 10, lineBreak: false });
      };

      // Right column helper
      const rfield = (label: string, value: string, y: number) => {
        doc.fillColor(NAVY).fontSize(5.5).font('Helvetica-Bold')
          .text(label, C2, y, { width: LW, lineBreak: false });
        doc.fillColor(NAVY).fontSize(5.5).font('Helvetica')
          .text(value, C2 + LW, y, { width: W - C2 - LW - 8, lineBreak: false });
      };

      let y1 = 57;
      lfield('Date of Birth:', patient.dateOfBirth.toISOString().slice(0, 10), y1); y1 += 10;
      lfield('Gender:',        patient.gender,        y1); y1 += 10;
      lfield('Mobile:',        patient.mobileNumber,  y1); y1 += 10;
      if (patient.bloodGroup)    { lfield('Blood Group:', patient.bloodGroup,                y1); y1 += 10; }
      if (patient.aadhaarNumber) { lfield('Aadhaar:',     maskAadhaar(patient.aadhaarNumber), y1); y1 += 10; }

      let y2 = 57;
      if (patient.emergencyContactName || patient.emergencyContactMobile) {
        doc.rect(C2, y2, W - C2 - 6, 11).fill(accent);
        doc.fillColor('white').fontSize(5.5).font('Helvetica-Bold')
          .text('IN CASE OF EMERGENCY', C2 + 3, y2 + 3, { width: W - C2 - 12, lineBreak: false });
        y2 += 14;
        if (patient.emergencyContactName)   { rfield('Contact:', patient.emergencyContactName,   y2); y2 += 10; }
        if (patient.emergencyContactMobile) { rfield('Phone:',   patient.emergencyContactMobile, y2); y2 += 10; }
      } else {
        doc.fillColor(NAVY).fontSize(5.2).font('Helvetica')
          .text('No emergency contact on record.', C2, y2 + 4, { width: W - C2 - 10, lineBreak: false });
      }

      // ── Footer bar ───────────────────────────────────────────────────────────
      doc.rect(0, H - 18, W, 18).fill(accent);
      doc.fillColor('white').fontSize(5).font('Helvetica-Bold')
        .text('KEEP THIS CARD SAFE  —  ' + branding.displayName.toUpperCase(),
          0, H - 11, { width: W, align: 'center', lineBreak: false });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
