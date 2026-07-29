import { buildDischargeSummaryPdf } from '../../../src/modules/ipd/discharge-summary.pdf';
import { DischargeSummaryData } from '../../../src/modules/ipd/ipd.types';

function makeData(overrides: Partial<DischargeSummaryData> = {}): DischargeSummaryData {
  return {
    hospital: { name: 'City Hospital', logoUrl: null, primaryColor: '#1A73E8', address: '123 Main St, Springfield', email: 'admin@cityhospital.test' },
    patient: {
      patientId: 'PAT-ABCD1234', fullName: 'Ravi Kumar', age: 45, gender: 'MALE', mobileNumber: '9876543210',
      address: '45 Park Lane', registeredAt: '2026-01-01T10:00:00.000Z', registeredByName: 'Reception Staff',
    },
    opdVisits: [
      {
        visitId: 'OPD-0001', visitDate: '2026-01-05T09:00:00.000Z', status: 'COMPLETED',
        departmentName: 'Cardiology', doctorNames: ['Dr. Asha Rao'],
        diagnosis: 'Mild hypertension', prescription: 'Amlodipine 5mg once daily',
        notesHtml: '<p><strong>Patient</strong> reports <em>occasional</em> dizziness.</p><ul><li>BP checked</li><li>ECG normal</li></ul>',
      },
    ],
    admission: {
      admissionId: 'ADM-0001', wardName: 'General Ward', bedNumber: 'B-12', departmentName: 'Cardiology',
      assignedDoctorNames: ['Dr. Asha Rao'], assignedNurseNames: ['Nurse Priya'],
      admissionDate: '2026-01-06T08:00:00.000Z', dischargeDate: '2026-01-10T14:30:00.000Z',
      dischargedByName: 'Dr. Asha Rao',
      progressNotes: [
        { authorName: 'Nurse Priya', authorRole: 'NURSE', timestamp: '2026-01-07T09:00:00.000Z', noteHtml: 'Vitals stable. <u>No complaints</u>.' },
        { authorName: null, authorRole: null, timestamp: '2026-01-08T09:00:00.000Z', noteHtml: 'Legacy plain-text note with no author on record.' },
      ],
    },
    labRequests: [
      {
        requestId: 'LAB-0001', category: 'PATHOLOGY', type: 'Complete Blood Count', status: 'COMPLETED', priority: 'NORMAL',
        requestedByName: 'Dr. Asha Rao', departmentName: 'Cardiology', requestedAt: '2026-01-06T10:00:00.000Z',
        notesHtml: 'Routine check', reportUrl: 'https://s3.test/report.pdf',
      },
    ],
    billing: {
      payments: [
        { amount: 500, paymentMethod: 'CASH', status: 'COMPLETED', description: 'OPD Consultation', createdAt: '2026-01-05T09:30:00.000Z' },
        { amount: 5000, paymentMethod: 'UPI', status: 'COMPLETED', description: 'IPD Admission', createdAt: '2026-01-06T08:30:00.000Z' },
      ],
      total: 5500,
    },
    generatedAt: '2026-01-10T15:00:00.000Z',
    ...overrides,
  };
}

function pageCount(buf: Buffer): number {
  const match = /\/Count\s+(\d+)/.exec(buf.toString('latin1'));
  return match ? parseInt(match[1], 10) : 0;
}

describe('buildDischargeSummaryPdf', () => {
  test('generates a valid single-page PDF buffer with full data', async () => {
    const buf = await buildDischargeSummaryPdf(makeData());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThanOrEqual(1);
  });

  test('handles minimal data — no OPD visits, no lab requests, no billing, no attributions — without crashing', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [],
      labRequests: [],
      billing: null,
      patient: { ...base.patient, registeredByName: null, address: null },
      admission: { ...base.admission, dischargedByName: null, assignedDoctorNames: [], assignedNurseNames: [], progressNotes: [] },
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('overflows onto multiple pages for a long progress-note history, with correct page numbering', async () => {
    const base = makeData();
    const manyNotes = Array.from({ length: 60 }, (_, i) => ({
      authorName: 'Dr. Asha Rao', authorRole: 'DOCTOR', timestamp: `2026-01-0${(i % 9) + 1}T09:00:00.000Z`,
      noteHtml: `<p>Progress note number ${i + 1} with <strong>bold</strong> and <em>italic</em> text describing the patient's ongoing condition in reasonable detail so the paragraph wraps across multiple lines.</p>`,
    }));
    const buf = await buildDischargeSummaryPdf({ ...base, admission: { ...base.admission, progressNotes: manyNotes } });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pageCount(buf)).toBeGreaterThan(1);
  });

  test('handles legacy plain-text notes (pre-rich-text data) safely', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [{ ...base.opdVisits[0], notesHtml: 'Plain legacy note.\nSecond line.' }],
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('does not attempt a network fetch (and does not hang/crash) when the hospital has no logo', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({ ...base, hospital: { ...base.hospital, logoUrl: null } });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('an unreachable logo URL degrades gracefully instead of failing generation', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      hospital: { ...base.hospital, logoUrl: 'http://127.0.0.1:1/nonexistent-logo.png' },
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  }, 10000);

  test('multiple OPD visits and lab requests are all included', async () => {
    const base = makeData();
    const buf = await buildDischargeSummaryPdf({
      ...base,
      opdVisits: [base.opdVisits[0], { ...base.opdVisits[0], visitId: 'OPD-0002', diagnosis: 'Follow-up: improving' }],
      labRequests: [base.labRequests[0], { ...base.labRequests[0], requestId: 'LAB-0002', category: 'RADIOLOGY', type: 'Chest X-Ray' }],
    });
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});
