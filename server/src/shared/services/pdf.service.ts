import PDFDocument from 'pdfkit';

export interface MedicalCardData {
  patientId:                 string;
  fullName:                  string;
  dateOfBirth:               Date;
  gender:                    string;
  mobileNumber:              string;
  address?:                  string;
  bloodGroup?:               string;
  emergencyContactName?:     string;
  emergencyContactMobile?:   string;
  registrationFee?:          number;
  registrationPaymentMethod?: string;
  hospitalName:              string;
  hospitalLogoUrl?:          string;
  primaryColor:              string;
}

// Generic payment receipt — every non-Lab payment (Billing charges, manual
// payments from the Payments section / OPD / IPD / registration, Razorpay).
// Same monochrome A5 layout as the Lab receipt; hospital details come from
// the tenant (see shared/utils/receipt-details.ts), never hardcoded.
export interface ReceiptData {
  receiptNumber:              string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  patientName:                string;
  patientId:                  string;          // UHID
  patientAge:                 number | null;
  patientGender:              string | null;
  patientMobile:              string | null;
  description:                string;
  amountInr:                  number;
  paymentMethod:              string;
  transactionId:              string | null;   // manual transaction ID or Razorpay payment ID
  createdBy:                  string | null;   // name of the user who recorded the payment
}

// Lab (Pathology/Radiology) payment receipt — same layout as ReceiptData plus
// a LAB REQUEST section.
export interface LabReceiptData {
  receiptNumber:              string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  patientName:                string;
  patientId:                  string;          // UHID
  patientAge:                 number | null;
  patientGender:              string | null;
  patientMobile:              string | null;
  labCategory:                'PATHOLOGY' | 'RADIOLOGY';
  labRequestId:               string;
  testName:                   string;          // testType / imagingType
  referredBy:                 string;
  createdBy:                  string;          // name of the user who collected the payment
  amountInr:                  number;
  paymentMethod:              string;
  transactionId:              string | null;
}

export interface GeneratePDFOptions {
  compress?: boolean; // default true; false in tests for text-searchable streams
}

// Content of one monochrome A5 receipt — see PdfService.renderA5Receipt.
interface A5ReceiptSpec {
  docTitle:                   string;
  subject:                    string;
  title:                      string;
  receiptNumber:              string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  amountInr:                  number;
  sections:                   Array<{ heading: string; rows: Array<[label: string, value: string]> }>;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  return `${d} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function calculateAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return Math.max(0, age);
}

function toDisplay(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// Receipts print the hospital's local wall-clock time regardless of the
// server's own timezone (same zone the dashboard uses).
const RECEIPT_TZ = 'Asia/Kolkata';

// FREE is receipt-only (a ₹0 Billing LAB_TEST charge) — never a stored PaymentMethod.
const PAYMENT_METHOD_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque', FREE: 'Free' };

function toDisplayPaymentMethod(method: string): string {
  return PAYMENT_METHOD_LABEL[method] ?? method;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(' ');
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

// Indian numbering (crore / lakh / thousand), e.g. 1250.5 →
// "Rupees One Thousand Two Hundred Fifty and Fifty Paise Only".
// Crores are themselves spelled in the same system, so the largest accepted
// amount (10 digits, 99,99,99,999.99) reads "Ninety Nine Crore …".
export function amountInWords(amount: number): string {
  const paiseTotal = Math.round(amount * 100);
  let rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;

  const crore = Math.floor(rupees / 10000000); rupees %= 10000000;
  const lakh  = Math.floor(rupees / 100000);   rupees %= 100000;
  const thou  = Math.floor(rupees / 1000);     rupees %= 1000;

  const parts: string[] = [];
  if (crore)  parts.push(`${amountInWords(crore).replace(/^Rupees | Only$/g, '')} Crore`);
  if (lakh)   parts.push(`${belowHundred(lakh)} Lakh`);
  if (thou)   parts.push(`${belowHundred(thou)} Thousand`);
  if (rupees) parts.push(belowThousand(rupees));

  const rupeeWords = parts.length ? parts.join(' ') : 'Zero';
  const paiseWords = paise ? ` and ${belowHundred(paise)} Paise` : '';
  return `Rupees ${rupeeWords}${paiseWords} Only`;
}

// e.g. "19 May 2026, 03:30 PM IST"
function formatReceiptDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RECEIPT_TZ, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()} IST`;
}

// PATIENT DETAILS rows shared by every receipt layout.
function patientRows(p: {
  patientName: string; patientId: string; patientAge: number | null;
  patientGender: string | null; patientMobile: string | null;
}): Array<[string, string]> {
  const ageGender = [
    p.patientAge !== null ? `${p.patientAge} yrs` : null,
    p.patientGender ? toDisplay(p.patientGender) : null,
  ].filter(Boolean).join(' / ');
  const rows: Array<[string, string]> = [['Patient Name', p.patientName], ['UHID', p.patientId]];
  if (ageGender)       rows.push(['Age / Gender', ageGender]);
  if (p.patientMobile) rows.push(['Mobile', p.patientMobile]);
  return rows;
}

export class PdfService {
  /**
   * Generates a landscape Medical Identification Card PDF (7 × 4.44 in).
   *
   * Layout (matches physical card reference):
   *   Header  — hospital name (left) + photo placeholder box (right)
   *   Title   — "Medical Identification Card" in tenant primary colour
   *   Fields  — Name & Address | DOB / Age / Gender / Blood Group |
   *             Physician / Phone | Emergency Contact / Phone |
   *             Medical Conditions | Current Medicines | Allergies
   */
  generateMedicalCard(data: MedicalCardData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const { compress = true } = options;
    return new Promise((resolve, reject) => {
      // 504 × 320 pt  ≈  7 × 4.44 in  (landscape card)
      const doc = new PDFDocument({
        size:    [504, 320],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        compress,
        info: {
          Title:        `Medical Card - ${data.fullName}`,
          Author:       data.hospitalName,
          Subject:      'Patient Medical Identification Card',
          CreationDate: new Date(),
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W  = doc.page.width;   // 504
      const M  = 16;               // page margin
      const CW = W - M * 2;        // 472
      const R  = W - M;            // right boundary: 488
      const [pr, pg, pb] = hexToRgb(data.primaryColor);

      // ── White background + card border ───────────────────────────────────────
      doc.rect(0, 0, W, doc.page.height).fill('white');
      doc.rect(2, 2, W - 4, doc.page.height - 4)
        .strokeColor('#CCCCCC').lineWidth(0.5).stroke();

      // ── Photo placeholder (top-right) ────────────────────────────────────────
      const PH_W = 55, PH_H = 66, PH_X = R - PH_W, PH_Y = 10;
      doc.rect(PH_X, PH_Y, PH_W, PH_H).strokeColor('#AAAAAA').lineWidth(0.5).stroke();
      doc.fillColor('#AAAAAA').fontSize(7).font('Helvetica')
        .text('Photo', PH_X, PH_Y + PH_H / 2 - 4, { width: PH_W, align: 'center', lineBreak: false });

      // ── Hospital name (top-left, beside photo) ───────────────────────────────
      const NAME_W = PH_X - M - 8;
      doc.fillColor('#111111').fontSize(12).font('Helvetica-Bold')
        .text(data.hospitalName, M, 14, { width: NAME_W, lineBreak: true });

      // ── UHID (below hospital name) ───────────────────────────────────────────
      doc.fillColor('#555555').fontSize(8).font('Helvetica')
        .text(`UHID: ${data.patientId}`, M, 34, { width: NAME_W, lineBreak: false });

      // ── Title: Medical Identification Card ───────────────────────────────────
      const TITLE_Y = PH_Y + PH_H + 5;   // 81
      doc.fillColor([pr, pg, pb]).fontSize(15).font('Helvetica-Bold')
        .text('Medical Identification Card', M, TITLE_Y, { width: CW, lineBreak: false });

      // ── Separator line ───────────────────────────────────────────────────────
      const SEP_Y = TITLE_Y + 21;         // 102
      doc.moveTo(M, SEP_Y).lineTo(R, SEP_Y)
        .strokeColor('#CCCCCC').lineWidth(0.5).stroke();

      // ── Field helper ─────────────────────────────────────────────────────────
      const LABEL_SZ = 7;
      const VALUE_SZ = 8;
      const LINE_DY  = 13;  // dotted underline offset below row top

      const drawField = (
        label: string,
        value: string,
        x: number,
        y: number,
        rightEdge: number,
      ): void => {
        // Label
        doc.font('Helvetica-Bold').fontSize(LABEL_SZ);
        const lw = doc.widthOfString(label);
        doc.fillColor('#333333').text(label, x, y, { lineBreak: false });

        // Value
        let cx = x + lw;
        if (value) {
          const vt = ' ' + value;
          doc.font('Helvetica').fontSize(VALUE_SZ);
          const vw = doc.widthOfString(vt);
          doc.fillColor('#111111').text(vt, cx, y, { lineBreak: false });
          cx += vw;
        }

        // Dotted underline to right edge
        const ly = y + LINE_DY;
        if (cx + 4 < rightEdge) {
          doc.save()
            .moveTo(cx + 2, ly).lineTo(rightEdge, ly)
            .dash(1.5, { space: 2 })
            .strokeColor('#BBBBBB').lineWidth(0.5).stroke()
            .undash()
            .restore();
        }
      };

      // ── Field rows ───────────────────────────────────────────────────────────
      const ROW_H = 21;
      const MID   = M + Math.floor(CW * 0.52);   // ~260 — two-column split
      const age   = calculateAge(data.dateOfBirth);

      let y = SEP_Y + 8;   // 110

      // Row 1 — Name & Address
      const nameAddr = data.address
        ? `${data.fullName},  ${data.address}`
        : data.fullName;
      drawField('Name & Address: ', nameAddr, M, y, R);
      y += ROW_H;

      // Row 2 — Birth Date | Age | Gender | Blood group
      drawField('Birth Date: ',  formatDate(data.dateOfBirth), M,        y, M + 116);
      drawField('Age: ',         String(age),                  M + 122,  y, M + 157);
      drawField('Gender: ',      toDisplay(data.gender),       M + 163,  y, M + 238);
      drawField('Blood group: ', data.bloodGroup ?? '—',        M + 244,  y, R);
      y += ROW_H;

      // Row 3 — Physician (blank) | Phone
      drawField('Physician: ',   '',                  M,       y, MID - 5);
      drawField('Phone: ',       data.mobileNumber,   MID + 5, y, R);
      y += ROW_H;

      // Row 4 — Emergency Contact | Emergency Phone
      drawField('Emergency Contact(family): ', data.emergencyContactName   ?? '', M,       y, MID - 5);
      drawField('Phone: ',                     data.emergencyContactMobile ?? '', MID + 5, y, R);
      y += ROW_H + 4;

      // Row 5 — Medical Conditions (blank — not yet captured in patient model)
      drawField('Medical Conditions: ', '', M, y, R);
      y += ROW_H;

      // Row 6 — Current Medicines (blank)
      drawField('Current Medicines: ', '', M, y, R);
      y += ROW_H;

      // Row 7 — Allergies (blank)
      drawField('Allergies: ', '', M, y, R);
      y += ROW_H;

      // Registration fee footer (only when fee was collected)
      if (data.registrationFee != null) {
        const METHOD_LABELS: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', CHEQUE: 'Cheque' };
        const methodLabel = data.registrationPaymentMethod
          ? (METHOD_LABELS[data.registrationPaymentMethod] ?? data.registrationPaymentMethod)
          : '';
        const feeText = methodLabel
          ? `Registration Fee: ₹${data.registrationFee.toLocaleString('en-IN')}  |  Mode: ${methodLabel}`
          : `Registration Fee: ₹${data.registrationFee.toLocaleString('en-IN')}`;

        doc.moveTo(M, y).lineTo(R, y)
          .strokeColor('#CCCCCC').lineWidth(0.5).stroke();

        doc.font('Helvetica-Bold').fontSize(7).fillColor([pr, pg, pb])
          .text(feeText, M, y + 4, { width: CW, align: 'center', lineBreak: false });
      }

      doc.end();
    });
  }

  // ─── U5-A-01: Payment Receipt PDF ────────────────────────────────────────────
  // Same A5 print layout as the Lab receipt (see renderA5Receipt).
  generateReceipt(data: ReceiptData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const payment: Array<[string, string]> = [
      ['Description', data.description],
      ['Payment Method', toDisplayPaymentMethod(data.paymentMethod)],
    ];
    if (data.transactionId) payment.push(['Transaction ID', data.transactionId]);
    if (data.createdBy)     payment.push(['Created By', data.createdBy]);

    return this.renderA5Receipt({
      docTitle:                   `Receipt - ${data.receiptNumber}`,
      subject:                    'Payment Receipt',
      title:                      'PAYMENT RECEIPT',
      receiptNumber:              data.receiptNumber,
      paymentDate:                data.paymentDate,
      hospitalName:               data.hospitalName,
      hospitalRegistrationNumber: data.hospitalRegistrationNumber,
      hospitalAddress:            data.hospitalAddress,
      amountInr:                  data.amountInr,
      sections: [
        { heading: 'PATIENT DETAILS', rows: patientRows(data) },
        { heading: 'PAYMENT DETAILS', rows: payment },
      ],
    }, options);
  }

  // Single-page A5 Lab (Pathology/Radiology) payment receipt.
  generateLabReceipt(data: LabReceiptData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const payment: Array<[string, string]> = [['Payment Method', toDisplayPaymentMethod(data.paymentMethod)]];
    if (data.transactionId) payment.push(['Transaction ID', data.transactionId]);
    payment.push(['Created By', data.createdBy]);

    return this.renderA5Receipt({
      docTitle:                   `Lab Payment Receipt - ${data.receiptNumber}`,
      subject:                    'Lab Payment Receipt',
      title:                      `${data.labCategory === 'PATHOLOGY' ? 'PATHOLOGY' : 'RADIOLOGY'} PAYMENT RECEIPT`,
      receiptNumber:              data.receiptNumber,
      paymentDate:                data.paymentDate,
      hospitalName:               data.hospitalName,
      hospitalRegistrationNumber: data.hospitalRegistrationNumber,
      hospitalAddress:            data.hospitalAddress,
      amountInr:                  data.amountInr,
      sections: [
        { heading: 'PATIENT DETAILS', rows: patientRows(data) },
        { heading: 'LAB REQUEST', rows: [
          ['Lab Request ID', data.labRequestId],
          [data.labCategory === 'PATHOLOGY' ? 'Pathology Test' : 'Imaging Type', data.testName],
          ['Referred By', data.referredBy],
        ] },
        { heading: 'PAYMENT DETAILS', rows: payment },
      ],
    }, options);
  }

  /**
   * Renders a single-page A5 portrait (419 × 595 pt) receipt: letterhead
   * (hospital name, "Reg. No.", "Address - …"), title, receipt number and
   * date/time, label/value sections, amount box, signature and footer.
   * Shared by the generic and Lab receipts so both look identical.
   *
   * Print-oriented, monochrome layout: plain white paper, black text and thin
   * black rules only — no brand colour, fills, frames or decorative boxes, so
   * it prints identically on any (including black-and-white) printer. Every
   * mark sits inside a ~11 mm safe margin so desktop printers' unprintable
   * edges never clip it.
   *
   * Overflow-proof: the body is laid out once as a measuring pass. If it would
   * reach the signature/footer block (pinned to the bottom margin), it is laid
   * out again in a compact mode — values clamped to one line with an ellipsis,
   * tighter spacing — which fits even with every field at its maximum length.
   */
  private renderA5Receipt(data: A5ReceiptSpec, options: GeneratePDFOptions): Promise<Buffer> {
    const { compress = true } = options;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size:    [419, 595],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        compress,
        info: {
          Title:        data.docTitle,
          Author:       data.hospitalName,
          Subject:      data.subject,
          CreationDate: data.paymentDate,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W   = doc.page.width;   // 419
      const H   = doc.page.height;  // 595
      const M   = 32;               // content margin (~11.3 mm)
      const CW  = W - M * 2;        // 355
      const INK = '#000000';        // every glyph and rule is pure black

      // Signature + footer are pinned to the bottom margin; the body must end
      // at least BODY_GAP above the signature line (room to sign).
      const footerY  = H - M - 8;
      const sigY     = footerY - 34;
      const BODY_GAP = 24;

      const amountStr = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(data.amountInr);
      const words = amountInWords(data.amountInr);

      // Lays out the letterhead + body; draws only when `draw` is true.
      // Returns the y where the amount box ends.
      const layout = (draw: boolean, compact: boolean): number => {
        const valueLines = compact ? 1 : 2;
        const rowPad     = compact ? 3 : 4;
        const sectionGap = compact ? 3 : 6;

        // Measures `text` clamped to `maxLines` lines and (when drawing)
        // renders it with an ellipsis beyond that; returns the height used.
        const boxed = (
          text: string, x: number, y: number, width: number, font: string, size: number,
          opts: { align?: 'left' | 'center' | 'right'; maxLines?: number } = {},
        ): number => {
          doc.font(font).fontSize(size);
          const lineH = doc.currentLineHeight(true);
          const h = Math.min(doc.heightOfString(text, { width }), lineH * (opts.maxLines ?? 2));
          if (draw) {
            doc.fillColor(INK).text(text, x, y, {
              width, height: h + 0.5, ellipsis: true, align: opts.align ?? 'left',
            });
          }
          return h;
        };
        const hRule = (y: number, width = 0.75): void => {
          if (draw) doc.moveTo(M, y).lineTo(W - M, y).strokeColor(INK).lineWidth(width).stroke();
        };

        // ── Letterhead: hospital name, registration number, address ──────────
        let y = M;
        y += boxed(data.hospitalName, M, y, CW, 'Helvetica-Bold', 15, { align: 'center' });
        if (data.hospitalRegistrationNumber) {
          y += 4;
          y += boxed(`Reg. No.: ${data.hospitalRegistrationNumber}`, M, y, CW, 'Helvetica', 8.5, {
            align: 'center', maxLines: 1,
          });
        }
        if (data.hospitalAddress) {
          y += 3;
          y += boxed(`Address - ${data.hospitalAddress}`, M, y, CW, 'Helvetica', 8.5, { align: 'center' });
        }
        y += 8;
        hRule(y, 1);
        y += 12;

        // ── Title ────────────────────────────────────────────────────────────
        if (draw) {
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5).text(data.title, M, y, {
            width: CW, align: 'center', lineBreak: false, characterSpacing: 1,
          });
        }
        y += compact ? 20 : 24;

        // ── Receipt number (left) / date & time (right) ──────────────────────
        if (draw) {
          const half = CW / 2;
          doc.fillColor(INK).font('Helvetica').fontSize(7.5)
            .text('RECEIPT NO.', M, y, { width: half, lineBreak: false, characterSpacing: 0.4 });
          doc.text('DATE & TIME', M + half, y, { width: half, align: 'right', lineBreak: false, characterSpacing: 0.4 });
          doc.font('Helvetica-Bold').fontSize(8.5)
            .text(data.receiptNumber, M, y + 11, { width: CW * 0.62, lineBreak: false, ellipsis: true });
          doc.text(formatReceiptDateTime(data.paymentDate), M + CW * 0.5, y + 11, {
            width: CW * 0.5, align: 'right', lineBreak: false,
          });
        }
        y += compact ? 26 : 29;

        // ── Label/value sections ─────────────────────────────────────────────
        const LW = 104;           // label column
        const VW = CW - LW;       // value column
        const section = (heading: string): void => {
          if (draw) {
            doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5)
              .text(heading, M, y, { width: CW, lineBreak: false, characterSpacing: 0.6 });
          }
          y += 12;
          hRule(y);
          y += 5;
        };
        // Label column in regular weight, value column in bold — alignment
        // and weight separate the two, so no per-row rules are needed.
        const row = (label: string, value: string): void => {
          if (draw) {
            doc.fillColor(INK).font('Helvetica').fontSize(8.5)
              .text(label, M, y, { width: LW - 8, lineBreak: false });
          }
          const h = boxed(value || '—', M + LW, y, VW, 'Helvetica-Bold', 9, { maxLines: valueLines });
          y += Math.max(h, 11) + rowPad * 2;
        };

        data.sections.forEach(({ heading, rows }, i) => {
          if (i > 0) y += sectionGap;
          section(heading);
          rows.forEach(([label, value]) => row(label, value));
        });

        // ── Amount box ───────────────────────────────────────────────────────
        y += compact ? 6 : 8;
        doc.font('Helvetica-Oblique').fontSize(8);
        const wordsH = Math.min(doc.heightOfString(words, { width: CW - 20 }), doc.currentLineHeight(true) * 2);
        const boxH = 40 + wordsH;
        if (draw) {
          doc.rect(M, y, CW, boxH).strokeColor(INK).lineWidth(1).stroke();
          doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
            .text('AMOUNT PAID', M + 10, y + 12, { width: CW / 2, lineBreak: false, characterSpacing: 0.6 });
          doc.fontSize(15)
            .text(`Rs. ${amountStr}`, M + 10, y + 9, { width: CW - 20, align: 'right', lineBreak: false });
        }
        boxed(words, M + 10, y + 31, CW - 20, 'Helvetica-Oblique', 8);
        return y + boxH;
      };

      // ── Plain white paper (no frame) ─────────────────────────────────────────
      doc.rect(0, 0, W, H).fill('white');

      // ── Body: measure first, fall back to compact mode if it would overflow ──
      const compact = layout(false, false) > sigY - BODY_GAP;
      layout(true, compact);

      // ── Signature + footer (pinned to the bottom margin) ─────────────────────
      const sigW = 130;
      doc.moveTo(W - M - sigW, sigY).lineTo(W - M, sigY).strokeColor(INK).lineWidth(0.75).stroke();
      doc.fillColor(INK).font('Helvetica').fontSize(8)
        .text('Authorised Signatory', W - M - sigW, sigY + 4, { width: sigW, align: 'center', lineBreak: false });
      doc.fontSize(7.5)
        .text('This is a computer-generated receipt. Thank you for your payment.', M, footerY, {
          width: CW, align: 'center', lineBreak: false,
        });

      doc.end();
    });
  }
}

export const pdfService = new PdfService();
