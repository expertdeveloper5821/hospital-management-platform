import PDFDocument from 'pdfkit';
import { DischargeSummaryData } from './ipd.types';
import { parseRichTextToBlocks, renderRichTextBlocks } from '../../shared/services/rich-text-pdf';
import {
  hexToRgb, getContrastTextColor, fetchImageBuffer, drawReportLetterhead, drawReportTitleBar,
} from '../../shared/services/report-letterhead.pdf';

// The letterhead helpers now live in shared/services/report-letterhead.pdf.ts
// (reused by other report PDFs) — re-exported for existing importers.
export { hexToRgb, getContrastTextColor };

const PAGE_MARGIN = 40;
const CONTENT_WIDTH = 612 - PAGE_MARGIN * 2; // Letter width (72pt/in × 8.5in) minus margins

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

export async function buildDischargeSummaryPdf(data: DischargeSummaryData): Promise<Buffer> {
  // pdfkit's color normalizer only accepts hex strings, named colors, or
  // [r,g,b]/[c,m,y,k] arrays — a CSS `rgb(r,g,b)` string silently fails to
  // normalize, so `.fill()`/`.fillColor()` become no-ops and every branded
  // element quietly keeps whatever fill color was last set (black, for the
  // very first shape in the document). Pass the array form instead.
  const [pr, pg, pb] = hexToRgb(data.hospital.primaryColor);
  const primary: [number, number, number] = [pr, pg, pb];
  const onPrimary = getContrastTextColor(data.hospital.primaryColor);
  const logo = data.hospital.logoUrl ? await fetchImageBuffer(data.hospital.logoUrl).catch(() => null) : null;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      compress: true,
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      // ── Page-break-aware section helper ─────────────────────────────────────
      const pageBottom = () => doc.page.height - doc.page.margins.bottom;

      function ensureSpace(minHeight: number): void {
        if (doc.y + minHeight > pageBottom()) doc.addPage();
      }

      function sectionHeading(title: string): void {
        ensureSpace(28);
        doc.moveDown(0.6);
        doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 20).fill(primary);
        doc.fillColor('white').font('Helvetica-Bold').fontSize(11)
          .text(title, PAGE_MARGIN + 8, doc.y + 5, { width: CONTENT_WIDTH - 16, lineBreak: false });
        doc.y += 8;
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.5);
        doc.fillColor('#1a1a1a');
      }

      // label/value row — entirely skipped when value is null/undefined/empty,
      // per the "omit rather than placeholder" policy.
      function field(label: string, value: string | null | undefined): void {
        if (value === null || value === undefined || value === '') return;
        ensureSpace(16);
        const labelWidth = 130;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#444')
          .text(label, PAGE_MARGIN, doc.y, { continued: true, width: labelWidth });
        doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
          .text(value, { width: CONTENT_WIDTH - labelWidth });
        doc.moveDown(0.25);
      }

      function richTextField(label: string, html: string | null | undefined): void {
        const blocks = parseRichTextToBlocks(html);
        if (blocks.length === 0) return;
        ensureSpace(16);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#444').text(label, PAGE_MARGIN, doc.y);
        doc.moveDown(0.15);
        renderRichTextBlocks(doc, blocks, { x: PAGE_MARGIN + 8, width: CONTENT_WIDTH - 8, baseFontSize: 9, color: '#1a1a1a' });
        doc.moveDown(0.35);
      }

      function subheading(text: string): void {
        ensureSpace(18);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(primary)
          .text(text, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.fillColor('#1a1a1a');
        doc.moveDown(0.2);
      }

      function divider(): void {
        ensureSpace(10);
        doc.moveDown(0.15);
        doc.strokeColor('#dddddd').lineWidth(0.5)
          .moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, doc.y).stroke();
        doc.moveDown(0.35);
      }

      // Compact branded running header on every page after the first — a thin
      // primary-color bar (not the full letterhead) so it doesn't compete
      // with the section content for space on continuation pages.
      const COMPACT_HEADER_HEIGHT = 26;
      doc.on('pageAdded', () => {
        doc.rect(0, 0, doc.page.width, COMPACT_HEADER_HEIGHT).fill(primary);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(onPrimary)
          .text(data.hospital.name, PAGE_MARGIN, 8, { continued: true, width: CONTENT_WIDTH / 2, lineBreak: false });
        doc.font('Helvetica').fontSize(8).fillColor(onPrimary).fillOpacity(0.85)
          .text(`  Discharge Summary — ${data.patient.fullName} (${data.patient.patientId})`, { lineBreak: false });
        doc.fillOpacity(1);
        doc.y = COMPACT_HEADER_HEIGHT + 14;
        doc.x = PAGE_MARGIN;
        doc.fillColor('#1a1a1a');
      });

      // ── Letterhead (first page) + title bar ──────────────────────────────────
      drawReportLetterhead(doc, data.hospital, logo, PAGE_MARGIN);
      drawReportTitleBar(doc, 'PATIENT DISCHARGE SUMMARY', data.hospital.primaryColor, PAGE_MARGIN, CONTENT_WIDTH);

      // ── Patient Information ──────────────────────────────────────────────────
      sectionHeading('Patient Information');
      field('Patient Name:', data.patient.fullName);
      field('UHID:', data.patient.patientId);
      field('Age / Gender:', `${data.patient.age} years / ${data.patient.gender}`);
      field('Mobile Number:', data.patient.mobileNumber);
      field('Address:', data.patient.address);
      field('Registered On:', formatDate(data.patient.registeredAt));
      field('Registered By:', data.patient.registeredByName);

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

      // ── IPD Admission Details ────────────────────────────────────────────────
      sectionHeading('IPD Admission Details');
      field('Ward:', data.admission.wardName);
      field('Bed:', data.admission.bedNumber);
      field('Department:', data.admission.departmentName);
      field('Assigned Doctor(s):', data.admission.assignedDoctorNames.join(', '));
      field('Assigned Nurse(s):', data.admission.assignedNurseNames.join(', '));
      field('Admission Date:', formatDate(data.admission.admissionDate));
      field('Discharge Date:', formatDateTime(data.admission.dischargeDate));
      field('Discharged By:', data.admission.dischargedByName);

      // ── Discharge Summary Notes ──────────────────────────────────────────────
      // Plain text entered at final discharge, with who finalized it and the
      // actual final-submission time (admission.dischargeDate — not the PDF
      // generation time). Omitted entirely for admissions discharged before
      // these notes were captured.
      if (data.admission.dischargeSummaryNotes) {
        sectionHeading('Discharge Summary Notes');
        doc.font('Helvetica').fontSize(9.5).fillColor('#1a1a1a')
          .text(data.admission.dischargeSummaryNotes, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.5);
        field('Discharged By:', data.admission.dischargedByName);
        field('Discharged On:', formatDateTime(data.admission.dischargeDate));
      }

      // ── Progress Notes ───────────────────────────────────────────────────────
      if (data.admission.progressNotes.length > 0) {
        sectionHeading('Progress Notes');
        data.admission.progressNotes.forEach((note, i) => {
          if (i > 0) divider();
          const attribution = note.authorName
            ? `${formatDateTime(note.timestamp)} — ${note.authorName}${note.authorRole ? ` (${note.authorRole})` : ''}`
            : formatDateTime(note.timestamp);
          subheading(attribution);
          renderRichTextBlocks(doc, parseRichTextToBlocks(note.noteHtml), {
            x: PAGE_MARGIN, width: CONTENT_WIDTH, baseFontSize: 9.5, color: '#1a1a1a',
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
          if (req.reportUrl) {
            ensureSpace(14);
            doc.font('Helvetica-Bold').fontSize(9).fillColor(primary)
              .text('View Report', PAGE_MARGIN, doc.y, { link: req.reportUrl, underline: true });
            doc.fillColor('#1a1a1a');
            doc.moveDown(0.25);
          }
        });
      }

      // ── Billing & Payment Summary ────────────────────────────────────────────
      if (data.billing) {
        sectionHeading('Billing & Payment Summary');
        const colWidths = [95, 195, 90, 90, CONTENT_WIDTH - 95 - 195 - 90 - 90];
        const headers = ['Date', 'Description', 'Method', 'Status', 'Amount'];

        function tableRow(cells: string[], bold = false): void {
          ensureSpace(16);
          let x = PAGE_MARGIN;
          const rowY = doc.y;
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor('#1a1a1a');
          cells.forEach((cell, idx) => {
            doc.text(cell, x, rowY, { width: colWidths[idx], lineBreak: false, ellipsis: true });
            x += colWidths[idx];
          });
          doc.y = rowY + 14;
          doc.x = PAGE_MARGIN;
        }

        tableRow(headers, true);
        divider();
        data.billing.payments.forEach((p) => {
          tableRow([
            formatDate(p.createdAt),
            p.description,
            p.paymentMethod,
            p.status,
            formatCurrency(p.amount, 'Helvetica'),
          ]);
        });
        doc.moveDown(0.5);
        ensureSpace(20);
        doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 22).fill('#f0f0f0');
        doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
          .text('Total Collected (Completed Payments):', PAGE_MARGIN + 8, doc.y + 6, { continued: true, width: CONTENT_WIDTH - 150 });
        doc.text(formatCurrency(data.billing.total, 'Helvetica-Bold'), { align: 'right', width: 100 });
        doc.y += 6;
      }

      // ── Footer: generation notice + page numbers ─────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(7.5).fillColor('#999')
          .text(
            `Generated on ${formatDateTime(data.generatedAt)} — Page ${i - range.start + 1} of ${range.count}`,
            PAGE_MARGIN, doc.page.height - PAGE_MARGIN + 10,
            { width: CONTENT_WIDTH, align: 'center', lineBreak: false },
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
