import PDFDocument from 'pdfkit';

export interface MedicalCardData {
  patientId:               string;
  fullName:                string;
  dateOfBirth:             Date;
  gender:                  string;
  mobileNumber:            string;
  address?:                string;
  bloodGroup?:             string;
  emergencyContactName?:   string;
  emergencyContactMobile?: string;
  hospitalName:            string;
  hospitalLogoUrl?:        string;
  primaryColor:            string;
}

export interface ReceiptData {
  receiptNumber:    string;
  patientName:      string;
  patientId:        string;
  paymentDate:      Date;
  amountInr:        number;
  paymentMethod:    string;
  description:      string;
  hospitalName:     string;
  hospitalLogoUrl?: string;
  primaryColor:     string;
}

export interface GeneratePDFOptions {
  compress?: boolean; // default true; false in tests for text-searchable streams
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [isNaN(r) ? 0 : r, isNaN(g) ? 0 : g, isNaN(b) ? 0 : b];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

      // ── Patient ID (below hospital name) ─────────────────────────────────────
      doc.fillColor('#555555').fontSize(8).font('Helvetica')
        .text(`ID: ${data.patientId}`, M, 34, { width: NAME_W, lineBreak: false });

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

      doc.end();
    });
  }

  // ─── U5-A-01: Payment Receipt PDF ────────────────────────────────────────────
  generateReceipt(data: ReceiptData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const { compress = true } = options;
    return new Promise((resolve, reject) => {
      // A5 portrait: 419 × 595 pt
      const doc = new PDFDocument({
        size:    [419, 595],
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        compress,
        info: {
          Title:        `Receipt - ${data.receiptNumber}`,
          Author:       data.hospitalName,
          Subject:      'Payment Receipt',
          CreationDate: data.paymentDate,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data',  (c: Buffer) => chunks.push(c));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W  = doc.page.width;   // 419
      const H  = doc.page.height;  // 595
      const M  = 24;
      const CW = W - M * 2;        // 371
      const [pr, pg, pb] = hexToRgb(data.primaryColor);

      // ── Background + border ──────────────────────────────────────────────────
      doc.rect(0, 0, W, H).fill('white');
      doc.rect(1, 1, W - 2, H - 2).strokeColor('#DDDDDD').lineWidth(0.5).stroke();

      // ── Header band ──────────────────────────────────────────────────────────
      doc.rect(0, 0, W, 56).fill([pr, pg, pb]);
      doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
        .text(data.hospitalName, M, 15, { width: CW - 90, lineBreak: false });
      doc.fontSize(9).font('Helvetica')
        .text('PAYMENT RECEIPT', W - M - 95, 22, { width: 90, align: 'right', lineBreak: false });

      // ── Receipt # and Date ────────────────────────────────────────────────────
      let y = 72;
      doc.fillColor('#555555').fontSize(8).font('Helvetica-Bold')
        .text('Receipt #:', M, y, { lineBreak: false, continued: true });
      doc.font('Helvetica').fillColor('#111111')
        .text(` ${data.receiptNumber}`, { lineBreak: false });

      const dateStr = formatDate(data.paymentDate);
      doc.fillColor('#555555').fontSize(8).font('Helvetica-Bold')
        .text('Date:', W - M - 120, y, { width: 115, align: 'right', lineBreak: false, continued: true });
      doc.font('Helvetica').fillColor('#111111')
        .text(` ${dateStr}`, { lineBreak: false });

      // ── Divider ───────────────────────────────────────────────────────────────
      y += 20;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#EEEEEE').lineWidth(1).stroke();

      // ── Patient info ──────────────────────────────────────────────────────────
      y += 14;
      const LW = 110;

      const row = (label: string, value: string, rowY: number): void => {
        doc.fillColor('#777777').fontSize(8).font('Helvetica-Bold')
          .text(label, M, rowY, { width: LW, lineBreak: false });
        doc.fillColor('#111111').fontSize(8).font('Helvetica')
          .text(value, M + LW, rowY, { width: CW - LW, lineBreak: false });
      };

      row('Patient Name:', data.patientName, y);  y += 18;
      row('Patient ID:',   data.patientId,   y);

      // ── Divider ───────────────────────────────────────────────────────────────
      y += 22;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#EEEEEE').lineWidth(1).stroke();

      // ── Payment info ──────────────────────────────────────────────────────────
      y += 14;
      row('Description:',     data.description,   y);  y += 18;
      row('Payment Method:',  data.paymentMethod, y);

      // ── Amount highlight box ──────────────────────────────────────────────────
      y += 34;
      const BOX_H = 52;
      doc.rect(M, y, CW, BOX_H).fill([pr, pg, pb]);

      const amountStr = new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(data.amountInr);

      doc.fillColor('white').fontSize(8).font('Helvetica')
        .text('AMOUNT PAID (INR)', M + 10, y + 10, { width: CW - 20, lineBreak: false });
      doc.fontSize(22).font('Helvetica-Bold')
        .text(`₹ ${amountStr}`, M + 10, y + 22, { width: CW - 20, align: 'right', lineBreak: false });

      // ── Footer ────────────────────────────────────────────────────────────────
      y = H - 44;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#EEEEEE').lineWidth(1).stroke();
      y += 12;
      doc.fillColor('#AAAAAA').fontSize(8).font('Helvetica')
        .text('Thank you for your payment.', M, y, { width: CW, align: 'center', lineBreak: false });

      doc.end();
    });
  }
}

export const pdfService = new PdfService();
