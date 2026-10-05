import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose               from 'mongoose';
import request                from 'supertest';
import jwt                    from 'jsonwebtoken';
import zlib                   from 'zlib';
import { v4 as uuidv4 }      from 'uuid';

jest.mock('../../../src/shared/services/email.service', () => ({
  emailService: { sendInviteEmail: jest.fn(), sendWelcomeEmail: jest.fn() },
}));
jest.mock('../../../src/shared/services/audit.service', () => ({
  auditService: { log: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../../src/shared/services/s3.service', () => ({
  s3Service: {
    uploadFile:      jest.fn().mockResolvedValue('mocked-s3-key'),
    getPresignedUrl: jest.fn().mockResolvedValue('https://s3.test/presigned-url'),
  },
}));
jest.mock('../../../src/modules/notification/notification.service', () => ({
  notificationService: {
    sendNotification: jest.fn().mockResolvedValue(undefined),
    sendToRole:       jest.fn().mockResolvedValue(undefined),
  },
}));

import app                  from '../../../src/app';
import { UserModel }        from '../../../src/modules/user/user.model';
import { TenantModel }      from '../../../src/modules/tenant/tenant.model';
import { PatientModel }     from '../../../src/modules/patient/patient.model';
import { PathologyRequestModel } from '../../../src/modules/lab/lab.model';
import { OPDVisitModel }    from '../../../src/modules/opd/opd.model';
import { PaymentModel }     from '../../../src/modules/payment/payment.model';
import { auditService }     from '../../../src/shared/services/audit.service';
import { notificationService } from '../../../src/modules/notification/notification.service';
import { TenantStatus, UserRole } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

const CBC = 'CBC (Complete Blood Count)';
const LFT = 'LFT (Liver Function Test)';
const KFT = 'KFT / RFT (Kidney / Renal Function Test)';

let mongod: MongoMemoryServer;
let tenantId: string;
let doctorId: string;
let pathologistId: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));

  const tenant = await TenantModel.create({
    name: 'Lab Test Hospital', adminEmail: 'admin@labtest.com', status: TenantStatus.ACTIVE,
    onboardingDocuments: {
      registrationCertificate: 'reg-cert-001', gstNumber: 'GST001', panCard: 'PAN001',
      addressLine: '321 Lab Street', city: 'Mumbai', state: 'Maharashtra', pincode: '400001',
    },
  });
  tenantId = (tenant._id as mongoose.Types.ObjectId).toString();

  const mkUser = async (role: UserRole, name: string) => {
    const u = await UserModel.create({
      tenantId, email: `${role.toLowerCase()}@test.com`, name, passwordHash: 'x', role, isActive: true, isFirstLogin: false,
    });
    const id = (u._id as mongoose.Types.ObjectId).toString();
    tokens[role] = jwt.sign({ userId: id, tenantId, role, email: 'x@x.com', isFirstLogin: false }, JWT_SECRET);
    return id;
  };
  doctorId      = await mkUser(UserRole.DOCTOR, 'Lab Doctor');
  pathologistId = await mkUser(UserRole.PATHOLOGIST, 'Lab Pathologist');
  await mkUser(UserRole.RADIOLOGIST, 'Lab Radiologist');
  await mkUser(UserRole.HOSPITAL_ADMIN, 'Lab Admin');
  await mkUser(UserRole.NURSE, 'Lab Nurse');
  await mkUser(UserRole.RECEPTIONIST, 'Receptionist');
  await mkUser(UserRole.MANAGER, 'Manager');

  // A second doctor with no assignment to PAT-001 (Doctor scoping).
  const other = await UserModel.create({
    tenantId, email: 'other.doctor@test.com', name: 'Other Doctor', passwordHash: 'x',
    role: UserRole.DOCTOR, isActive: true, isFirstLogin: false,
  });
  tokens.OTHER_DOCTOR = jwt.sign(
    { userId: (other._id as mongoose.Types.ObjectId).toString(), tenantId, role: UserRole.DOCTOR, email: 'x@x.com', isFirstLogin: false },
    JWT_SECRET,
  );

  await PatientModel.create({
    patientId: 'PAT-001', tenantId, fullName: 'John Doe',
    dateOfBirth: new Date('1980-01-01'), gender: 'MALE',
    mobileNumber: '1234567890', address: '123 Test Street',
  });

  // PAT-001's OPD visit today, assigned to Lab Doctor — new requests link to it.
  await OPDVisitModel.create({
    visitId: 'OPD-LABTEST01', tenantId, patientId: 'PAT-001', doctorIds: [doctorId],
    departmentId: null, visitDate: new Date(), queueNumber: 1, status: 'OPEN',
  });
});

const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

async function createRequest(testType: string, role: string = UserRole.DOCTOR): Promise<string> {
  const res = await request(app).post('/api/lab/pathology').set(auth(role))
    .send({ patientId: 'PAT-001', testType, referredBy: doctorId });
  expect(res.status).toBe(201);
  return res.body.data.requestId as string;
}

async function markPaid(requestId: string): Promise<void> {
  await PaymentModel.create({
    paymentId: `PAY-${uuidv4()}`, tenantId, patientId: 'PAT-001',
    amount: 100, paymentMethod: 'CASH', description: 'Lab payment', status: 'COMPLETED',
    referenceType: 'PATHOLOGY_REQUEST', referenceId: requestId, createdBy: 'test',
  });
}

function submit(requestId: string, testIndex: number, body: Record<string, unknown>, role: string = UserRole.PATHOLOGIST) {
  return request(app).put(`/api/lab/pathology/${requestId}/reports/${testIndex}`).set(auth(role)).send(body);
}

function getDetail(requestId: string, role: string = UserRole.DOCTOR) {
  return request(app).get(`/api/lab/pathology/${requestId}`).set(auth(role));
}

function getPdf(requestId: string, testIndex: number, role: string = UserRole.DOCTOR) {
  return request(app).get(`/api/lab/pathology/${requestId}/reports/${testIndex}/pdf`).set(auth(role))
    .buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
}

// Decoded drawn text of a PDF (see tests/unit/lab/pathology-report.pdf.test.ts).
function pdfText(buf: Buffer): string {
  const out: string[] = [];
  let idx = 0;
  for (;;) {
    const start = buf.indexOf('stream', idx);
    if (start === -1) break;
    let s = start + 6;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;
    const end = buf.indexOf('endstream', s);
    if (end === -1) break;
    try {
      const content = zlib.inflateSync(buf.subarray(s, end)).toString('latin1');
      for (const m of content.matchAll(/<([0-9a-fA-F]*)>/g)) out.push(Buffer.from(m[1], 'hex').toString('latin1'));
    } catch { /* not Flate */ }
    idx = end + 9;
  }
  return out.join('');
}

// ─── Structured forms ─────────────────────────────────────────────────────────

describe('GET /api/lab/pathology/:requestId — structured test report forms', () => {
  test('returns one independently addressable form per selected test, with standard parameters, units and the patient\'s ranges', async () => {
    const id = await createRequest(`${CBC}, ${LFT}, ${KFT}`);
    const res = await getDetail(id);
    expect(res.status).toBe(200);
    const reports = res.body.data.testReports;
    expect(reports.map((r: { testIndex: number; testName: string; templateKey: string }) => [r.testIndex, r.testName, r.templateKey]))
      .toEqual([[0, CBC, 'CBC'], [1, LFT, 'LFT'], [2, KFT, 'KFT']]);
    expect(reports.every((r: { result: unknown }) => r.result === null)).toBe(true);

    const hb = reports[0].fields.find((f: { key: string }) => f.key === 'hemoglobin');
    expect(hb).toEqual(expect.objectContaining({ name: 'Haemoglobin (Hb)', unit: 'g/dL', inputType: 'number', referenceRange: '13.0 - 17.0' }));
    // Test names are kept exactly as selected.
    expect(res.body.data.testType).toBe(`${CBC}, ${LFT}, ${KFT}`);
  });

  test('a legacy request (stored before structured reports existed) still loads, with a generic form for a free-text test', async () => {
    const requestId = uuidv4();
    await mongoose.connection.collection('pathology_requests').insertOne({
      requestId, patientId: 'PAT-001', tenantId, requestedBy: doctorId, testType: 'Blood CBC',
      referredBy: 'SELF', departmentId: null, status: 'COMPLETED', priority: 'NORMAL', notes: null,
      reportS3Key: 'org/x/report.pdf', chargeId: null, isDeleted: false, deletedAt: null,
      requestedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    });
    const res = await getDetail(requestId, UserRole.HOSPITAL_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data.reportUrl).toBe('https://s3.test/presigned-url');
    expect(res.body.data.testReports).toEqual([
      expect.objectContaining({ testIndex: 0, testName: 'Blood CBC', templateKey: 'GENERIC', result: null }),
    ]);
  });

  test('Radiology requests are untouched (no structured reports)', async () => {
    const created = await request(app).post('/api/lab/radiology').set(auth(UserRole.DOCTOR))
      .send({ patientId: 'PAT-001', imagingType: 'X-Ray Chest' });
    const res = await request(app).get(`/api/lab/radiology/${created.body.data.requestId}`).set(auth(UserRole.DOCTOR));
    expect(res.status).toBe(200);
    expect(res.body.data.testReports).toBeUndefined();
  });
});

// ─── Submission ───────────────────────────────────────────────────────────────

describe('PUT /api/lab/pathology/:requestId/reports/:testIndex — submit a test report', () => {
  test('stores only the filled values with unit, range and flag; other tests stay pending; status → IN_PROGRESS', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);

    const res = await submit(id, 0, {
      testName: CBC,
      values:   { hemoglobin: '10.5', wbc: '12000', platelets: '', mcv: null, neutrophils: '60' },
      remarks:  'Mild anaemia.',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    const [cbc, lft] = res.body.data.testReports;
    expect(cbc.result.values).toEqual([
      { key: 'hemoglobin', name: 'Haemoglobin (Hb)', section: null, value: '10.5', unit: 'g/dL', referenceRange: '13.0 - 17.0', flag: 'LOW' },
      { key: 'wbc', name: 'Total Leucocyte Count (TLC / WBC)', section: null, value: '12000', unit: 'cells/µL', referenceRange: '4000 - 11000', flag: 'HIGH' },
      { key: 'neutrophils', name: 'Neutrophils', section: 'Differential Leucocyte Count', value: '60', unit: '%', referenceRange: '40 - 80', flag: null },
    ]);
    expect(cbc.result).toEqual(expect.objectContaining({
      remarks: 'Mild anaemia.', submittedBy: pathologistId, submittedByName: 'Lab Pathologist',
    }));
    expect(lft.result).toBeNull();
  });

  test('every test of a multi-test request is submitted independently; the request completes once all have reports', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    const res = await submit(id, 1, { testName: LFT, values: { sgpt: '55', albumin: '4.1' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.testReports[0].result.values.map((v: { key: string }) => v.key)).toEqual(['hemoglobin']);
    expect(res.body.data.testReports[1].result.values.map((v: { key: string; flag: string }) => [v.key, v.flag]))
      .toEqual([['sgpt', 'HIGH'], ['albumin', null]]);
  });

  test('re-submitting a test amends only that test', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    await submit(id, 1, { testName: LFT, values: { sgpt: '30' } }).expect(200);
    const res = await submit(id, 0, { testName: CBC, values: { hemoglobin: '13.2', rbc: '4.9' }, remarks: 'Corrected' });
    expect(res.status).toBe(200);
    const [cbc, lft] = res.body.data.testReports;
    expect(cbc.result.values.map((v: { value: string }) => v.value)).toEqual(['13.2', '4.9']);
    expect(cbc.result.remarks).toBe('Corrected');
    expect(lft.result.values.map((v: { value: string }) => v.value)).toEqual(['30']);
    const stored = await PathologyRequestModel.findOne({ requestId: id });
    expect(stored!.testReports).toHaveLength(2);
  });

  test('results are encrypted at rest; only the test name stays plaintext', async () => {
    const id = await createRequest(CBC);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '10.5' }, remarks: 'Sensitive remark' }).expect(200);
    const raw = await mongoose.connection.collection('pathology_requests').findOne({ requestId: id });
    expect(raw!.testReports[0].testName).toBe(CBC);
    expect(raw!.testReports[0].resultData).toMatch(/^enc:v1:/);
    expect(JSON.stringify(raw)).not.toContain('Sensitive remark');
    expect(JSON.stringify(raw)).not.toContain('10.5');
  });

  test('all fields are optional individually, but an entirely empty report is rejected', async () => {
    const id = await createRequest(CBC);
    await markPaid(id);
    const empty = await submit(id, 0, { testName: CBC, values: { hemoglobin: '', rbc: null } });
    expect(empty.status).toBe(400);
    expect(empty.body.message).toMatch(/at least one result/);
    await submit(id, 0, { testName: CBC, values: {}, remarks: 'Sample haemolysed — repeat advised.' }).expect(200);
  });

  test.each([
    [{ hemoglobin: 'ten' },      /Haemoglobin \(Hb\) must be a number/],
    [{ unknownField: '1' },      /Unknown result field/],
  ])('rejects invalid values %p', async (values, message) => {
    const id = await createRequest(CBC);
    await markPaid(id);
    const res = await submit(id, 0, { testName: CBC, values });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });

  test('select parameters only accept their listed options', async () => {
    const id = await createRequest('Dengue NS1 / IgM / IgG');
    await markPaid(id);
    const bad = await submit(id, 0, { testName: 'Dengue NS1 / IgM / IgG', values: { ns1: 'Maybe' } });
    expect(bad.status).toBe(400);
    const ok = await submit(id, 0, { testName: 'Dengue NS1 / IgM / IgG', values: { ns1: 'Positive', igm: 'Negative' } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.testReports[0].result.values.map((v: { flag: string | null }) => v.flag)).toEqual(['ABNORMAL', null]);
  });

  test('requires the payment to have been collected (same rule as file upload)', async () => {
    const id = await createRequest(CBC);
    const res = await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Payment must be collected/);
  });

  test('rejects a stale form (test name no longer at that index) with 409 and an unknown index with 404', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    expect((await submit(id, 1, { testName: CBC, values: { hemoglobin: '14' } })).status).toBe(409);
    expect((await submit(id, 5, { testName: CBC, values: { hemoglobin: '14' } })).status).toBe(404);
    expect((await submit(id, -1 as unknown as number, { testName: CBC, values: {} })).status).toBe(400);
  });

  test('Hospital Admin may submit', async () => {
    const id = await createRequest(CBC);
    await markPaid(id);
    expect((await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }, UserRole.HOSPITAL_ADMIN)).status).toBe(200);
  });

  test.each([UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.MANAGER, UserRole.RADIOLOGIST])(
    '%s cannot submit a report (backend-enforced)',
    async (role) => {
      const id = await createRequest(CBC);
      await markPaid(id);
      const res = await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }, role);
      expect(res.status).toBe(403);
      const stored = await PathologyRequestModel.findOne({ requestId: id });
      expect(stored!.testReports).toHaveLength(0);
    },
  );

  test('notifies the requester / referring / assigned doctor and audits without result values', async () => {
    const id = await createRequest(CBC);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '10.5' }, remarks: 'secret' }).expect(200);

    expect(notificationService.sendNotification).toHaveBeenCalledWith(
      doctorId, tenantId, 'Pathology Report Ready', expect.stringContaining(CBC), 'PATHOLOGY_REQUEST', id,
    );
    const reportAudit = (auditService.log as jest.Mock).mock.calls
      .map(([entry]) => entry)
      .find((e) => e.newValue?.testReport);
    expect(reportAudit).toEqual(expect.objectContaining({
      entityType: 'PATHOLOGY_REQUEST', entityId: id, action: 'UPDATE',
      newValue: { status: 'COMPLETED', testReport: { testName: CBC, action: 'SUBMITTED', results: '[redacted]' } },
    }));
    expect(JSON.stringify(reportAudit)).not.toContain('10.5');
    expect(JSON.stringify(reportAudit)).not.toContain('secret');
  });
});

// ─── Doctor viewing ───────────────────────────────────────────────────────────

describe('Doctor viewing of submitted reports', () => {
  test('the assigned doctor sees patient details, requested tests and submitted results', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '10.5' } }).expect(200);

    const res = await getDetail(id, UserRole.DOCTOR);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ fullName: 'John Doe', patientId: 'PAT-001' }));
    expect(res.body.data.encounter).toEqual(expect.objectContaining({ type: 'OPD', doctorNames: ['Lab Doctor'] }));
    expect(res.body.data.testReports[0].result.values).toEqual([expect.objectContaining({ key: 'hemoglobin', value: '10.5', flag: 'LOW' })]);
    expect(res.body.data.testReports[1].result).toBeNull();
  });

  test('a doctor with no assignment to the patient cannot read the request or its reports', async () => {
    const id = await createRequest(CBC, UserRole.HOSPITAL_ADMIN);
    await mongoose.connection.collection('pathology_requests').updateOne({ requestId: id }, { $set: { referredBy: 'SELF' } });
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    expect((await getDetail(id, 'OTHER_DOCTOR')).status).toBe(404);
    expect((await getPdf(id, 0, 'OTHER_DOCTOR')).status).toBe(404);
  });
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

describe('GET /api/lab/pathology/:requestId/reports/:testIndex/pdf', () => {
  test('each test of a CBC + LFT + KFT request generates its own separate PDF containing only that test', async () => {
    const id = await createRequest(`${CBC}, ${LFT}, ${KFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '10.5' } }).expect(200);
    await submit(id, 1, { testName: LFT, values: { sgpt: '55' } }).expect(200);
    await submit(id, 2, { testName: KFT, values: { urea: '30' } }).expect(200);

    const expectations: Array<[number, string, string, string[]]> = [
      [0, CBC, 'Haemoglobin (Hb)', ['SGPT (ALT)', 'Blood Urea']],
      [1, LFT, 'SGPT (ALT)',       ['Haemoglobin (Hb)', 'Blood Urea']],
      [2, KFT, 'Blood Urea',       ['Haemoglobin (Hb)', 'SGPT (ALT)']],
    ];
    for (const [index, testName, param, absent] of expectations) {
      const res = await getPdf(id, index);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline; filename="pathology-report-.+-PAT-001\.pdf"$/);
      const pdf = res.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      const text = pdfText(pdf);
      for (const t of ['John Doe', 'PAT-001', testName, param, 'OPD-LABTEST01']) {
        expect({ t, found: text.includes(t) }).toEqual({ t, found: true });
      }
      // Plain layout: no hospital header, request id or reporter/signature block.
      for (const t of ['PATHOLOGY REPORT', 'End of Report', 'Lab Test Hospital', id, 'Lab Pathologist', 'Reported By']) {
        expect({ t, found: text.includes(t) }).toEqual({ t, found: false });
      }
      for (const other of absent) expect({ other, found: text.includes(other) }).toEqual({ other, found: false });
    }
  });

  test('a test whose report has not been submitted has no PDF (404)', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    const res = await getPdf(id, 1);
    expect(res.status).toBe(404);
  });

  test.each([UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST])(
    '%s can download the PDF', async (role) => {
      const id = await createRequest(CBC);
      await markPaid(id);
      await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
      expect((await getPdf(id, 0, role)).status).toBe(200);
    },
  );

  test('Radiologist is excluded from Pathology report PDFs (403)', async () => {
    const id = await createRequest(CBC);
    expect((await getPdf(id, 0, UserRole.RADIOLOGIST)).status).toBe(403);
  });
});

// ─── Existing workflow is unchanged ───────────────────────────────────────────

describe('Existing Pathology workflow alongside structured reports', () => {
  test('Hospital Admin file upload still works on a request with a partially submitted structured report', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    const res = await request(app).patch(`/api/lab/pathology/${id}/report`).set(auth(UserRole.HOSPITAL_ADMIN))
      .attach('report', Buffer.from('%PDF-1.4 test'), { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    // The structured CBC report is preserved, and LFT can still be submitted afterwards.
    const after = await submit(id, 1, { testName: LFT, values: { sgpt: '30' } });
    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe('COMPLETED');
    expect(after.body.data.testReports.map((r: { result: unknown }) => !!r.result)).toEqual([true, true]);
  });

  test('editing an in-progress request keeps the submitted report of an unchanged test', async () => {
    const id = await createRequest(`${CBC}, ${LFT}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    const edit = await request(app).patch(`/api/lab/pathology/${id}`).set(auth(UserRole.PATHOLOGIST))
      .send({ priority: 'URGENT' });
    expect(edit.status).toBe(200);
    const res = await getDetail(id, UserRole.PATHOLOGIST);
    expect(res.body.data.priority).toBe('URGENT');
    expect(res.body.data.testReports[0].result.values[0].value).toBe('14');
  });

  test('list responses are unchanged (no testReports on list rows)', async () => {
    const id = await createRequest(CBC);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    const res = await request(app).get('/api/lab/pathology').set(auth(UserRole.PATHOLOGIST));
    expect(res.status).toBe(200);
    expect(res.body.data.data[0].requestId).toBe(id);
    expect(res.body.data.data[0].testReports).toBeUndefined();
  });
});

// ─── Second catalog batch (40 tests in total) ─────────────────────────────────

describe('Additional catalog tests — same structured workflow', () => {
  const NEW_TESTS: Array<[string, string]> = [
    ['Peripheral Blood Smear (PBS)', 'PBS'],
    ['Reticulocyte Count', 'RETIC'],
    ['Iron Profile / Iron Studies', 'IRON_PROFILE'],
    ['Serum Ferritin', 'FERRITIN'],
    ['Serum Calcium', 'CALCIUM'],
    ['Serum Magnesium', 'MAGNESIUM'],
    ['Serum Phosphorus', 'PHOSPHORUS'],
    ['Serum Amylase', 'AMYLASE'],
    ['Serum Lipase', 'LIPASE'],
    ['Total & Direct Bilirubin', 'BILIRUBIN'],
    ['Alkaline Phosphatase (ALP)', 'ALP'],
    ['Procalcitonin (PCT)', 'PCT'],
    ['HBsAg (Hepatitis B Surface Antigen)', 'HBSAG'],
    ['Anti-HCV (Hepatitis C Antibody)', 'ANTI_HCV'],
    ['HIV 1 & 2 Screening', 'HIV'],
    ['Widal Test', 'WIDAL'],
    ['Typhoid IgM', 'TYPHOID_IGM'],
    ['Pregnancy Test (Urine β-hCG)', 'PREGNANCY'],
    ['Stool Routine & Microscopy', 'STOOL_RM'],
    ['Stool Occult Blood Test (FOBT)', 'FOBT'],
  ];
  const WIDAL = 'Widal Test';
  const HBSAG = 'HBsAg (Hepatitis B Surface Antigen)';
  const PREG  = 'Pregnancy Test (Urine β-hCG)';
  const IRON  = 'Iron Profile / Iron Studies';

  test('each of the 20 new test names is stored exactly and opens its own dedicated form', async () => {
    for (const [name, key] of NEW_TESTS) {
      const id = await createRequest(name);
      const res = await getDetail(id, UserRole.PATHOLOGIST);
      expect(res.body.data.testType).toBe(name);
      expect(res.body.data.testReports).toEqual([expect.objectContaining({ testIndex: 0, testName: name, templateKey: key })]);
      expect(res.body.data.testReports[0].fields.length).toBeGreaterThan(0);
    }
  });

  test('a multi-test request of new tests: optional fields, validation, independent storage, completion', async () => {
    const id = await createRequest(`${WIDAL}, ${HBSAG}, ${PREG}, ${IRON}`);
    await markPaid(id);

    // Select options are validated against the template.
    expect((await submit(id, 0, { testName: WIDAL, values: { typhiO: '1:999' } })).status).toBe(400);

    await submit(id, 0, { testName: WIDAL, values: { typhiO: '1:160', typhiH: '1:80' } }).expect(200);
    await submit(id, 1, { testName: HBSAG, values: { hbsag: 'Non-Reactive' } }).expect(200);
    await submit(id, 2, { testName: PREG,  values: { urineHcg: 'Positive' } }).expect(200);
    const res = await submit(id, 3, { testName: IRON, values: { serumIron: '40', tibc: '420' } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');

    const byName = Object.fromEntries(res.body.data.testReports.map((r: { testName: string; result: { values: Array<{ key: string; value: string; flag: string | null; referenceRange: string | null }> } }) =>
      [r.testName, r.result.values.map((v) => [v.key, v.value, v.flag, v.referenceRange])]));
    expect(byName[WIDAL]).toEqual([['typhiO', '1:160', 'ABNORMAL', '< 1:80'], ['typhiH', '1:80', null, '< 1:160']]);
    expect(byName[HBSAG]).toEqual([['hbsag', 'Non-Reactive', null, 'Non-Reactive']]);
    expect(byName[PREG]).toEqual([['urineHcg', 'Positive', null, 'Negative']]);
    // PAT-001 is MALE → male serum-iron range.
    expect(byName[IRON]).toEqual([['serumIron', '40', 'LOW', '65 - 175'], ['tibc', '420', null, '250 - 450']]);

    const raw = await mongoose.connection.collection('pathology_requests').findOne({ requestId: id });
    expect(raw!.testReports.map((r: { testName: string }) => r.testName)).toEqual([WIDAL, HBSAG, PREG, IRON]);
    expect(raw!.testReports.every((r: { resultData: string }) => r.resultData.startsWith('enc:v1:'))).toBe(true);
  });

  test('the doctor sees the new tests\' results and each gets its own PDF with only its parameters', async () => {
    const id = await createRequest(`${HBSAG}, ${PREG}`);
    await markPaid(id);
    await submit(id, 0, { testName: HBSAG, values: { hbsag: 'Reactive' } }).expect(200);
    await submit(id, 1, { testName: PREG,  values: { urineHcg: 'Negative' } }).expect(200);

    const view = await getDetail(id, UserRole.DOCTOR);
    expect(view.status).toBe(200);
    expect(view.body.data.testReports.map((r: { testName: string; result: { values: Array<{ value: string; flag: string | null }> } }) =>
      [r.testName, r.result.values[0].value, r.result.values[0].flag]))
      .toEqual([[HBSAG, 'Reactive', 'ABNORMAL'], [PREG, 'Negative', null]]);

    const hbsagPdf = await getPdf(id, 0);
    expect(hbsagPdf.status).toBe(200);
    const hbsagText = pdfText(hbsagPdf.body as Buffer);
    expect(hbsagText).toContain(HBSAG);
    expect(hbsagText).toContain('Reactive');
    expect(hbsagText).not.toContain('Urine hCG (Qualitative)');

    const pregPdf = await getPdf(id, 1);
    expect(pregPdf.status).toBe(200);
    expect(pregPdf.headers['content-disposition']).toContain('pathology-report-Pregnancy-Test-Urine-hCG-PAT-001.pdf');
    const pregText = pdfText(pregPdf.body as Buffer);
    // β is drawn from the Symbol font between the two Helvetica runs.
    expect(pregText).toContain('Pregnancy Test (Urine ');
    expect(pregText).toContain('-hCG)');
    expect((pregPdf.body as Buffer).toString('latin1')).toMatch(/\/BaseFont \/Symbol/);
    expect(pregText).toContain('Urine hCG (Qualitative)');
    expect(pregText).not.toContain(HBSAG);
  });
});

// ─── Editing Test Type (Edit Pathology Request multi-select) ──────────────────

describe('PATCH /api/lab/pathology/:requestId — editing Test Type', () => {
  const THYROID = 'Thyroid Profile (T3, T4, TSH)';
  const PREG    = 'Pregnancy Test (Urine β-hCG)';
  const edit = (id: string, body: Record<string, unknown>, role: string = UserRole.PATHOLOGIST) =>
    request(app).patch(`/api/lab/pathology/${id}`).set(auth(role)).send(body);

  test('adding/removing tests stores the exact multi-test string and the report forms follow it', async () => {
    const id = await createRequest(`${CBC}, ${THYROID}`);
    const res = await edit(id, { testType: `${THYROID}, ${LFT}, ${PREG}` });
    expect(res.status).toBe(200);
    expect(res.body.data.testType).toBe(`${THYROID}, ${LFT}, ${PREG}`);

    const detail = await getDetail(id, UserRole.PATHOLOGIST);
    expect(detail.body.data.testReports.map((r: { testIndex: number; testName: string; templateKey: string }) =>
      [r.testIndex, r.testName, r.templateKey]))
      .toEqual([[0, THYROID, 'THYROID'], [1, LFT, 'LFT'], [2, PREG, 'PREGNANCY']]);
  });

  test('a test kept through the edit keeps its submitted report; a removed test\'s report is no longer shown', async () => {
    const id = await createRequest(`${CBC}, ${THYROID}`);
    await markPaid(id);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    await submit(id, 1, { testName: THYROID, values: { tsh: '2.1' } }).expect(200);
    // Both submitted → COMPLETED (not editable); reopen to IN_PROGRESS for the edit.
    await PathologyRequestModel.updateOne({ requestId: id }, { status: 'IN_PROGRESS' });

    await edit(id, { testType: `${THYROID}, ${LFT}` }).expect(200);
    const detail = await getDetail(id, UserRole.PATHOLOGIST);
    const [thyroid, lft] = detail.body.data.testReports;
    expect(thyroid).toEqual(expect.objectContaining({ testIndex: 0, testName: THYROID }));
    expect(thyroid.result.values[0]).toEqual(expect.objectContaining({ key: 'tsh', value: '2.1' }));
    expect(lft).toEqual(expect.objectContaining({ testIndex: 1, testName: LFT, result: null }));
    expect(detail.body.data.testReports.map((r: { testName: string }) => r.testName)).not.toContain(CBC);
  });

  test('rejects an over-long selection (same 200-character limit as create) and leaves the request unchanged', async () => {
    const id = await createRequest(CBC);
    const tooLong = [CBC, THYROID, LFT, KFT, PREG, 'Serum Electrolytes (Sodium, Potassium, Chloride)'].join(', ');
    expect(tooLong.length).toBeGreaterThan(200);
    expect((await edit(id, { testType: tooLong })).status).toBe(400);
    expect((await getDetail(id, UserRole.PATHOLOGIST)).body.data.testType).toBe(CBC);
  });

  test('existing edit permissions are unchanged (Nurse / Receptionist cannot edit; Doctor, Manager can)', async () => {
    const id = await createRequest(CBC);
    expect((await edit(id, { testType: LFT }, UserRole.NURSE)).status).toBe(403);
    expect((await edit(id, { testType: LFT }, UserRole.RECEPTIONIST)).status).toBe(403);
    expect((await edit(id, { testType: LFT }, UserRole.DOCTOR)).status).toBe(200);
    expect((await edit(id, { testType: `${LFT}, ${KFT}` }, UserRole.MANAGER)).status).toBe(200);
  });
});
