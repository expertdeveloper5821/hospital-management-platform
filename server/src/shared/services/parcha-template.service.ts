import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { ValidationError } from '../middleware/error-handler';

// ─── A4 geometry ────────────────────────────────────────────────────────────
// 1 mm in PDF points (72 pt/in ÷ 25.4 mm/in). A4 portrait is 210 × 297 mm —
// the same page the client's .parcha-sheet CSS (@page { size: A4 }) assumes.
export const MM_TO_PT = 72 / 25.4;
export const A4_WIDTH_PT  = 210 * MM_TO_PT;  // ≈ 595.28
export const A4_HEIGHT_PT = 297 * MM_TO_PT;  // ≈ 841.89

// Forgiving tolerance for PDF export/rounding differences between design
// tools (~4mm) — tight enough to reject a Letter-sized or landscape upload,
// loose enough not to punish a template exported at 595 × 842 vs 595.28 × 841.89.
const A4_TOLERANCE_PT = 12;

/**
 * Rejects anything that isn't a single portrait A4 page before it's ever
 * written to S3 — the merge step later assumes exactly one page sized close
 * enough to A4 that the fixed mm-based layout below still lands on the page.
 */
export async function validateSinglePageA4Pdf(buffer: Buffer): Promise<void> {
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true, throwOnInvalidObject: false });
  } catch {
    throw new ValidationError('The uploaded file is not a valid PDF.');
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount !== 1) {
    throw new ValidationError(
      `Parcha template PDF must contain exactly one page (the uploaded file has ${pageCount}).`,
    );
  }

  const page = pdfDoc.getPage(0);
  const { width, height } = page.getSize();
  const matchesA4Portrait =
    Math.abs(width - A4_WIDTH_PT) <= A4_TOLERANCE_PT && Math.abs(height - A4_HEIGHT_PT) <= A4_TOLERANCE_PT;
  if (!matchesA4Portrait) {
    throw new ValidationError(
      'Parcha template PDF must be a single A4 page in portrait orientation (210 × 297 mm).',
    );
  }
}

// ─── Overlay data contract ──────────────────────────────────────────────────
// Deliberately generic (not OPD/IPD-specific) — OPD and IPD each assemble
// their own domain data into this shape (see opd.service.ts/ipd.service.ts),
// and this module only knows how to draw it. Mirrors the field groupings the
// existing HTML print pages already use (Field grid / Vitals box / labelled
// body sections / footer line) so a PDF template renders the same
// information the default and image-template layouts do.
export interface ParchaFieldRow {
  label: string;
  value: string;
}

export interface ParchaBodySection {
  heading: string;
  text:    string;
  // Relative share of the body row's height this section gets when stacked
  // with others (e.g. OPD's Diagnosis/Prescription/Notes) — ignored when
  // there's only one section (e.g. IPD's Progress Notes).
  weight?: number;
}

export interface ParchaOverlayInput {
  fieldRows:     ParchaFieldRow[];  // rendered as a 2-column grid, in order
  vitals:        ParchaFieldRow[];  // always 5 rows (Weight/Height/BP/Sugar/Temp), blank value if unrecorded
  bodySections:  ParchaBodySection[];
  footerText:    string;
}

// ─── Layout constants (mirrors the HTML print pages' template-mode spacing) ─
const MARGIN_X    = 16 * MM_TO_PT; // px-[16mm]
const TOP_RESERVE = 42 * MM_TO_PT; // pt-[42mm] — space the uploaded template's own header design occupies
const BOTTOM_RESERVE = 14 * MM_TO_PT; // pb-[14mm]
const SIGNATURE_RESERVE = 24 * MM_TO_PT;
const FOOTER_RESERVE    = 12 * MM_TO_PT;
const SECTION_GAP  = 4 * MM_TO_PT;
const VITALS_WIDTH = 42 * MM_TO_PT;

const GRAY   = rgb(0.42, 0.42, 0.42);
const DARK   = rgb(0.07, 0.07, 0.07);
const BORDER = rgb(0.78, 0.78, 0.78);

function widthOf(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

// Truncates a single line with an ellipsis so it never overflows its column —
// used for the field grid, where each row is a single "Label: Value" line.
function truncateToWidth(font: PDFFont, text: string, size: number, maxWidth: number): string {
  if (widthOf(font, text, size) <= maxWidth) return text;
  const ellipsis = '…';
  let out = text;
  while (out.length > 0 && widthOf(font, out + ellipsis, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + ellipsis;
}

// Greedy word-wrap for the multi-line body sections (Diagnosis/Prescription/
// Notes, Progress Notes). Long unbroken tokens (e.g. a URL) are hard-split so
// a single word can never overflow maxWidth.
function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === '') { lines.push(''); continue; }
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (widthOf(font, candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (widthOf(font, word, size) <= maxWidth) {
        current = word;
      } else {
        // Hard-split an overlong word character by character.
        let chunk = '';
        for (const ch of word) {
          if (widthOf(font, chunk + ch, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Draws as many wrapped lines as fit in `maxHeight`, marking the last visible
// line with a trailing ellipsis if the text was truncated — a single-page PDF
// template has no "next page" to spill onto, unlike the HTML print layout.
function drawClippedText(
  page: PDFPage, font: PDFFont, text: string, size: number, lineHeight: number,
  x: number, top: number, maxWidth: number, maxHeight: number,
): void {
  if (!text) return;
  const lines = wrapText(font, text, size, maxWidth);
  const maxLines = Math.max(0, Math.floor(maxHeight / lineHeight));
  const visible = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;
  if (truncated && visible.length > 0) {
    const last = visible[visible.length - 1];
    visible[visible.length - 1] = truncateToWidth(font, `${last} …`, size, maxWidth);
  }
  visible.forEach((line, i) => {
    if (!line) return;
    page.drawText(line, { x, y: top - i * lineHeight - size, size, font, color: DARK });
  });
}

function drawFieldGrid(
  page: PDFPage, font: PDFFont, rows: ParchaFieldRow[],
  x: number, top: number, contentWidth: number,
): number {
  const size = 9;
  const rowHeight = 14;
  const colGap = 10 * MM_TO_PT;
  const colWidth = (contentWidth - colGap) / 2;

  rows.forEach((row, i) => {
    const col = i % 2;
    const rowIndex = Math.floor(i / 2);
    const colX = x + col * (colWidth + colGap);
    const y = top - rowIndex * rowHeight - size;
    const text = truncateToWidth(font, `${row.label}: ${row.value}`, size, colWidth);
    page.drawText(text, { x: colX, y, size, font, color: DARK });
  });

  const rowCount = Math.ceil(rows.length / 2);
  return rowCount * rowHeight;
}

// No box/border — the Vitals column is separated from the clinical column
// only by the single vertical divider renderParchaOverlay draws at its right
// edge. Rows stay compact and pinned to the top (a fixed row height, not
// spread across whatever height the divider happens to run to), mirroring
// the HTML print pages' `space-y-*` layout.
function drawVitalsColumn(
  page: PDFPage, font: PDFFont, boldFont: PDFFont, vitals: ParchaFieldRow[],
  x: number, top: number, width: number,
): void {
  const rightPad = 8; // keeps text clear of the divider immediately to its right
  const headingSize = 8;
  page.drawText('VITALS', { x, y: top - headingSize, size: headingSize, font: boldFont, color: GRAY });

  const rowHeight = 13;
  const size = 8.5;
  let rowTop = top - headingSize - 8;
  vitals.forEach((v) => {
    const text = truncateToWidth(font, `${v.label}: ${v.value || '—'}`, size, width - rightPad);
    page.drawText(text, { x, y: rowTop - size, size, font, color: DARK });
    rowTop -= rowHeight;
  });
}

// No box/border — see drawVitalsColumn's comment; the single vertical
// divider renderParchaOverlay draws is the only separator between the two
// columns now.
function drawBodySections(
  page: PDFPage, font: PDFFont, boldFont: PDFFont, sections: ParchaBodySection[],
  x: number, top: number, width: number, height: number,
): void {
  const pad = 6;
  const headingSize = 8;
  const bodySize = 9;
  const lineHeight = 11.5;
  const innerWidth = width - pad * 2;
  const innerTop = top - pad;
  const innerHeight = height - pad * 2;

  const totalWeight = sections.reduce((sum, s) => sum + (s.weight ?? 1), 0) || 1;
  let cursorTop = innerTop;
  sections.forEach((section) => {
    const sectionHeight = innerHeight * ((section.weight ?? 1) / totalWeight);
    page.drawText(section.heading.toUpperCase(), {
      x: x + pad, y: cursorTop - headingSize, size: headingSize, font: boldFont, color: GRAY,
    });
    const bodyTop = cursorTop - headingSize - 4;
    const bodyHeight = sectionHeight - headingSize - 4;
    drawClippedText(page, font, section.text || '—', bodySize, lineHeight, x + pad, bodyTop, innerWidth, bodyHeight);
    cursorTop -= sectionHeight;
  });
}

/**
 * Loads the tenant-supplied single-page PDF template and draws the visit's/
 * admission's dynamic data onto that same page — the returned PDF IS the
 * uploaded template (same design, same background), not a fresh document, so
 * the hospital's letterhead/artwork stays intact and only the fixed header
 * region the app already reserves (TOP_RESERVE) is skipped, exactly like the
 * image-template path.
 */
export async function renderParchaOverlay(templateBytes: Buffer, input: ParchaOverlayInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const page = pdfDoc.getPage(0);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const contentX     = MARGIN_X;
  const contentWidth = pageWidth - MARGIN_X * 2;
  const contentTop   = pageHeight - TOP_RESERVE;

  const gridHeight = drawFieldGrid(page, font, input.fieldRows, contentX, contentTop, contentWidth);

  const dividerY = contentTop - gridHeight - 6;
  page.drawLine({
    start: { x: contentX, y: dividerY }, end: { x: contentX + contentWidth, y: dividerY },
    thickness: 0.75, color: BORDER,
  });

  const boxTop = dividerY - SECTION_GAP;
  const boxBottom = BOTTOM_RESERVE + SIGNATURE_RESERVE + FOOTER_RESERVE;
  const boxHeight = Math.max(20, boxTop - boxBottom);

  drawVitalsColumn(page, font, boldFont, input.vitals, contentX, boxTop, VITALS_WIDTH);

  // Single vertical divider between Vitals and the clinical column — spans
  // the full content-row height (boxHeight), from its top to its bottom,
  // aligned with the clinical column regardless of how short the Vitals
  // content itself is.
  const dividerX = contentX + VITALS_WIDTH;
  page.drawLine({
    start: { x: dividerX, y: boxTop }, end: { x: dividerX, y: boxTop - boxHeight },
    thickness: 0.75, color: BORDER,
  });

  const bodyX     = contentX + VITALS_WIDTH + SECTION_GAP;
  const bodyWidth = contentWidth - VITALS_WIDTH - SECTION_GAP;
  drawBodySections(page, font, boldFont, input.bodySections, bodyX, boxTop, bodyWidth, boxHeight);

  // Signature line, bottom-right.
  const sigWidth = 55 * MM_TO_PT;
  const sigY = BOTTOM_RESERVE + FOOTER_RESERVE + 10;
  page.drawLine({
    start: { x: contentX + contentWidth - sigWidth, y: sigY },
    end:   { x: contentX + contentWidth,             y: sigY },
    thickness: 0.75, color: BORDER,
  });
  page.drawText("Doctor's Signature", {
    x: contentX + contentWidth - sigWidth, y: sigY - 10, size: 8, font, color: GRAY,
  });

  // Footer, centered.
  if (input.footerText) {
    const footerSize = 7.5;
    const footerW = widthOf(font, input.footerText, footerSize);
    page.drawText(input.footerText, {
      x: contentX + (contentWidth - footerW) / 2, y: BOTTOM_RESERVE / 2, size: footerSize, font, color: GRAY,
    });
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
