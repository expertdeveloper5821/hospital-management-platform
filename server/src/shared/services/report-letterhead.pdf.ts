import https from 'https';
import http from 'http';

// ─── Branded A4/Letter report letterhead (PDFKit) ────────────────────────────
// The full-bleed primary-color letterhead band and title bar first used by the
// IPD Discharge Summary (modules/ipd/discharge-summary.pdf.ts), shared so every
// clinical report PDF (e.g. the Pathology test report) carries the same
// hospital header instead of a new design.

export interface ReportHospitalInfo {
  name:               string;
  logoUrl:            string | null;
  primaryColor:       string;
  address:            string | null;
  email:              string | null;
  registrationNumber: string | null; // GSTIN
}

// No valid primary color configured (missing/malformed hex) falls back to
// black rather than a hardcoded brand hue.
export function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(h)) return [0, 0, 0];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Perceived-brightness heuristic (ITU-R BT.601 luma) — picks the readable
// foreground (white on dark brands, near-black on light/pastel brands) for
// text sitting directly on the primary-color letterhead band.
export function getContrastTextColor(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? '#1a1a1a' : '#ffffff';
}

// Best-effort fetch of the hospital logo (a pre-signed S3 URL) — any failure
// or a 3 s timeout resolves null so the letterhead simply omits the logo.
export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
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

/**
 * Full-bleed primary-color band across the top of the first page carrying the
 * logo (aspect-ratio preserved via `fit`, never stretched/cropped) and hospital
 * identity. Falls back cleanly when logo/address/email/GSTIN are unavailable —
 * each line is only drawn when present. Returns the band's height; leaves
 * doc.y 14pt below it at the left margin.
 */
export function drawReportLetterhead(
  doc:        PDFKit.PDFDocument,
  hospital:   ReportHospitalInfo,
  logo:       Buffer | null,
  pageMargin: number,
): number {
  const primary   = hexToRgb(hospital.primaryColor);
  const onPrimary = getContrastTextColor(hospital.primaryColor);

  const LETTERHEAD_PAD_X = pageMargin;
  const LETTERHEAD_PAD_Y = 16;
  const LOGO_BOX = 56;
  const textX = logo ? LETTERHEAD_PAD_X + LOGO_BOX + 14 : LETTERHEAD_PAD_X;
  const textWidth = doc.page.width - textX - pageMargin;

  const metaLines: string[] = [];
  if (hospital.address) metaLines.push(hospital.address);
  if (hospital.email) metaLines.push(hospital.email);
  if (hospital.registrationNumber) metaLines.push(`GSTIN: ${hospital.registrationNumber}`);

  doc.font('Helvetica-Bold').fontSize(16);
  const nameHeight = doc.heightOfString(hospital.name, { width: textWidth });
  doc.font('Helvetica').fontSize(8.5);
  const metaHeight = metaLines.reduce(
    (sum, line) => sum + doc.heightOfString(line, { width: textWidth }) + 2, 0,
  );
  const textBlockHeight = nameHeight + (metaLines.length ? 4 + metaHeight : 0);

  const letterheadHeight = LETTERHEAD_PAD_Y * 2 + Math.max(logo ? LOGO_BOX : 0, textBlockHeight);
  doc.rect(0, 0, doc.page.width, letterheadHeight).fill(primary);
  // Neutral separator so the band stays visible even on near-white brand colors.
  doc.strokeColor('#e0e0e0').lineWidth(0.75)
    .moveTo(0, letterheadHeight).lineTo(doc.page.width, letterheadHeight).stroke();

  const contentY = LETTERHEAD_PAD_Y;
  if (logo) {
    try { doc.image(logo, LETTERHEAD_PAD_X, contentY, { fit: [LOGO_BOX, LOGO_BOX] }); } catch { /* skip */ }
  }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(onPrimary)
    .text(hospital.name, textX, contentY, { width: textWidth });
  if (metaLines.length) {
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8.5).fillColor(onPrimary).fillOpacity(0.85);
    metaLines.forEach((line) => doc.text(line, textX, doc.y, { width: textWidth }));
    doc.fillOpacity(1);
  }

  doc.y = letterheadHeight + 14;
  doc.x = pageMargin;
  doc.fillColor('#1a1a1a');
  return letterheadHeight;
}

// Primary-color title bar with the centered report title (e.g. "PATIENT
// DISCHARGE SUMMARY") directly below the letterhead.
export function drawReportTitleBar(
  doc:          PDFKit.PDFDocument,
  title:        string,
  primaryColor: string,
  pageMargin:   number,
  contentWidth: number,
): void {
  doc.rect(pageMargin, doc.y, contentWidth, 26).fill(hexToRgb(primaryColor));
  doc.fillColor(getContrastTextColor(primaryColor)).font('Helvetica-Bold').fontSize(14)
    .text(title, pageMargin, doc.y + 6, { width: contentWidth, align: 'center', lineBreak: false });
  doc.y += 10;
  doc.fillColor('#1a1a1a');
  doc.moveDown(1);
}
