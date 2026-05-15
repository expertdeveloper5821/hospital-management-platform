import PDFDocument from 'pdfkit';

export interface MedicalCardData {
  patientId:    string;
  name:         string;
  dateOfBirth:  Date;
  gender:       'Male' | 'Female' | 'Other';
  bloodGroup:   string;
  contactNumber: string;
  address?:     string;
  emergencyContact?: string;
  tenantBranding: {
    displayName:  string;
    primaryColor: string; // hex e.g. #1A73E8
    logoUrl?:     string;
  };
  issuedAt?: Date;
}

// Converts "#RRGGBB" to [r, g, b] tuple for PDFKit color methods.
function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return [
    isNaN(r) ? 0 : r,
    isNaN(g) ? 0 : g,
    isNaN(b) ? 0 : b,
  ];
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  });
}

export interface GeneratePDFOptions {
  compress?: boolean; // default true; set false in tests for searchable text streams
}

export class PDFService {
  /**
   * Generates a Medical Card PDF for a patient with tenant branding applied.
   * Returns the complete PDF as a Buffer (ready for S3 upload or direct download).
   *
   * Layout:
   *   - Header band: tenant primary color + hospital name
   *   - Patient info grid: ID, name, DOB, gender, blood group, contact, address
   *   - Footer: issued date + disclaimer
   */
  generateMedicalCard(data: MedicalCardData, options: GeneratePDFOptions = {}): Promise<Buffer> {
    const { compress = true } = options;
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size:     'A5',
        margins:  { top: 0, bottom: 0, left: 0, right: 0 },
        compress,
        info: {
          Title:        `Medical Card — ${data.name}`,
          Author:       data.tenantBranding.displayName,
          Subject:      'Patient Medical Card',
          CreationDate: data.issuedAt ?? new Date(),
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_W  = doc.page.width;
      const MARGIN  = 24;
      const CONTENT_W = PAGE_W - MARGIN * 2;

      const [r, g, b] = hexToRgb(data.tenantBranding.primaryColor);

      // ── Header band ──────────────────────────────────────────────────────────
      const HEADER_H = 64;
      doc.rect(0, 0, PAGE_W, HEADER_H).fill([r, g, b]);

      doc
        .fillColor('white')
        .fontSize(18)
        .font('Helvetica-Bold')
        .text(data.tenantBranding.displayName, MARGIN, 14, {
          width: CONTENT_W,
          align: 'left',
        });

      doc
        .fontSize(10)
        .font('Helvetica')
        .text('PATIENT MEDICAL CARD', MARGIN, 38, {
          width: CONTENT_W,
          align: 'left',
        });

      // ── Patient ID badge (top-right corner) ─────────────────────────────────
      const ID_BOX_W = 120;
      const ID_BOX_H = 36;
      const ID_BOX_X = PAGE_W - MARGIN - ID_BOX_W;
      doc
        .rect(ID_BOX_X, 14, ID_BOX_W, ID_BOX_H)
        .fillAndStroke('white', 'white');

      doc
        .fillColor([r, g, b])
        .fontSize(7)
        .font('Helvetica')
        .text('PATIENT ID', ID_BOX_X + 4, 18, { width: ID_BOX_W - 8, align: 'center' });

      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(data.patientId, ID_BOX_X + 4, 28, { width: ID_BOX_W - 8, align: 'center' });

      // ── Section divider ──────────────────────────────────────────────────────
      let y = HEADER_H + 16;

      const drawField = (label: string, value: string, x: number, colWidth: number): void => {
        doc
          .fillColor('#666666')
          .fontSize(7)
          .font('Helvetica')
          .text(label.toUpperCase(), x, y, { width: colWidth });

        doc
          .fillColor('#111111')
          .fontSize(10)
          .font('Helvetica-Bold')
          .text(value || '—', x, y + 10, { width: colWidth });
      };

      // Row 1: Name (full width)
      drawField('Full Name', data.name, MARGIN, CONTENT_W);
      y += 36;

      // Row 2: DOB | Gender
      const COL2 = CONTENT_W / 2 - 8;
      drawField('Date of Birth', formatDate(data.dateOfBirth), MARGIN, COL2);
      drawField('Gender', data.gender, MARGIN + COL2 + 16, COL2);
      y += 36;

      // Row 3: Blood Group | Contact
      drawField('Blood Group', data.bloodGroup, MARGIN, COL2);
      drawField('Contact', data.contactNumber, MARGIN + COL2 + 16, COL2);
      y += 36;

      // Row 4: Address (full width, optional)
      if (data.address) {
        drawField('Address', data.address, MARGIN, CONTENT_W);
        y += 36;
      }

      // Row 5: Emergency Contact (full width, optional)
      if (data.emergencyContact) {
        drawField('Emergency Contact', data.emergencyContact, MARGIN, CONTENT_W);
        y += 36;
      }

      // ── Horizontal rule ──────────────────────────────────────────────────────
      doc
        .moveTo(MARGIN, y)
        .lineTo(PAGE_W - MARGIN, y)
        .strokeColor('#DDDDDD')
        .lineWidth(0.5)
        .stroke();

      y += 10;

      // ── Footer ───────────────────────────────────────────────────────────────
      const issuedAt = data.issuedAt ?? new Date();
      doc
        .fillColor('#888888')
        .fontSize(8)
        .font('Helvetica')
        .text(`Issued: ${formatDate(issuedAt)}`, MARGIN, y, { width: CONTENT_W / 2 })
        .text(
          'This card is system-generated and valid only with an official seal.',
          MARGIN + CONTENT_W / 2,
          y,
          { width: CONTENT_W / 2, align: 'right' },
        );

      doc.end();
    });
  }
}

export const pdfService = new PDFService();
