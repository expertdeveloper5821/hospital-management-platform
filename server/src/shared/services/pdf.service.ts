import PDFDocument from 'pdfkit';
import { AgeUnit } from '../../modules/patient/patient.types';
import { formatPatientAge } from '../utils/patient-age';

export interface MedicalCardData {
  patientId:                 string;
  fullName:                  string;
  dateOfBirth:               Date;
  age?:                      number | null;
  ageUnit?:                  AgeUnit | null;
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
  /** Sequential invoice number, e.g. "INV-NH0001". Falls back to receiptNumber. */
  invoiceNumber?:             string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  patientName:                string;
  patientId:                  string;          // UHID
  patientAge:                 number | null;
  patientAgeUnit?:            AgeUnit | null;
  patientGender:              string | null;
  patientMobile:              string | null;
  description:                string;
  amountInr:                  number;
  paymentMethod:              string;
  transactionId:              string | null;   // manual transaction ID or Razorpay payment ID
  createdBy:                  string | null;   // name of the user who recorded the payment
  /** 'billing' → BILLING RECEIPT title; anything else → PAYMENT RECEIPT. */
  receiptKind?:               'billing' | 'payment';
}

// Lab (Pathology/Radiology) payment receipt — same layout as ReceiptData plus
// a LAB REQUEST section.
export interface LabReceiptData {
  receiptNumber:              string;
  /** Sequential invoice number, e.g. "INV-NH0001". Falls back to receiptNumber. */
  invoiceNumber?:             string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  patientName:                string;
  patientId:                  string;          // UHID
  patientAge:                 number | null;
  patientAgeUnit?:            AgeUnit | null;
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
// Kept for backwards compatibility but renderA5LandscapeReceipt is now used
// for all three receipt types (Lab, Billing, Payment).
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

// A single service/test/charge line for the A5 landscape receipt table.
interface A5LandscapeTableRow {
  description: string;
  quantity:    number;
  unitPrice:   number;
  amount:      number;
}

// Content spec for the A5 landscape (210 × 148 mm / 595 × 419 pt) receipt.
interface A5LandscapeReceiptSpec {
  docTitle:                   string;
  subject:                    string;
  title:                      string;          // e.g. "BILLING RECEIPT" / "PATHOLOGY RECEIPT"
  receiptNumber:              string;
  invoiceNumber:              string;
  paymentDate:                Date;
  hospitalName:               string;
  hospitalRegistrationNumber: string | null;
  hospitalAddress:            string | null;
  patientName:                string;
  patientId:                  string;          // UHID
  patientAge:                 number | null;
  patientAgeUnit?:            AgeUnit | null;
  patientGender:              string | null;
  patientMobile:              string | null;
  serviceRows:                A5LandscapeTableRow[];
  // Key-value rows shown in the payment info section (left of totals)
  metaRows:                   Array<[label: string, value: string]>;
  // Key-value rows shown in the footer area (created-by, etc.)
  footerRows:                 Array<[label: string, value: string]>;
  amountInr:                  number;
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

// e.g. "19 May 2026, 15:30"
function formatReceiptDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RECEIPT_TZ, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

// PATIENT DETAILS rows shared by every receipt layout.
// Kept for backwards compatibility with any code that may call it.
function patientRows(p: {
  patientName: string; patientId: string; patientAge: number | null; patientAgeUnit?: AgeUnit | null;
  patientGender: string | null; patientMobile: string | null;
}): Array<[string, string]> {
  const ageGender = [
    formatPatientAge(p.patientAge, p.patientAgeUnit),
    p.patientGender ? toDisplay(p.patientGender) : null,
  ].filter(Boolean).join(' / ');
  const rows: Array<[string, string]> = [['Patient Name', p.patientName], ['UHID', p.patientId]];
  if (ageGender)       rows.push(['Age / Gender', ageGender]);
  if (p.patientMobile) rows.push(['Mobile', p.patientMobile]);
  return rows;
}

// Keep patientRows referenced to avoid dead-code warnings.
void patientRows;

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
      const age   = formatPatientAge(data.age, data.ageUnit, data.dateOfBirth) ?? '—';

      let y = SEP_Y + 8;   // 110

      // Row 1 — Name & Address
      const nameAddr = data.address
        ? `${data.fullName},  ${data.address}`
        : data.fullName;
      drawField('Name & Address: ', nameAddr, M, y, R);
      y += ROW_H;

      // Row 2 — Birth Date | Age | Gender | Blood group
      drawField('Birth Date: ',  formatDate(data.dateOfBirth), M,        y, M + 116);
      drawField('Age: ',         age,                          M + 122,  y, M + 157);
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
          ? `Registration Fee: Rs.${data.registrationFee.toLocaleString('en-IN')}  |  Mode: ${methodLabel}`
          : `Registration Fee: Rs.${data.registrationFee.toLocaleString('en-IN')}`;

        doc.moveTo(M, y).lineTo(R, y)
          .strokeColor('#CCCCCC').lineWidth(0.5).stroke();

        doc.font('Helvetica-Bold').fontSize(7).fillColor([pr, pg, pb])
          .text(feeText, M, y + 4, { width: CW, align: 'center', lineBreak: false });
      }

      doc.end();
    });
  }

  // ─── U5-A-01: Payment Receipt PDF (Billing / Payment Sections) ──────────────
  // A5 landscape professional receipt. Title is "BILLING RECEIPT" when
  // receiptKind === 'billing' (Billing charges), "PAYMENT RECEIPT" otherwise
  // (direct payments, Razorpay, OPD/IPD registration, etc.).
  generateReceipt(data: ReceiptData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const isBilling = data.receiptKind === 'billing';
    const title     = isBilling ? 'BILLING RECEIPT' : 'PAYMENT RECEIPT';

    const serviceRows: A5LandscapeTableRow[] = [
      {
        description: data.description,
        quantity:    1,
        unitPrice:   data.amountInr,
        amount:      data.amountInr,
      },
    ];

    const metaRows: Array<[string, string]> = [
      ['Payment Mode',   toDisplayPaymentMethod(data.paymentMethod)],
      ['Payment Status', 'Paid'],
    ];
    if (data.transactionId) metaRows.push(['Transaction ID', data.transactionId]);

    const footerRows: Array<[string, string]> = [];
    if (data.createdBy) footerRows.push(['Created By', data.createdBy]);

    return this.renderA5LandscapeReceipt({
      docTitle:                   `${title} - ${data.receiptNumber}`,
      subject:                    isBilling ? 'Billing Receipt' : 'Payment Receipt',
      title,
      receiptNumber:              data.receiptNumber,
      invoiceNumber:              data.invoiceNumber ?? data.receiptNumber,
      paymentDate:                data.paymentDate,
      hospitalName:               data.hospitalName,
      hospitalRegistrationNumber: data.hospitalRegistrationNumber,
      hospitalAddress:            data.hospitalAddress,
      patientName:                data.patientName,
      patientId:                  data.patientId,
      patientAge:                 data.patientAge,
      patientAgeUnit:             data.patientAgeUnit,
      patientGender:              data.patientGender,
      patientMobile:              data.patientMobile,
      serviceRows,
      metaRows,
      footerRows,
      amountInr:                  data.amountInr,
    }, options);
  }

  // ─── Lab Receipt PDF (Lab Section) ──────────────────────────────────────────
  // A5 landscape professional receipt for Lab section payments.
  generateLabReceipt(data: LabReceiptData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const testLabel = data.labCategory === 'PATHOLOGY' ? 'Pathology Test' : 'Imaging Test';
    const serviceRows: A5LandscapeTableRow[] = [
      {
        description: `${testLabel}: ${data.testName}`,
        quantity:    1,
        unitPrice:   data.amountInr,
        amount:      data.amountInr,
      },
    ];

    const metaRows: Array<[string, string]> = [
      ['Lab Request No.', data.labRequestId],
      ['Payment Mode',    toDisplayPaymentMethod(data.paymentMethod)],
      ['Payment Status',  data.amountInr === 0 ? 'Free' : 'Paid'],
    ];
    if (data.transactionId) metaRows.push(['Transaction ID', data.transactionId]);

    const footerRows: Array<[string, string]> = [
      ['Created By', data.createdBy],
    ];

    const receiptTitle = data.labCategory === 'PATHOLOGY' ? 'PATHOLOGY RECEIPT' : 'RADIOLOGY RECEIPT';

    return this.renderA5LandscapeReceipt({
      docTitle:                   `Lab Receipt - ${data.receiptNumber}`,
      subject:                    'Lab Payment Receipt',
      title:                      receiptTitle,
      receiptNumber:              data.receiptNumber,
      invoiceNumber:              data.invoiceNumber ?? data.receiptNumber,
      paymentDate:                data.paymentDate,
      hospitalName:               data.hospitalName,
      hospitalRegistrationNumber: data.hospitalRegistrationNumber,
      hospitalAddress:            data.hospitalAddress,
      patientName:                data.patientName,
      patientId:                  data.patientId,
      patientAge:                 data.patientAge,
      patientAgeUnit:             data.patientAgeUnit,
      patientGender:              data.patientGender,
      patientMobile:              data.patientMobile,
      serviceRows,
      metaRows,
      footerRows,
      amountInr:                  data.amountInr,
    }, options);
  }

  /**
   * Renders a single-page A5 landscape (595 × 419 pt / 210 × 148 mm) receipt.
   *
   * Layout:
   *   Header        — Hospital details (LEFT) | RECEIPT centered | Invoice No. + Date/Time (RIGHT)
   *   Heavy divider
   *   Patient block — Row 1: Patient Name | UHID
   *                   Row 2: Age/Gender   | Mobile No.
   *                   Row 3: Payment Status | Payment Mode
   *   Heavy divider
   *   Service table — # | Item Name | Unit Price | Qty | Amount
   *   Totals        — Subtotal / Discount / Total Amount (right-aligned)
   *   Payment bar   — Amount Paid | Amount in Words
   *   Footer        — Created By (left) | Authorized Signature (right)
   *   Thin rule + "Thank you for visiting [Hospital Name]"
   */
  private renderA5LandscapeReceipt(data: A5LandscapeReceiptSpec, options: GeneratePDFOptions): Promise<Buffer> {
    const { compress = true } = options;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size:    [595, 419], // A5 Landscape: 210 × 148 mm
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

      const W   = doc.page.width;   // 595
      const H   = doc.page.height;  // 419
      const M   = 20;               // side margin (~7 mm)
      const CW  = W - M * 2;        // 555
      const R   = W - M;            // 575 — right content edge
      const INK = '#000000';

      const fmt       = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const amountStr = fmt.format(data.amountInr);
      const words     = amountInWords(data.amountInr);

      // ── helpers ──────────────────────────────────────────────────────────────
      const txt = (
        str: string, x: number, y: number, w: number,
        font: string, size: number,
        opts: { align?: 'left' | 'center' | 'right'; maxLines?: number } = {},
      ): number => {
        doc.font(font).fontSize(size);
        const lineH = doc.currentLineHeight(true);
        const max   = opts.maxLines ?? 1;
        const h     = Math.min(doc.heightOfString(str, { width: w }), lineH * max);
        doc.fillColor(INK).text(str, x, y, { width: w, height: h + 0.5, ellipsis: true, align: opts.align ?? 'left' });
        return h;
      };

      const rule = (y: number, lw = 0.5): void => {
        doc.moveTo(M, y).lineTo(R, y).strokeColor(INK).lineWidth(lw).stroke();
      };

      // ── White background ─────────────────────────────────────────────────────
      doc.rect(0, 0, W, H).fill('white');

      let y = M;

      // ── Header: Hospital details (LEFT) | RECEIPT centred | Invoice No. + Date/Time (RIGHT) ──
      // Left column: hospital name, reg no, address
      // Centre: "RECEIPT" in large bold
      // Right column: Invoice No. on top, Date & Time directly below

      const hdrRightW = 130;                        // width reserved for the right column
      const hdrCentreW = 80;                        // width reserved for "RECEIPT"
      const hdrLeftW  = CW - hdrCentreW - hdrRightW - 8; // remaining left width
      // Centre "RECEIPT" on the full page width, not relative to the left column.
      const hdrCentreX = (W - hdrCentreW) / 2;
      const hdrRightX  = R - hdrRightW;

      // Right column values
      const invoiceDateStr = formatReceiptDateTime(data.paymentDate);

      // Draw left: hospital name
      txt(data.hospitalName, M, y, hdrLeftW, 'Helvetica-Bold', 10, { maxLines: 1 });
      // Draw centre: RECEIPT — horizontally centred on the full A5 page width
      doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
        .text('RECEIPT', hdrCentreX, y, { width: hdrCentreW, align: 'center', lineBreak: false });
      // Draw right: Invoice No.
      const invLblW = 58;
      const invValX = hdrRightX + invLblW + 4;
      const invValW = R - invValX;
      doc.font('Helvetica').fontSize(7.5).fillColor(INK)
        .text('Invoice No.', hdrRightX, y, { width: invLblW, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK)
        .text(data.invoiceNumber, invValX, y, { width: invValW, lineBreak: false, ellipsis: true });
      y += 11;

      // Draw left: reg no + address (up to 2 lines total)
      let hdrLeftY = y;
      if (data.hospitalRegistrationNumber) {
        txt(`Reg. No.: ${data.hospitalRegistrationNumber}`, M, hdrLeftY, hdrLeftW, 'Helvetica', 7, { maxLines: 1 });
        hdrLeftY += 9;
      }
      if (data.hospitalAddress) {
        txt(data.hospitalAddress, M, hdrLeftY, hdrLeftW, 'Helvetica', 7, { maxLines: 2 });
      }
      // Draw right: Date & Time directly below Invoice No.
      doc.font('Helvetica').fontSize(7.5).fillColor(INK)
        .text('Date & Time', hdrRightX, y, { width: invLblW, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK)
        .text(invoiceDateStr, invValX, y, { width: invValW, lineBreak: false, ellipsis: true });

      // Advance y past header content (reg+address can be 2 lines = ~18pt)
      y += 20;

      rule(y, 1.5);
      y += 6;

      // ── Patient / payment details (3 rows × 2 columns) ────────────────────────
      // Row 1: Patient Name  | UHID
      // Row 2: Age / Gender  | Mobile No.
      // Row 3: Payment Status | Payment Mode

      const payStatusRow = data.metaRows.find(([l]) => l === 'Payment Status');
      const payModeRow   = data.metaRows.find(([l]) => l === 'Payment Mode');

      const ageGender = [
        formatPatientAge(data.patientAge, data.patientAgeUnit),
        data.patientGender ? toDisplay(data.patientGender) : null,
      ].filter(Boolean).join(' / ');

      const patLblW = 72;
      const patLCol = M;
      const patRCol = M + Math.floor(CW / 2) + 10;
      const patLW   = patRCol - patLCol - 10;
      const patRW   = R - patRCol;

      const patDraw = (label: string, value: string, x: number, maxW: number, rowY: number) => {
        doc.font('Helvetica').fontSize(7.5).fillColor(INK)
          .text(label, x, rowY, { width: patLblW, lineBreak: false });
        doc.font('Helvetica').fontSize(7.5)
          .text(':', x + patLblW, rowY, { width: 8, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(7.5)
          .text(value || '—', x + patLblW + 10, rowY,
            { width: maxW - patLblW - 12, lineBreak: false, ellipsis: true });
      };

      // Row 1: Patient Name | UHID
      patDraw('Patient Name', data.patientName, patLCol, patLW, y);
      patDraw('UHID', data.patientId, patRCol, patRW, y);
      y += 11;

      // Row 2: Age / Gender | Mobile No.
      if (ageGender) patDraw('Age / Gender', ageGender, patLCol, patLW, y);
      if (data.patientMobile) patDraw('Mobile No.', data.patientMobile, patRCol, patRW, y);
      y += 11;

      // Row 3: Payment Status | Payment Mode
      patDraw('Payment Status', payStatusRow ? payStatusRow[1] : 'Paid', patLCol, patLW, y);
      patDraw('Payment Mode', payModeRow ? payModeRow[1] : '—', patRCol, patRW, y);
      y += 11;

      y += 2;
      rule(y, 1);
      y += 5;

      // ── Service table ─────────────────────────────────────────────────────────
      // Columns: # | Item Name | Unit Price | Qty | Amount
      // Within CW = 555:
      //   #          M+0  … 22 pt
      //   Item Name  M+26 … 295 pt
      //   Unit Price M+325… 75 pt  (right-aligned)
      //   Qty        M+404… 42 pt  (center-aligned)
      //   Amount     M+450… to R   (right-aligned)
      const cNo   = M;
      const wNo   = 22;
      const cDesc = M + 26;
      const wDesc = 295;
      const cUP   = M + 325;
      const wUP   = 75;
      const cQty  = M + 404;
      const wQty  = 42;
      const cAmt  = M + 450;
      const wAmt  = R - (M + 450);

      // Header row with light grey fill
      doc.rect(M, y, CW, 13).fillColor('#f0f0f0').fill();
      rule(y, 0.75);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK);
      doc.text('#',               cNo,   y + 3, { width: wNo,   align: 'center', lineBreak: false });
      doc.text('Item Name',       cDesc, y + 3, { width: wDesc, lineBreak: false });
      doc.text('Unit Price (Rs.)', cUP,   y + 3, { width: wUP,   align: 'right',  lineBreak: false });
      doc.text('Qty',              cQty,  y + 3, { width: wQty,  align: 'center', lineBreak: false });
      doc.text('Amount (Rs.)',     cAmt,  y + 3, { width: wAmt,  align: 'right',  lineBreak: false });
      y += 13;
      rule(y, 0.75);
      y += 3;

      // Table rows
      data.serviceRows.forEach((row, idx) => {
        const rowY   = y;
        const upStr  = fmt.format(row.unitPrice);
        const amtStr = fmt.format(row.amount);

        // Strip "Pathology Test: " / "Imaging Test: " prefix — test name is enough
        const desc = row.description.replace(/^(Pathology Test|Imaging Test|Radiology Test):\s*/i, '');

        doc.font('Helvetica').fontSize(7.5);
        const lineH = doc.currentLineHeight(true);
        const descH = Math.min(doc.heightOfString(desc, { width: wDesc }), lineH * 2);

        doc.fillColor(INK).text(String(idx + 1), cNo, rowY + (descH - lineH) / 2,
          { width: wNo, align: 'center', lineBreak: false });
        doc.fillColor(INK).text(desc, cDesc, rowY,
          { width: wDesc, height: descH + 0.5, ellipsis: true });

        const mid = rowY + (descH - lineH) / 2;
        doc.font('Helvetica').fontSize(7.5).fillColor(INK);
        doc.text(upStr,           cUP,  mid, { width: wUP,  align: 'right',  lineBreak: false });
        doc.text(String(row.quantity), cQty, mid, { width: wQty, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK);
        doc.text(amtStr,          cAmt, mid, { width: wAmt, align: 'right',  lineBreak: false });

        y += descH + 4;
      });

      y += 2;
      rule(y, 0.75);
      y += 4;

      // ── Totals (right-aligned) ────────────────────────────────────────────────
      const totX  = M + 388;
      const totLW = 92;
      const totVX = totX + totLW + 4;
      const totVW = R - totVX;

      const totRow = (label: string, val: string, bold = false): void => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(INK);
        doc.text(label, totX, y, { width: totLW, align: 'right', lineBreak: false });
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(INK);
        doc.text(val,   totVX, y, { width: totVW, align: 'right', lineBreak: false });
        y += 11;
      };

      totRow('Subtotal',     amountStr);
      totRow('Discount',     '0.00');
      totRow('Total Amount', amountStr, true);
      y += 4;

      // ── Payment summary bar: Amount Paid | Amount in Words (Balance Due removed) ──
      rule(y, 0.75);
      const barH   = 22;
      const barY   = y;
      const c1W    = 150;
      const c2W    = CW - c1W;
      const c1x    = M;
      const c2x    = M + c1W;

      doc.moveTo(c2x, barY).lineTo(c2x, barY + barH).strokeColor(INK).lineWidth(0.5).stroke();

      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text('Amount Paid', c1x + 4, barY + 3, { width: c1W - 8, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
        .text(`Rs. ${amountStr}`, c1x + 4, barY + 11, { width: c1W - 8, lineBreak: false });

      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text('Amount in Words', c2x + 4, barY + 3, { width: c2W - 8, lineBreak: false });
      doc.font('Helvetica-Oblique').fontSize(7).fillColor(INK);
      const wordsH = Math.min(
        doc.heightOfString(words, { width: c2W - 8 }), doc.currentLineHeight(true) * 2,
      );
      doc.text(words, c2x + 4, barY + 12, { width: c2W - 8, height: wordsH + 0.5, ellipsis: true });

      y = barY + barH;
      rule(y, 0.75);
      y += 6;

      // ── Footer: Created By (left) + Authorized Signature (right) ─────────────
      const sigLineW = 110;
      const sigLineX = R - sigLineW;
      const footerStartY = y;

      if (data.footerRows.length > 0) {
        data.footerRows.forEach(([label, val]) => {
          const fl = `${label}: `;
          doc.font('Helvetica').fontSize(7).fillColor(INK).text(fl, M, y, { lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(7).fillColor(INK)
            .text(val || '—', M + doc.widthOfString(fl), y, { lineBreak: false });
          y += 10;
        });
      }

      // Authorized Signature — right side, anchored above the thank-you rule
      const footerRuleY = H - 14;
      const authSigLineY = footerRuleY - 13;
      const authSigLabelY = authSigLineY + 3;

      doc.strokeColor(INK).lineWidth(0.5)
        .moveTo(sigLineX, authSigLineY).lineTo(R, authSigLineY).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text('Authorized Signature', sigLineX, authSigLabelY,
          { width: sigLineW, align: 'center', lineBreak: false });

      void footerStartY; // suppress unused-var warning

      // ── Footer rule + thank-you line ──────────────────────────────────────────
      rule(footerRuleY);
      doc.font('Helvetica').fontSize(7).fillColor(INK)
        .text(
          `Thank you for visiting ${data.hospitalName}`,
          M, footerRuleY + 4, { width: CW, align: 'center', lineBreak: false },
        );

      doc.end();
    });
  }
}

export const pdfService = new PdfService();
