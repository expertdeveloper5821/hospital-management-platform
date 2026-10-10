import PDFDocument from 'pdfkit';
import {
  PaymentExportReport, PaymentExportRow, PERIOD_LABELS, METHOD_LABELS, formatIstDateTime,
} from './payment-export';

// ─── Payment Collection Report PDF ───────────────────────────────────────────
// Rendering only — every number printed here comes from the report built by
// PaymentService.exportPayments (rows + paise totals summed from those rows),
// so the summary always reconciles with the transaction table.
//
// A4 portrait. Page 1 carries the report header, the summary (total
// collections, transaction count, Cash / UPI / Card totals) and the start of
// the transaction table; the table flows onto as many pages as it needs, with
// its column header repeated at the top of every page. Rows wrap (row height =
// tallest cell) and never split across pages. Every page has a footer with
// the generation time and "Page X of Y".
//
// The standard PDF fonts (Helvetica) are WinAnsi-only and have no ₹ glyph
// (see discharge-summary.pdf.ts), so the rupee sign is drawn as a small vector
// glyph next to each amount instead of embedding a font.

const PAGE_WIDTH    = 595.28;  // A4
const PAGE_HEIGHT   = 841.89;
const MARGIN        = 40;
const FOOTER_SPACE  = 28;      // reserved above the bottom margin for the footer
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER_SPACE;

const TEXT   = '#111827';
const MUTED  = '#4B5563';
const RULE   = '#9CA3AF';
const HEAD_BG = '#E5E7EB';
const ZEBRA  = '#F3F4F6';

const TABLE_FONT_SIZE = 8;
const CELL_PAD_X = 4;
const CELL_PAD_Y = 4;
const LINE_GAP   = 1;
// A free-text cell (e.g. a long description) is cut off with an ellipsis after
// this many lines, so one row can never outgrow a page.
const MAX_CELL_LINES = 6;
const MAX_CELL_HEIGHT = MAX_CELL_LINES * (TABLE_FONT_SIZE * 1.16 + LINE_GAP);

interface Column {
  key:   'sno' | 'date' | 'patient' | 'description' | 'method' | 'ref' | 'amount';
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

// Widths sum to CONTENT_WIDTH (515.28).
const COLUMNS: Column[] = [
  { key: 'sno',         label: 'S.No',               width: 28,     align: 'right' },
  { key: 'date',        label: 'Date & Time',        width: 66,     align: 'left'  },
  { key: 'patient',     label: 'Patient / UHID',     width: 112,    align: 'left'  },
  { key: 'description', label: 'Description',        width: 106,    align: 'left'  },
  { key: 'method',      label: 'Method',             width: 44,     align: 'left'  },
  { key: 'ref',         label: 'Receipt / Ref No.',  width: 92.28,  align: 'left'  },
  { key: 'amount',      label: 'Amount',             width: 67,     align: 'right' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "YYYY-MM-DD" → "09 Oct 2026"
export function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Indian digit grouping, always two decimals: 1234567.5 → "12,34,567.50".
// Done by hand (not toLocaleString) so it never depends on the runtime's ICU data.
export function formatInr(paise: number): string {
  const negative = paise < 0;
  const abs      = Math.abs(Math.round(paise));
  const rupees   = Math.floor(abs / 100).toString();
  const decimals = String(abs % 100).padStart(2, '0');
  const last3    = rupees.slice(-3);
  const rest     = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${rest ? `${rest},${last3}` : last3}.${decimals}`;
}

// ₹ as strokes inside a (0.5 × 0.72) em box whose top sits at the cap height
// of a Helvetica line drawn at the same y.
function rupeeWidth(size: number): number {
  return size * 0.5;
}

function drawRupee(doc: PDFKit.PDFDocument, x: number, y: number, size: number, color: string, bold: boolean): void {
  const w = rupeeWidth(size);
  const h = size * 0.72;
  const top = y + size * 0.05;
  doc.save();
  doc.lineWidth(size * (bold ? 0.1 : 0.075)).lineCap('butt').lineJoin('miter').strokeColor(color);
  doc.moveTo(x, top).lineTo(x + w, top).stroke();
  doc.moveTo(x, top + h * 0.27).lineTo(x + w, top + h * 0.27).stroke();
  doc.moveTo(x + w * 0.35, top)
    .bezierCurveTo(x + w * 0.98, top, x + w * 0.98, top + h * 0.52, x + w * 0.35, top + h * 0.52)
    .lineTo(x, top + h * 0.52)
    .lineTo(x + w * 0.78, top + h)
    .stroke();
  doc.restore();
}

function amountWidth(doc: PDFKit.PDFDocument, paise: number, size: number, bold: boolean): number {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  return doc.widthOfString(formatInr(paise)) + rupeeWidth(size) + size * 0.15;
}

// Right-aligns "₹<amount>" so its right edge is at `right`. With `maxWidth`,
// the size steps down until the amount fits, so it is never clipped.
function drawAmount(
  doc: PDFKit.PDFDocument, paise: number, right: number, y: number,
  size: number, opts: { bold?: boolean; color?: string; maxWidth?: number } = {},
): void {
  const color = opts.color ?? TEXT;
  const bold  = !!opts.bold;
  if (opts.maxWidth) {
    while (size > 5 && amountWidth(doc, paise, size, bold) > opts.maxWidth) size -= 0.5;
  }
  const text  = formatInr(paise);
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color);
  const textW = doc.widthOfString(text);
  const textX = right - textW;
  doc.text(text, textX, y, { lineBreak: false });
  drawRupee(doc, textX - rupeeWidth(size) - size * 0.15, y, size, color, bold);
}

function rowCells(row: PaymentExportRow, index: number): Record<Exclude<Column['key'], 'amount'>, string> {
  const at = formatIstDateTime(row.createdAt);
  return {
    sno:         String(index + 1),
    date:        `${formatDateKey(at.date)}\n${at.time}`,
    patient:     `${row.patientName ?? '—'}\n${row.patientId}`,
    description: row.description || '—',
    method:      METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
    ref:         row.transactionId ? `${row.paymentId}\nRef: ${row.transactionId}` : row.paymentId,
  };
}

function cellTextHeight(doc: PDFKit.PDFDocument, text: string, width: number): number {
  doc.font('Helvetica').fontSize(TABLE_FONT_SIZE);
  return Math.min(doc.heightOfString(text, { width: width - CELL_PAD_X * 2, lineGap: LINE_GAP }), MAX_CELL_HEIGHT);
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const h = TABLE_FONT_SIZE + CELL_PAD_Y * 2 + 2;
  doc.rect(MARGIN, y, CONTENT_WIDTH, h).fill(HEAD_BG);
  doc.font('Helvetica-Bold').fontSize(TABLE_FONT_SIZE).fillColor(TEXT);
  let x = MARGIN;
  for (const col of COLUMNS) {
    doc.text(col.label, x + CELL_PAD_X, y + CELL_PAD_Y + 1, {
      width: col.width - CELL_PAD_X * 2, align: col.align, lineBreak: false, ellipsis: true,
    });
    x += col.width;
  }
  doc.strokeColor(RULE).lineWidth(0.5)
    .moveTo(MARGIN, y + h).lineTo(MARGIN + CONTENT_WIDTH, y + h).stroke();
  return y + h;
}

function drawSummary(doc: PDFKit.PDFDocument, report: PaymentExportReport, y: number): number {
  // Two headline boxes: total collections and transaction count.
  const boxGap = 12;
  const boxW   = (CONTENT_WIDTH - boxGap) / 2;
  const boxH   = 48;
  const boxes: Array<{ label: string; draw: (x: number, y: number) => void }> = [
    {
      label: 'Total Collections',
      draw: (bx, by) => drawAmount(doc, report.grandTotalPaise, bx + boxW - 12, by, 16, { bold: true, maxWidth: boxW - 24 }),
    },
    {
      label: 'Transactions',
      draw: (bx, by) => {
        doc.font('Helvetica-Bold').fontSize(16).fillColor(TEXT)
          .text(String(report.rows.length), bx + 12, by, { width: boxW - 24, align: 'right', lineBreak: false });
      },
    },
  ];
  boxes.forEach((box, i) => {
    const bx = MARGIN + i * (boxW + boxGap);
    doc.lineWidth(0.75).strokeColor(RULE).rect(bx, y, boxW, boxH).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(box.label, bx + 12, y + 9, { width: boxW - 24, lineBreak: false });
    box.draw(bx, y + 24);
  });
  y += boxH + 14;

  // Method breakdown. Cheque is listed only when used, so the visible lines
  // always add up to the Grand Total.
  const methods = (['CASH', 'UPI', 'CARD', 'CHEQUE'] as const)
    .filter((m) => m !== 'CHEQUE' || report.methodTotals.CHEQUE.count > 0);
  const colW  = [CONTENT_WIDTH - 220, 100, 120];
  const lineH = 18;

  doc.rect(MARGIN, y, CONTENT_WIDTH, lineH).fill(HEAD_BG);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT);
  doc.text('Payment Method', MARGIN + 8, y + 5, { width: colW[0] - 16, lineBreak: false });
  doc.text('Transactions', MARGIN + colW[0], y + 5, { width: colW[1] - 8, align: 'right', lineBreak: false });
  doc.text('Amount', MARGIN + colW[0] + colW[1], y + 5, { width: colW[2] - 8, align: 'right', lineBreak: false });
  y += lineH;

  const right = MARGIN + CONTENT_WIDTH - 8;
  for (const m of methods) {
    const t = report.methodTotals[m];
    doc.font('Helvetica').fontSize(9).fillColor(TEXT);
    doc.text(METHOD_LABELS[m], MARGIN + 8, y + 5, { width: colW[0] - 16, lineBreak: false });
    doc.text(String(t.count), MARGIN + colW[0], y + 5, { width: colW[1] - 8, align: 'right', lineBreak: false });
    drawAmount(doc, t.paise, right, y + 5, 9, { maxWidth: colW[2] - 16 });
    y += lineH;
    doc.strokeColor(RULE).lineWidth(0.4).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
  }
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT);
  doc.text('Grand Total', MARGIN + 8, y + 5, { width: colW[0] - 16, lineBreak: false });
  doc.text(String(report.rows.length), MARGIN + colW[0], y + 5, { width: colW[1] - 8, align: 'right', lineBreak: false });
  drawAmount(doc, report.grandTotalPaise, right, y + 5, 9.5, { bold: true, maxWidth: colW[2] - 16 });
  y += lineH;
  doc.strokeColor(TEXT).lineWidth(1).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
  y += 8;

  const ex = report.excludedCounts;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    'Only completed payments are included. Not counted in totals: '
      + `Pending ${ex.PENDING}  ·  Failed ${ex.FAILED}  ·  Cancelled ${ex.CANCELLED}.`,
    MARGIN, y, { width: CONTENT_WIDTH },
  );
  return doc.y;
}

export function buildPaymentExportPdf(report: PaymentExportReport): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const { range } = report;
    const periodText = range.fromKey === range.toKey
      ? formatDateKey(range.fromKey)
      : `${formatDateKey(range.fromKey)} – ${formatDateKey(range.toKey)}`;
    const generated  = formatIstDateTime(report.generatedAt);
    const generatedText = `${formatDateKey(generated.date)}, ${generated.time} IST`;

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      compress: true,
      info: {
        Title:   `Payment Collection Report - ${periodText}`,
        Author:  report.hospitalName,
        Subject: 'Payment Collection Report',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data',  (c: Buffer) => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Report header (page 1) ──
    let y = MARGIN;
    doc.font('Helvetica-Bold').fontSize(16).fillColor(TEXT)
      .text(report.hospitalName, MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y = doc.y + 2;
    doc.font('Helvetica-Bold').fontSize(12)
      .text('Payment Collection Report', MARGIN, y, { width: CONTENT_WIDTH, align: 'center' });
    y = doc.y + 10;

    const meta: Array<[string, string]> = [
      ['Report Type',  PERIOD_LABELS[range.period]],
      ['Period',       periodText],
      ['Generated',    generatedText],
      ['Generated By', report.generatedBy],
    ];
    const half = CONTENT_WIDTH / 2;
    meta.forEach(([label, value], i) => {
      const mx = MARGIN + (i % 2) * half;
      const my = y + Math.floor(i / 2) * 15;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
        .text(`${label}:`, mx, my, { width: 72, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(TEXT)
        .text(value, mx + 72, my, { width: half - 80, lineBreak: false, ellipsis: true });
    });
    y += Math.ceil(meta.length / 2) * 15 + 2;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text('All dates and times are in Asia/Kolkata (IST, UTC+05:30).', MARGIN, y, { width: CONTENT_WIDTH });
    y = doc.y + 6;
    doc.strokeColor(TEXT).lineWidth(1).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
    y += 12;

    y = drawSummary(doc, report, y) + 16;

    // ── Transactions table ──
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT).text('Transactions', MARGIN, y);
    y = doc.y + 4;

    const newPage = (): number => {
      doc.addPage();
      doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
        `${report.hospitalName}  ·  Payment Collection Report  ·  ${periodText} (continued)`,
        MARGIN, MARGIN, { width: CONTENT_WIDTH, lineBreak: false, ellipsis: true },
      );
      return drawTableHeader(doc, MARGIN + 16);
    };

    const headerH = TABLE_FONT_SIZE + CELL_PAD_Y * 2 + 2;
    // Keep the table header together with at least one row.
    if (y + headerH + 30 > CONTENT_BOTTOM) y = newPage();
    else y = drawTableHeader(doc, y);

    if (report.rows.length === 0) {
      doc.font('Helvetica').fontSize(9).fillColor(MUTED)
        .text('No completed payments in this period.', MARGIN, y + 10, { width: CONTENT_WIDTH, align: 'center' });
      y = doc.y + 6;
    }

    report.rows.forEach((row, i) => {
      const cells = rowCells(row, i);
      let contentH = TABLE_FONT_SIZE;
      for (const col of COLUMNS) {
        if (col.key === 'amount') continue;
        contentH = Math.max(contentH, cellTextHeight(doc, cells[col.key], col.width));
      }
      const rowH = Math.ceil(contentH) + CELL_PAD_Y * 2;
      if (y + rowH > CONTENT_BOTTOM) y = newPage();

      if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_WIDTH, rowH).fill(ZEBRA);
      let x = MARGIN;
      for (const col of COLUMNS) {
        if (col.key === 'amount') {
          drawAmount(doc, row.amountPaise, x + col.width - CELL_PAD_X, y + CELL_PAD_Y, TABLE_FONT_SIZE, {
            maxWidth: col.width - CELL_PAD_X * 2,
          });
        } else {
          doc.font('Helvetica').fontSize(TABLE_FONT_SIZE).fillColor(TEXT).text(cells[col.key], x + CELL_PAD_X, y + CELL_PAD_Y, {
            width: col.width - CELL_PAD_X * 2, height: contentH, align: col.align, lineGap: LINE_GAP, ellipsis: true,
          });
        }
        x += col.width;
      }
      y += rowH;
      doc.strokeColor(RULE).lineWidth(0.3).moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).stroke();
    });

    // ── Grand total row ──
    const totalH = 22;
    if (y + totalH > CONTENT_BOTTOM) y = newPage();
    doc.rect(MARGIN, y, CONTENT_WIDTH, totalH).fill(HEAD_BG);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT)
      .text(`Grand Total (${report.rows.length} transaction${report.rows.length === 1 ? '' : 's'})`,
        MARGIN + CELL_PAD_X, y + 6, { width: CONTENT_WIDTH - 140, lineBreak: false });
    drawAmount(doc, report.grandTotalPaise, MARGIN + CONTENT_WIDTH - CELL_PAD_X, y + 6, 10, { bold: true, maxWidth: 130 });
    doc.strokeColor(TEXT).lineWidth(1)
      .moveTo(MARGIN, y + totalH).lineTo(MARGIN + CONTENT_WIDTH, y + totalH).stroke();

    // ── Footer on every page ──
    const pages = doc.bufferedPageRange();
    for (let p = pages.start; p < pages.start + pages.count; p++) {
      doc.switchToPage(p);
      const fy = PAGE_HEIGHT - MARGIN - 10;
      // Writing inside the bottom margin would otherwise trigger an auto page break.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.strokeColor(RULE).lineWidth(0.5)
        .moveTo(MARGIN, fy - 6).lineTo(MARGIN + CONTENT_WIDTH, fy - 6).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`Generated ${generatedText}`, MARGIN, fy, { width: CONTENT_WIDTH / 2, lineBreak: false })
        .text(`Page ${p - pages.start + 1} of ${pages.count}`, MARGIN + CONTENT_WIDTH / 2, fy, {
          width: CONTENT_WIDTH / 2, align: 'right', lineBreak: false,
        });
      doc.page.margins.bottom = savedBottom;
    }

    doc.end();
  });
}
