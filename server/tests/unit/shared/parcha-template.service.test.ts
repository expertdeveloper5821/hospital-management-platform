import { PDFDocument } from 'pdf-lib';
import {
  validateSinglePageA4Pdf,
  renderParchaOverlay,
  A4_WIDTH_PT,
  A4_HEIGHT_PT,
  ParchaOverlayInput,
} from '../../../src/shared/services/parcha-template.service';
import { ValidationError } from '../../../src/shared/middleware/error-handler';

async function makePdf(pageSizes: [number, number][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (const size of pageSizes) doc.addPage(size);
  return Buffer.from(await doc.save());
}

const SAMPLE_OVERLAY: ParchaOverlayInput = {
  fieldRows: [
    { label: 'Patient Name', value: 'Priya Sharma' },
    { label: 'Patient ID',   value: 'HMS-0001' },
    { label: 'Age / Gender', value: '34 years / Female' },
    { label: 'Mobile',       value: '9876543210' },
    { label: 'Visit ID',     value: 'VISIT-0001' },
    { label: 'Visit Date',   value: '15 Apr 2026' },
  ],
  vitals: [
    { label: 'Weight (kg)',           value: '62' },
    { label: 'Height (cm)',           value: '' },
    { label: 'Blood Pressure (mmHg)', value: '120/80' },
    { label: 'Sugar (mg/dL)',         value: '' },
    { label: 'Body Temperature (°F)', value: '98.6' },
  ],
  bodySections: [
    { heading: 'Diagnosis',    text: 'Seasonal flu',                weight: 1 },
    { heading: 'Prescription', text: 'Paracetamol 500mg twice a day', weight: 5 },
    { heading: 'Notes',        text: 'Follow up in a week.',        weight: 3 },
  ],
  footerText: 'This is valid for 15 days.',
};

describe('validateSinglePageA4Pdf', () => {
  test('accepts a single portrait A4 page', async () => {
    const pdf = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);
    await expect(validateSinglePageA4Pdf(pdf)).resolves.toBeUndefined();
  });

  test('accepts a page within rounding tolerance of A4 (595 × 842)', async () => {
    const pdf = await makePdf([[595, 842]]);
    await expect(validateSinglePageA4Pdf(pdf)).resolves.toBeUndefined();
  });

  test('rejects a multi-page PDF', async () => {
    const pdf = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT], [A4_WIDTH_PT, A4_HEIGHT_PT]]);
    await expect(validateSinglePageA4Pdf(pdf)).rejects.toThrow(ValidationError);
    await expect(validateSinglePageA4Pdf(pdf)).rejects.toThrow(/exactly one page/i);
  });

  test('rejects a Letter-sized page', async () => {
    const pdf = await makePdf([[612, 792]]);
    await expect(validateSinglePageA4Pdf(pdf)).rejects.toThrow(/A4/i);
  });

  test('rejects a landscape page', async () => {
    const pdf = await makePdf([[A4_HEIGHT_PT, A4_WIDTH_PT]]);
    await expect(validateSinglePageA4Pdf(pdf)).rejects.toThrow(/portrait/i);
  });

  test('rejects a non-PDF buffer', async () => {
    await expect(validateSinglePageA4Pdf(Buffer.from('not a pdf'))).rejects.toThrow(/not a valid PDF/i);
  });
});

describe('renderParchaOverlay', () => {
  test('returns a single-page PDF the same size as the template', async () => {
    const template = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);
    const merged = await renderParchaOverlay(template, SAMPLE_OVERLAY);

    expect(Buffer.isBuffer(merged)).toBe(true);
    expect(merged.slice(0, 4).toString('ascii')).toBe('%PDF');

    const reloaded = await PDFDocument.load(merged);
    expect(reloaded.getPageCount()).toBe(1);
    const { width, height } = reloaded.getPage(0).getSize();
    expect(width).toBeCloseTo(A4_WIDTH_PT, 0);
    expect(height).toBeCloseTo(A4_HEIGHT_PT, 0);
  });

  test('does not throw for empty overlay data', async () => {
    const template = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);
    const empty: ParchaOverlayInput = {
      fieldRows: [],
      vitals: [
        { label: 'Weight (kg)', value: '' },
        { label: 'Height (cm)', value: '' },
        { label: 'Blood Pressure (mmHg)', value: '' },
        { label: 'Sugar (mg/dL)', value: '' },
        { label: 'Body Temperature (°F)', value: '' },
      ],
      bodySections: [],
      footerText: '',
    };
    await expect(renderParchaOverlay(template, empty)).resolves.toBeInstanceOf(Buffer);
  });

  test('clips very long body text to a single page without throwing', async () => {
    const template = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);
    const longText = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(500);
    const overlay: ParchaOverlayInput = {
      ...SAMPLE_OVERLAY,
      bodySections: [
        { heading: 'Progress Notes', text: longText, weight: 1 },
      ],
    };
    const merged = await renderParchaOverlay(template, overlay);
    const reloaded = await PDFDocument.load(merged);
    expect(reloaded.getPageCount()).toBe(1);
  });

  test('handles a single unbroken overlong token without throwing', async () => {
    const template = await makePdf([[A4_WIDTH_PT, A4_HEIGHT_PT]]);
    const overlay: ParchaOverlayInput = {
      ...SAMPLE_OVERLAY,
      bodySections: [
        { heading: 'Notes', text: 'x'.repeat(300), weight: 1 },
      ],
    };
    await expect(renderParchaOverlay(template, overlay)).resolves.toBeInstanceOf(Buffer);
  });
});
