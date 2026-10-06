import PDFDocument from 'pdfkit';
import { DischargeSummaryData } from './ipd.types';
import { parseRichTextToBlocks, renderRichTextBlocks } from '../../shared/services/rich-text-pdf';
import {
  hexToRgb, getContrastTextColor, fetchImageBuffer, ReportHospitalInfo,
} from '../../shared/services/report-letterhead.pdf';

// The letterhead helpers now live in shared/services/report-letterhead.pdf.ts
// (reused by other report PDFs) — re-exported for existing importers.
export { hexToRgb, getContrastTextColor };

// ─── IPD Discharge Summary PDF ───────────────────────────────────────────────
// Plain A4, white page, black text, bold headings and thin black rules only —
// no fills or brand colours. The top 3.5 cm and bottom 2 cm of every page stay
// blank, same as the OPD/IPD print slips (pt-[35mm] / pb-[20mm]) and the
// Pathology report, so the Print copy can go onto the hospital's own
// letterhead paper. The patient / admission details grid is laid out like the
// OPD slip. Content flows onto as many A4 pages as it needs; continuation
// pages carry a one-line running header. No "Generated on" / page-number
// footer.
//
// Two copies, identical content and page breaks:
//   - Download (default): the blank top band of every page also carries a
//     black-text, no-fill hospital letterhead (logo, name, address, email,
//     GSTIN).
//   - Print (`{ print: true }`): no letterhead — the band stays blank.

export interface DischargeSummaryPdfOptions {
  print?: boolean;
}

const MM            = 72 / 25.4;
const PAGE_MARGIN   = 40;       // left / right
const TOP_MARGIN    = 35 * MM;  // 3.5 cm blank (letterhead band on the downloaded copy)
const BOTTOM_MARGIN = 20 * MM;  // 2 cm blank
const PAGE_WIDTH    = 595.28;   // A4
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const TEXT          = '#000000';
const RULE          = '#000000';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const hh = String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${hh}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

function toDisplay(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// The 14 standard PDF fonts (Helvetica/Helvetica-Bold — the only fonts this
// document uses) are locked to WinAnsiEncoding, which has no glyph for ₹
// (U+20B9): requesting it renders a broken/replacement glyph instead of
// failing. Only a custom embedded (TTF) font can carry the glyph, so the
// symbol is only emitted for fonts outside this standard set.
const STANDARD_PDF_FONTS = new Set([
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Symbol', 'ZapfDingbats',
]);

export function fontSupportsRupeeSymbol(fontName: string): boolean {
  return !STANDARD_PDF_FONTS.has(fontName);
}

export function formatCurrency(amount: number, fontName: string): string {
  const formatted = amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fontSupportsRupeeSymbol(fontName) ? `₹${formatted}` : formatted;
}

// Black-text, no-background letterhead inside the blank top band of the
// current page (same layout as the Pathology report's downloaded copy): logo
// on the left, then hospital name, address and email / GSTIN, closed by a
// thin black rule just above TOP_MARGIN. Each line is only drawn when present
// and clipped to the band, never overflowing into the content.
function drawLetterhead(doc: PDFKit.PDFDocument, hospital: ReportHospitalInfo, logo: Buffer | null): void {
  const PAD_Y    = 18;
  const LOGO_BOX = 52;
  const LINE_H   = 11;
  const ruleY    = TOP_MARGIN - 10;
  const textX    = logo ? PAGE_MARGIN + LOGO_BOX + 12 : PAGE_MARGIN;
  const textW    = PAGE_MARGIN + CONTENT_WIDTH - textX;
  if (logo) {
    try { doc.image(logo, PAGE_MARGIN, PAD_Y, { fit: [LOGO_BOX, LOGO_BOX] }); } catch { /* skip */ }
  }
  doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(15)
    .text(hospital.name, textX, PAD_Y, { width: textW, height: 18, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(8.5);
  let y = PAD_Y + 20;
  const meta = [hospital.email, hospital.registrationNumber ? `GSTIN: ${hospital.registrationNumber}` : null]
    .filter(Boolean).join('   |   ');
  if (hospital.address) {
    const room  = ruleY - 4 - y - (meta ? LINE_H : 0);
    const addrH = Math.max(LINE_H, Math.min(doc.heightOfString(hospital.address, { width: textW }), room));
    doc.text(hospital.address, textX, y, { width: textW, height: addrH, ellipsis: true });
    y += addrH;
  }
  if (meta) {
    doc.text(meta, textX, y, { width: textW, lineBreak: false, ellipsis: true });
  }
  doc.strokeColor(RULE).lineWidth(0.75)
    .moveTo(PAGE_MARGIN, ruleY).lineTo(PAGE_MARGIN + CONTENT_WIDTH, ruleY).stroke();
}

export async function buildDischargeSummaryPdf(
  data: DischargeSummaryData,
  options: DischargeSummaryPdfOptions = {},
): Promise<Buffer> {
  const withLetterhead = !options.print;
  const logo = withLetterhead && data.hospital.logoUrl
    ? await fetchImageBuffer(data.hospital.logoUrl).catch(() => null)
    : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: TOP_MARGIN, bottom: BOTTOM_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      compress: true,
      info: {
        Title:   `Discharge Summary - ${data.patient.fullName} (${data.patient.patientId})`,
        Author:  data.hospital.name,
        Subject: 'Discharge Summary',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      // ── Page-break-aware helpers ─────────────────────────────────────────────
      const pageBottom = () => doc.page.height - doc.page.margins.bottom;

      function ensureSpace(minHeight: number): void {
        if (doc.y + minHeight > pageBottom()) doc.addPage();
      }

      function rule(y: number, width = 0.5): void {
        doc.strokeColor(RULE).lineWidth(width)
          .moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y).stroke();
      }

      // Bold black heading over a thin black rule — no fill.
      function sectionHeading(title: string): void {
        ensureSpace(36);
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT)
          .text(title.toUpperCase(), PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        const y = doc.y + 1;
        rule(y, 0.75);
        doc.y = y + 6;
        doc.x = PAGE_MARGIN;
      }

      // label/value row — entirely skipped when value is null/undefined/empty,
      // per the "omit rather than placeholder" policy.
      // Label and value in two columns, so a long value wraps within the
      // value column; a value longer than the rest of the page flows on.
      function field(label: string, value: string | null | undefined): void {
        if (value === null || value === undefined || value === '') return;
        const labelWidth = 110;
        const valueWidth = CONTENT_WIDTH - labelWidth;
        doc.font('Helvetica').fontSize(9);
        ensureSpace(Math.min(doc.heightOfString(value, { width: valueWidth }), 120) + 4);
        const y = doc.y;
        const page = doc.page;
        doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT)
          .text(label, PAGE_MARGIN, y, { width: labelWidth - 6 });
        const labelBottom = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(TEXT)
          .text(value, PAGE_MARGIN + labelWidth, y, { width: valueWidth });
        if (doc.page === page) doc.y = Math.max(doc.y, labelBottom);
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.25);
      }

      function richTextField(label: string, html: string | null | undefined): void {
        const blocks = parseRichTextToBlocks(html);
        if (blocks.length === 0) return;
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT).text(label, PAGE_MARGIN, doc.y);
        doc.moveDown(0.15);
        renderRichTextBlocks(doc, blocks, { x: PAGE_MARGIN + 8, width: CONTENT_WIDTH - 8, baseFontSize: 9, color: TEXT });
        doc.moveDown(0.35);
      }

      function subheading(text: string): void {
        ensureSpace(18);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT)
          .text(text, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.2);
      }

      function divider(): void {
        ensureSpace(10);
        doc.moveDown(0.15);
        rule(doc.y, 0.25);
        doc.moveDown(0.35);
      }

      // Plain one-line running header on every page after the first, so a
      // loose continuation page still identifies the patient.
      doc.on('pageAdded', () => {
        doc.font('Helvetica').fontSize(8.5).fillColor(TEXT)
          .text(
            `Discharge Summary — ${data.patient.fullName} (${data.patient.patientId}) — continued`,
            PAGE_MARGIN, TOP_MARGIN, { width: CONTENT_WIDTH, height: 11, lineBreak: false, ellipsis: true },
          );
        rule(TOP_MARGIN + 14);
        doc.y = TOP_MARGIN + 24;
        doc.x = PAGE_MARGIN;
      });

      doc.x = PAGE_MARGIN;
      doc.y = TOP_MARGIN;

      // ── Patient / admission grid (OPD slip layout, 3 columns) ────────────────
      const p = data.patient;
      const a = data.admission;
      const cells: Array<[string, string | null]> = [
        ['Patient Name',   p.fullName],
        ['UHID',           p.patientId],
        ['Age / Gender',   `${p.age} years / ${toDisplay(p.gender)}`],
        ['Mobile Number',  p.mobileNumber],
        ['Admission Date', formatDate(a.admissionDate)],
        ['Discharge Date', formatDate(a.dischargeDate)],
        ['Ward / Bed',     [a.wardName, a.bedNumber].filter(Boolean).join(' / ') || null],
        ['Doctor',         a.assignedDoctorNames.join(', ') || null],
        ['Department',     a.departmentName],
      ];
      const gridCells = cells.filter((c): c is [string, string] => !!c[1]);

      const COL_GAP = 12;
      const colWidth = (CONTENT_WIDTH - COL_GAP * 2) / 3;
      const cellText = (label: string, value: string, x: number, y: number, width: number, draw: boolean): number => {
        doc.font('Helvetica').fontSize(9);
        const labelText = `${label}: `;
        const h = doc.heightOfString(`${labelText}${value}`, { width });
        if (draw) {
          doc.fillColor(TEXT).font('Helvetica').fontSize(9)
            .text(labelText, x, y, { width, continued: true });
          doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9).text(value);
        }
        return h;
      };
      for (let i = 0; i < gridCells.length; i += 3) {
        const row = gridCells.slice(i, i + 3);
        const heights = row.map(([l, v], c) => cellText(l, v, PAGE_MARGIN + c * (colWidth + COL_GAP), doc.y, colWidth, false));
        const rowH = Math.max(...heights);
        ensureSpace(rowH + 4);
        const y = doc.y;
        row.forEach(([l, v], c) => cellText(l, v, PAGE_MARGIN + c * (colWidth + COL_GAP), y, colWidth, true));
        doc.y = y + rowH + 4;
      }
      if (p.address) {
        const h = cellText('Address', p.address, PAGE_MARGIN, doc.y, CONTENT_WIDTH, false);
        ensureSpace(h + 4);
        const y = doc.y;
        cellText('Address', p.address, PAGE_MARGIN, y, CONTENT_WIDTH, true);
        doc.y = y + h + 4;
      }
      doc.x = PAGE_MARGIN;
      doc.y += 4;
      rule(doc.y, 0.75);
      doc.y += 14;

      // ── Title ────────────────────────────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT)
        .text('DISCHARGE SUMMARY', PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH, align: 'center' });
      doc.x = PAGE_MARGIN;
      doc.moveDown(0.3);

      // ── Admission Details (the rest of the old Patient Information / IPD
      //    Admission Details fields not already shown in the grid) ────────────
      sectionHeading('Admission Details');
      field('Registered On:', formatDate(p.registeredAt));
      field('Registered By:', p.registeredByName);
      field('Assigned Nurse(s):', a.assignedNurseNames.join(', '));
      field('Discharged By:', a.dischargedByName);

      // ── Vitals (fixed 3 × 2 grid) ────────────────────────────────────────────
      // Every cell keeps its slot — an unrecorded vital shows "—" so the grid
      // never shifts. The section is omitted when nothing was recorded.
      const v = a.vitals;
      const withUnit = (val: number | string | null | undefined, unit: string): string =>
        val === null || val === undefined || val === '' ? '—' : `${val} ${unit}`;
      if (v && [v.spo2, v.bloodPressure, v.bodyTemperature, v.sugar, v.height, v.weight]
        .some((x) => x !== null && x !== undefined && x !== '')) {
        sectionHeading('Vitals');
        const vitalRows: Array<Array<[string, string]>> = [
          [['SpO2', withUnit(v.spo2, '%')], ['BP', withUnit(v.bloodPressure, 'mmHg')], ['Temperature', withUnit(v.bodyTemperature, '°F')]],
          [['Sugar', withUnit(v.sugar, 'mg/dL')], ['Height', withUnit(v.height, 'cm')], ['Weight', withUnit(v.weight, 'kg')]],
        ];
        const rowHeights = vitalRows.map((row) =>
          Math.max(...row.map(([l, val], c) => cellText(l, val, PAGE_MARGIN + c * (colWidth + COL_GAP), doc.y, colWidth, false))));
        ensureSpace(rowHeights.reduce((s, h) => s + h + 4, 0));
        vitalRows.forEach((row, r) => {
          const y = doc.y;
          row.forEach(([l, val], c) => cellText(l, val, PAGE_MARGIN + c * (colWidth + COL_GAP), y, colWidth, true));
          doc.y = y + rowHeights[r] + 4;
        });
        doc.x = PAGE_MARGIN;
      }

      // ── Discharge Summary Notes ──────────────────────────────────────────────
      // Plain text entered at final discharge, with who finalized it and the
      // actual final-submission time (admission.dischargeDate — not the PDF
      // generation time). Omitted entirely for admissions discharged before
      // these notes were captured.
      if (a.dischargeSummaryNotes) {
        sectionHeading('Discharge Summary Notes');
        doc.font('Helvetica').fontSize(9.5).fillColor(TEXT)
          .text(a.dischargeSummaryNotes, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.5);
        field('Discharged By:', a.dischargedByName);
        field('Discharged On:', formatDateTime(a.dischargeDate));
      }

      // ── OPD Visit History ────────────────────────────────────────────────────
      if (data.opdVisits.length > 0) {
        sectionHeading('OPD Visit History');
        data.opdVisits.forEach((visit, i) => {
          if (i > 0) divider();
          subheading(`Visit on ${formatDate(visit.visitDate)}  (${visit.status})`);
          field('Department:', visit.departmentName);
          field('Doctor(s):', visit.doctorNames.join(', '));
          field('Diagnosis:', visit.diagnosis);
          field('Prescription:', visit.prescription);
          richTextField('Notes:', visit.notesHtml);
        });
      }

      // ── Progress Notes ───────────────────────────────────────────────────────
      if (a.progressNotes.length > 0) {
        sectionHeading('Progress Notes');
        a.progressNotes.forEach((note, i) => {
          if (i > 0) divider();
          const attribution = note.authorName
            ? `${formatDateTime(note.timestamp)} — ${note.authorName}${note.authorRole ? ` (${note.authorRole})` : ''}`
            : formatDateTime(note.timestamp);
          subheading(attribution);
          renderRichTextBlocks(doc, parseRichTextToBlocks(note.noteHtml), {
            x: PAGE_MARGIN, width: CONTENT_WIDTH, baseFontSize: 9.5, color: TEXT,
          });
          doc.moveDown(0.2);
        });
      }

      // ── Lab Requests / Investigations ────────────────────────────────────────
      if (data.labRequests.length > 0) {
        sectionHeading('Investigations & Lab Requests');
        data.labRequests.forEach((req, i) => {
          if (i > 0) divider();
          subheading(`${req.category === 'PATHOLOGY' ? 'Pathology' : 'Radiology'}: ${req.type}  (${req.status})`);
          field('Priority:', req.priority);
          field('Requested By:', req.requestedByName);
          field('Department:', req.departmentName);
          field('Requested On:', formatDate(req.requestedAt));
          richTextField('Notes:', req.notesHtml);
        });
      }

      // ── Billing & Payment Summary ────────────────────────────────────────────
      if (data.billing) {
        sectionHeading('Billing & Payment Summary');
        const colWidths = [95, 185, 85, 85, CONTENT_WIDTH - 95 - 185 - 85 - 85];
        const headers = ['Date', 'Description', 'Method', 'Status', 'Amount'];

        // Every cell wraps within its column (a 6pt gutter keeps neighbours
        // apart); the row is as tall as its tallest cell and moves to the
        // next page whole, so a long description never overflows or overlaps.
        const CELL_GAP = 6;
        function tableRow(cells: string[], bold = false): void {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(TEXT);
          const widths = colWidths.map((w, idx) => (idx === cells.length - 1 ? w : w - CELL_GAP));
          const rowH = Math.max(...cells.map((cell, idx) => doc.heightOfString(cell || ' ', { width: widths[idx] })));
          ensureSpace(rowH + 4);
          let x = PAGE_MARGIN;
          const rowY = doc.y;
          cells.forEach((cell, idx) => {
            doc.text(cell, x, rowY, { width: widths[idx], align: idx === cells.length - 1 ? 'right' : 'left' });
            x += colWidths[idx];
          });
          doc.y = rowY + rowH + 4;
          doc.x = PAGE_MARGIN;
        }

        tableRow(headers, true);
        divider();
        data.billing.payments.forEach((pay) => {
          tableRow([
            formatDate(pay.createdAt),
            pay.description,
            pay.paymentMethod,
            pay.status,
            formatCurrency(pay.amount, 'Helvetica'),
          ]);
        });
        ensureSpace(24);
        doc.moveDown(0.2);
        rule(doc.y, 0.75);
        const totalY = doc.y + 6;
        doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT)
          .text('Total Collected (Completed Payments):', PAGE_MARGIN, totalY, { width: CONTENT_WIDTH - 110, lineBreak: false });
        doc.text(formatCurrency(data.billing.total, 'Helvetica-Bold'), PAGE_MARGIN + CONTENT_WIDTH - 110, totalY, {
          width: 110, align: 'right', lineBreak: false,
        });
        doc.y = totalY + 16;
        doc.x = PAGE_MARGIN;
      }

      // ── Letterhead (downloaded copy) on every page ───────────────────────────
      if (withLetterhead) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          drawLetterhead(doc, data.hospital, logo);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
