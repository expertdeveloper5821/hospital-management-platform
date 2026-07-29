import PDFDocument from 'pdfkit';
import https from 'https';
import http from 'http';
import { DischargeSummaryData } from './ipd.types';
import { parseRichTextToBlocks, renderRichTextBlocks } from '../../shared/services/rich-text-pdf';

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

function formatINR(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '#1A73E8').replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [isNaN(r) ? 26 : r, isNaN(g) ? 115 : g, isNaN(b) ? 232 : b];
}

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

export async function buildDischargeSummaryPdf(data: DischargeSummaryData): Promise<Buffer> {
  const [pr, pg, pb] = hexToRgb(data.hospital.primaryColor);
  const primary = `rgb(${pr},${pg},${pb})`;
  const logo = data.hospital.logoUrl ? await fetchBuffer(data.hospital.logoUrl).catch(() => null) : null;

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

      // Small running header on every page after the first.
      doc.on('pageAdded', () => {
        doc.font('Helvetica-Bold').fontSize(9).fillColor(primary)
          .text(data.hospital.name, PAGE_MARGIN, PAGE_MARGIN - 10, { continued: true, width: CONTENT_WIDTH / 2, lineBreak: false });
        doc.font('Helvetica').fontSize(8).fillColor('#666')
          .text(`  Discharge Summary — ${data.patient.fullName} (${data.patient.patientId})`, { lineBreak: false });
        doc.y = PAGE_MARGIN + 10;
        doc.x = PAGE_MARGIN;
        doc.fillColor('#1a1a1a');
      });

      // ── Header (first page) ─────────────────────────────────────────────────
      let headerY = PAGE_MARGIN;
      if (logo) {
        try { doc.image(logo, PAGE_MARGIN, headerY, { fit: [50, 50] }); } catch { /* skip */ }
      }
      const titleX = logo ? PAGE_MARGIN + 62 : PAGE_MARGIN;
      doc.font('Helvetica-Bold').fontSize(16).fillColor(primary)
        .text(data.hospital.name, titleX, headerY, { width: CONTENT_WIDTH - (titleX - PAGE_MARGIN) });
      doc.font('Helvetica').fontSize(8.5).fillColor('#555');
      if (data.hospital.address) doc.text(data.hospital.address, titleX, doc.y, { width: CONTENT_WIDTH - (titleX - PAGE_MARGIN) });
      if (data.hospital.email)   doc.text(data.hospital.email,   titleX, doc.y, { width: CONTENT_WIDTH - (titleX - PAGE_MARGIN) });

      doc.y = Math.max(doc.y, headerY + 55);
      doc.x = PAGE_MARGIN;
      doc.moveDown(0.5);

      doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 26).fill(primary);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(14)
        .text('PATIENT DISCHARGE SUMMARY', PAGE_MARGIN, doc.y + 6, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
      doc.y += 10;
      doc.fillColor('#1a1a1a');
      doc.moveDown(1);

      // ── Patient Information ──────────────────────────────────────────────────
      sectionHeading('Patient Information');
      field('Patient Name:', data.patient.fullName);
      field('Patient ID:', data.patient.patientId);
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
            formatINR(p.amount),
          ]);
        });
        doc.moveDown(0.5);
        ensureSpace(20);
        doc.rect(PAGE_MARGIN, doc.y, CONTENT_WIDTH, 22).fill('#f0f0f0');
        doc.fillColor('#1a1a1a').font('Helvetica-Bold').fontSize(10)
          .text('Total Collected (Completed Payments):', PAGE_MARGIN + 8, doc.y + 6, { continued: true, width: CONTENT_WIDTH - 150 });
        doc.text(formatINR(data.billing.total), { align: 'right', width: 100 });
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
