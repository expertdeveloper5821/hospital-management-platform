import PDFDocument from 'pdfkit';
import { ReportHospitalInfo } from '../../shared/services/report-letterhead.pdf';
import { LabEncounterSummary, PathologyResultValue } from './lab.types';
import { DOCTOR_SIGNATURE_IMAGE, SIGNING_DOCTOR } from './doctor-signature.image';

// ─── Pathology test report PDF ───────────────────────────────────────────────
// One PDF per test of a Pathology request — never several tests combined.
// Plain A4, black text and thin black rules only — no hospital header/logo,
// colours or fills (the sheet may be printed on the
// hospital's own letterhead, so the top 3.5 cm and bottom 2 cm of every page
// stay blank, same as the OPD/IPD slips). A fixed 2-column patient / encounter
// grid (Name Age/Gender | Collection Date, UHID | Reporting Date, Referred By |
// Ward/Bed, Department), the centred test name, then the structured results
// table — rows separated by spacing only, out-of-range results in bold. Every
// cell wraps (never truncated) and a row that doesn't fit moves to the next
// page with the table header repeated. `hospital` / `reportedByName` stay in the data
// contract (PDF metadata only) so the service is unchanged.
//
// Below the results table come the test's Test Master content — "Clinical
// Notes" and, only for tests that have one, "Comment" — each omitted when
// empty. The texts are passed in (read from the Test Master by the service);
// none are hardcoded here.
//
// Every copy (Download and Print) closes with a bold "End of Report" line
// (short rule either side) and
// a Doctor Signature block at the bottom-right (signature image, doctor's name
// and designation — see doctor-signature.image.ts), followed at the very
// bottom by the "Please Correlate Clinically" footer (when its text is set). Downloaded copy only (`letterhead` set): the blank top 3.5 cm
// of every page also carries a black-text, no-fill hospital letterhead (logo,
// name, registration number, address). Everything else is identical.

export interface PathologyReportPdfData {
  hospital: ReportHospitalInfo;
  patient: {
    fullName:     string;
    patientId:    string;   // UHID
    age:          number | null;
    gender:       string | null;
    mobileNumber: string | null;
    address:      string | null;
  };
  request: {
    requestId:      string;
    requestedAt:    string;
    referredByName: string;
  };
  encounter: LabEncounterSummary | null;
  test: {
    testName:     string;
    values:       PathologyResultValue[];   // filled values only
    // From the Test Master; null/empty → the section is omitted.
    clinicalNote: string | null;
    comment:      string | null;
  };
  // Report-level footer text from the Test Master; null/empty → omitted.
  correlateClinically: string | null;
  reportedByName: string;
  reportedAt:     string;   // test report submission time = report date
  // Set only for the downloaded copy — see the header comment.
  letterhead?:    { logo: Buffer | null } | null;
}

const MM            = 72 / 25.4;
const PAGE_MARGIN   = 40;       // left / right
const TOP_MARGIN    = 35 * MM;  // 3.5 cm blank for the letterhead (OPD/IPD slips: pt-[35mm])
const BOTTOM_MARGIN = 20 * MM;  // 2 cm blank (OPD/IPD slips: pb-[20mm])
const PAGE_WIDTH    = 595.28;   // A4
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const FOOTER_SPACE  = 24;       // kept clear above the bottom margin (below the signature)
const TEXT          = '#000000';
const RULE          = '#000000';
const REPORT_TZ     = 'Asia/Kolkata';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: REPORT_TZ, day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(iso));
}

// Parameter | Value | Unit | Bio. Ref. Interval
const COLUMNS = [
  { title: 'Parameter',          width: 0.36 },
  { title: 'Value',              width: 0.20 },
  { title: 'Unit',               width: 0.16 },
  { title: 'Bio. Ref. Interval', width: 0.28 },
].map((c) => ({ ...c, width: CONTENT_WIDTH * c.width }));
const CELL_PAD_X = 5;
const CELL_PAD_Y = 4;

// Greek letters a test name may contain (e.g. "Pregnancy Test (Urine β-hCG)")
// that Helvetica's WinAnsiEncoding lacks. On a single line they are drawn
// from the standard Symbol font (on the Latin key given here) sharing the
// line's baseline; text that has to wrap spells them out instead.
// `width` is the glyph's advance from the Symbol AFM (1/1000 em) — PDFKit's
// own metrics look the Latin key up by its Latin glyph name, which the Symbol
// font doesn't have, and so measure it as 0.
const SYMBOL_GLYPHS: Record<string, { key: string; name: string; width: number }> = {
  'α': { key: 'a', name: 'alpha', width: 631 },
  'β': { key: 'b', name: 'beta',  width: 549 },
  'γ': { key: 'g', name: 'gamma', width: 411 },
};
const SYMBOL_TEST  = /[αβγ]/;
const SYMBOL_SPLIT = /([αβγ])/;

// Greek letters spelled out — the measuring form and the wrapping fallback.
function spelledOut(text: string): string {
  return text.replace(/[αβγ]/g, (c) => SYMBOL_GLYPHS[c].name);
}

function fontAscent(doc: PDFKit.PDFDocument, font: string, size: number): number {
  doc.font(font).fontSize(size);
  return ((doc as unknown as { _font: { ascender: number } })._font.ascender / 1000) * size;
}

// doc.text() that also renders SYMBOL_GLYPHS letters correctly.
function writeText(
  doc: PDFKit.PDFDocument, text: string, font: string, size: number,
  x: number, y: number, opts: PDFKit.Mixins.TextOptions,
): void {
  if (!SYMBOL_TEST.test(text)) {
    doc.font(font).fontSize(size).text(text, x, y, opts);
    return;
  }
  const parts = text.split(SYMBOL_SPLIT).filter((part) => part !== '')
    .map((part) => SYMBOL_GLYPHS[part]
      ? { text: SYMBOL_GLYPHS[part].key, font: 'Symbol', advance: (SYMBOL_GLYPHS[part].width / 1000) * size }
      : { text: part, font, advance: null as number | null });
  const widthOf = (part: { text: string; font: string; advance: number | null }) => {
    if (part.advance !== null) return part.advance;
    doc.font(part.font).fontSize(size);
    return doc.widthOfString(part.text);
  };
  const total = parts.reduce((sum, part) => sum + widthOf(part), 0);
  if (opts.width !== undefined && total > opts.width) {
    doc.font(font).fontSize(size).text(spelledOut(text), x, y, opts);
    return;
  }
  const baseline = fontAscent(doc, font, size);
  let cx = opts.align === 'center' && opts.width !== undefined ? x + (opts.width - total) / 2 : x;
  for (const part of parts) {
    const shift = baseline - fontAscent(doc, part.font, size);
    doc.text(part.text, cx, y + shift, { lineBreak: false });
    cx += widthOf(part);
  }
  doc.font(font).fontSize(size);
  doc.x = x;
  doc.y = y + doc.currentLineHeight(true);
}

// Black-text, no-background letterhead inside the blank top band of the
// current page: logo on the left, then hospital name, registration number and
// address, closed by a thin black rule just above TOP_MARGIN. Each line is only
// drawn when present; the address is clipped to the band, never overflowing it.
function drawLetterhead(doc: PDFKit.PDFDocument, hospital: ReportHospitalInfo, logo: Buffer | null): void {
  const PAD_Y    = 18;
  const LOGO_BOX = 52;
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
  if (hospital.registrationNumber) {
    doc.text(`Registration No.: ${hospital.registrationNumber}`, textX, y, { width: textW, lineBreak: false, ellipsis: true });
    y += 11;
  }
  if (hospital.address) {
    doc.text(hospital.address, textX, y, { width: textW, height: Math.max(ruleY - 4 - y, 11), ellipsis: true });
  }
  doc.strokeColor(RULE).lineWidth(0.75)
    .moveTo(PAGE_MARGIN, ruleY).lineTo(PAGE_MARGIN + CONTENT_WIDTH, ruleY).stroke();
}

export async function buildPathologyReportPdf(data: PathologyReportPdfData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: TOP_MARGIN, bottom: BOTTOM_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
      bufferPages: true,
      compress: true,
      info: {
        Title:   `${data.test.testName} - ${data.patient.fullName} (${data.patient.patientId})`,
        Author:  data.hospital.name,
        Subject: 'Pathology Report',
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      const pageBottom = () => doc.page.height - doc.page.margins.bottom - FOOTER_SPACE;
      // Set while the results table is being drawn, so a page break inside it
      // repeats the column header on the new page.
      let inTable = false;

      function ensureSpace(minHeight: number): void {
        if (doc.y + minHeight > pageBottom()) {
          doc.addPage();
          if (inTable) drawTableHeader();
        }
      }

      function rule(y: number, width = 0.5): void {
        doc.strokeColor(RULE).lineWidth(width)
          .moveTo(PAGE_MARGIN, y).lineTo(PAGE_MARGIN + CONTENT_WIDTH, y).stroke();
      }

      // Plain one-line running header on every page after the first, so a
      // loose continuation page still identifies the patient and test.
      doc.on('pageAdded', () => {
        doc.fillColor(TEXT);
        writeText(
          doc,
          `Pathology Report — ${data.test.testName} — ${data.patient.fullName} (${data.patient.patientId}) — continued`,
          'Helvetica', 8.5, PAGE_MARGIN, TOP_MARGIN, { width: CONTENT_WIDTH, height: 11, lineBreak: false, ellipsis: true },
        );
        rule(TOP_MARGIN + 14);
        doc.y = TOP_MARGIN + 24;
        doc.x = PAGE_MARGIN;
      });

      doc.x = PAGE_MARGIN;
      doc.y = TOP_MARGIN;

      // ── Patient / encounter grid (fixed 2-column layout) ───────────────────
      //   Patient Name (Name Age/G) | Collection Date
      //   UHID                      | Reporting Date
      //   Referred By               | Ward/Bed
      //   Department
      // Every label always prints (unrecorded → "—") so the rows stay aligned.
      const p = data.patient;
      const enc = data.encounter;
      const ageGender = [
        p.age !== null ? String(p.age) : null,
        p.gender ? p.gender.trim().charAt(0).toUpperCase() : null,
      ].filter(Boolean).join('/');
      const wardBed = enc?.type === 'IPD'
        ? [enc.wardName, enc.bedNumber].filter(Boolean).join(' / ')
        : '';
      const gridCells: Array<[string, string]> = [
        ['Patient Name',    [p.fullName, ageGender].filter(Boolean).join(' ')],
        ['Collection Date', formatDate(data.request.requestedAt)],
        ['UHID',            p.patientId],
        ['Reporting Date',  formatDate(data.reportedAt)],
        ['Referred By',     data.request.referredByName || '—'],
        ['Ward/Bed',        wardBed || '—'],
        ['Department',      enc?.departmentName || '—'],
      ];

      const GRID_COLS = 2;
      const COL_GAP = 16;
      const colWidth = (CONTENT_WIDTH - COL_GAP * (GRID_COLS - 1)) / GRID_COLS;
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
      for (let i = 0; i < gridCells.length; i += GRID_COLS) {
        const row = gridCells.slice(i, i + GRID_COLS);
        const rowY = doc.y;
        const heights = row.map(([l, v], c) => cellText(l, v, PAGE_MARGIN + c * (colWidth + COL_GAP), rowY, colWidth, false));
        const rowH = Math.max(...heights);
        ensureSpace(rowH + 5);
        const y = doc.y;
        row.forEach(([l, v], c) => cellText(l, v, PAGE_MARGIN + c * (colWidth + COL_GAP), y, colWidth, true));
        doc.y = y + rowH + 5;
      }
      doc.x = PAGE_MARGIN;

      doc.y += 4;
      rule(doc.y, 0.75);
      doc.y += 16;

      // ── Test name heading (centred) ────────────────────────────────────────
      doc.font('Helvetica-Bold').fontSize(12);
      const headingH = doc.heightOfString(spelledOut(data.test.testName), { width: CONTENT_WIDTH });
      ensureSpace(headingH + 50);
      const headingY = doc.y;
      doc.fillColor(TEXT);
      writeText(doc, data.test.testName, 'Helvetica-Bold', 12, PAGE_MARGIN, headingY, { width: CONTENT_WIDTH, align: 'center' });
      doc.y = headingY + headingH + 8;
      doc.x = PAGE_MARGIN;

      // ── Results table ──────────────────────────────────────────────────────
      function drawTableHeader(): void {
        const y = doc.y;
        rule(y, 0.75);
        let x = PAGE_MARGIN;
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEXT);
        COLUMNS.forEach((col) => {
          doc.text(col.title, x + CELL_PAD_X, y + 5, { width: col.width - CELL_PAD_X * 2, lineBreak: false });
          x += col.width;
        });
        rule(y + 18, 0.75);
        doc.y = y + 18;
        doc.x = PAGE_MARGIN;
      }

      function measure(text: string, width: number, font: string): number {
        doc.font(font).fontSize(9);
        return doc.heightOfString(spelledOut(text) || ' ', { width: width - CELL_PAD_X * 2 });
      }

      function drawRow(v: PathologyResultValue): void {
        // A result outside its reference range (flagged HIGH/LOW/ABNORMAL)
        // prints in bold; normal results stay regular.
        const outOfRange = !!v.flag;
        let cells = [
          { text: v.name,                 width: COLUMNS[0].width, font: 'Helvetica' },
          { text: v.value,                width: COLUMNS[1].width, font: outOfRange ? 'Helvetica-Bold' : 'Helvetica' },
          { text: v.unit ?? '',           width: COLUMNS[2].width, font: 'Helvetica' },
          { text: v.referenceRange ?? '', width: COLUMNS[3].width, font: 'Helvetica' },
        ];
        // A free-text result with no unit/range (e.g. a culture's antibiotic
        // list) spans the empty columns instead of wrapping narrow.
        if (!v.unit && !v.referenceRange) {
          cells = [cells[0], { ...cells[1], width: CONTENT_WIDTH - COLUMNS[0].width }];
        }
        const rowH = Math.max(...cells.map((c) => measure(c.text, c.width, c.font))) + CELL_PAD_Y * 2;
        ensureSpace(rowH);
        const y = doc.y;
        let x = PAGE_MARGIN;
        cells.forEach((c) => {
          doc.fillColor(TEXT);
          writeText(doc, c.text, c.font, 9, x + CELL_PAD_X, y + CELL_PAD_Y, { width: c.width - CELL_PAD_X * 2 });
          x += c.width;
        });
        doc.y = y + rowH;
        doc.x = PAGE_MARGIN;
      }

      function drawSectionRow(section: string): void {
        doc.font('Helvetica-Bold').fontSize(9);
        const h = doc.heightOfString(section, { width: CONTENT_WIDTH - CELL_PAD_X * 2 }) + CELL_PAD_Y * 2;
        // Keep a section title together with at least its first row.
        ensureSpace(h + 20);
        const y = doc.y;
        doc.fillColor(TEXT).font('Helvetica-Bold').fontSize(9)
          .text(section, PAGE_MARGIN + CELL_PAD_X, y + CELL_PAD_Y + 2, { width: CONTENT_WIDTH - CELL_PAD_X * 2, underline: true });
        doc.y = y + h + 2;
        doc.x = PAGE_MARGIN;
      }

      drawTableHeader();
      inTable = true;
      let currentSection: string | null = null;
      data.test.values.forEach((v) => {
        if (v.section && v.section !== currentSection) drawSectionRow(v.section);
        currentSection = v.section;
        drawRow(v);
      });
      inTable = false;
      doc.moveDown(0.8);

      // ── Clinical Notes / Comment (Test Master) ─────────────────────────────
      // Each is capped at 2000 characters (well under one page), so a block is
      // kept together on one page rather than split.
      function textSection(title: string, body: string | null): void {
        const text = body?.trim();
        if (!text) return;
        doc.font('Helvetica').fontSize(9.5);
        const bodyH = doc.heightOfString(spelledOut(text), { width: CONTENT_WIDTH });
        ensureSpace(bodyH + 18);
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT).text(title, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.moveDown(0.2);
        doc.fillColor(TEXT);
        writeText(doc, text, 'Helvetica', 9.5, PAGE_MARGIN, doc.y, { width: CONTENT_WIDTH });
        doc.x = PAGE_MARGIN;
        doc.moveDown(0.6);
      }
      textSection('Clinical Notes', data.test.clinicalNote);
      textSection('Comment', data.test.comment);

      // ── End of Report + Doctor Signature (every copy), bottom-right ────────
      {
        const END_H   = 24;    // "End of Report" line plus the gap below it
        const SIG_W   = 170;
        const IMG_H   = 42;    // signature image box height (image fitted, never stretched)
        const IMG_GAP = 4;     // image bottom → signature line
        const NAME_H  = 28;    // name + designation below the line
        // "Please Correlate Clinically" footer under the sign-off: gap, thin
        // rule, bold heading, then the Test Master text.
        const correlate  = data.correlateClinically?.trim() || null;
        const CORR_GAP   = 10;
        const CORR_HEAD  = 17;
        let corrBodyH = 0;
        if (correlate) {
          doc.font('Helvetica').fontSize(8.5);
          corrBodyH = doc.heightOfString(spelledOut(correlate), { width: CONTENT_WIDTH });
        }
        const CORR_H = correlate ? CORR_GAP + CORR_HEAD + corrBodyH : 0;
        ensureSpace(END_H + IMG_H + IMG_GAP + NAME_H + CORR_H);
        doc.y += 6;
        // Bold, centred, with a short rule on each side: ──── End of Report ────
        const END_RULE_W = 60;
        const END_RULE_GAP = 8;
        const endY = doc.y;
        doc.font('Helvetica-Bold').fontSize(9.5);
        const endTextW = doc.widthOfString('End of Report');
        const endTextX = PAGE_MARGIN + (CONTENT_WIDTH - endTextW) / 2;
        const endRuleY = endY + 5.5;   // vertical middle of the 9.5pt capitals
        doc.strokeColor(RULE).lineWidth(0.75)
          .moveTo(endTextX - END_RULE_GAP - END_RULE_W, endRuleY).lineTo(endTextX - END_RULE_GAP, endRuleY).stroke()
          .moveTo(endTextX + endTextW + END_RULE_GAP, endRuleY).lineTo(endTextX + endTextW + END_RULE_GAP + END_RULE_W, endRuleY).stroke();
        doc.fillColor(TEXT)
          .text('End of Report', PAGE_MARGIN, endY, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
        const sigX  = PAGE_MARGIN + CONTENT_WIDTH - SIG_W;
        const lineY = Math.max(doc.y + END_H + IMG_H + IMG_GAP, pageBottom() - NAME_H - CORR_H);
        if (DOCTOR_SIGNATURE_IMAGE) {
          try {
            doc.image(DOCTOR_SIGNATURE_IMAGE, sigX, lineY - IMG_GAP - IMG_H, {
              fit: [SIG_W, IMG_H], align: 'center', valign: 'bottom',
            });
          } catch { /* unreadable image — name/designation still print */ }
        }
        doc.strokeColor(RULE).lineWidth(0.5).moveTo(sigX, lineY).lineTo(sigX + SIG_W, lineY).stroke();
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT)
          .text(SIGNING_DOCTOR.name, sigX, lineY + 4, { width: SIG_W, align: 'center', lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(TEXT)
          .text(SIGNING_DOCTOR.designation, sigX, lineY + 16, { width: SIG_W, align: 'center', lineBreak: false });
        if (correlate) {
          const corrY = lineY + NAME_H + CORR_GAP;
          rule(corrY, 0.5);
          doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT)
            .text('Please Correlate Clinically', PAGE_MARGIN, corrY + 5, { width: CONTENT_WIDTH, lineBreak: false });
          doc.fillColor(TEXT);
          writeText(doc, correlate, 'Helvetica', 8.5, PAGE_MARGIN, corrY + CORR_HEAD, { width: CONTENT_WIDTH });
        }
        doc.x = PAGE_MARGIN;
      }

      // ── Letterhead (downloaded copy) on every page ─────────────────────────
      if (data.letterhead) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
          doc.switchToPage(i);
          drawLetterhead(doc, data.hospital, data.letterhead.logo);
        }
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
