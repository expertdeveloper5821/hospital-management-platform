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
import { PaymentModel }     from '../../../src/modules/payment/payment.model';
import { PathologyTestMasterModel } from '../../../src/modules/lab/pathology-test-master.model';
import { PATHOLOGY_REPORT_TEMPLATES } from '../../../src/modules/lab/pathology-report-templates';
import { auditService }     from '../../../src/shared/services/audit.service';
import { TenantStatus, UserRole, AuditEntityType } from '../../../src/shared/types/common.types';

const JWT_SECRET = process.env.JWT_SECRET!;

const CBC   = 'CBC (Complete Blood Count)';
const HBSAG = 'HBsAg (Hepatitis B Surface Antigen)';
const HCV   = 'Anti-HCV (Hepatitis C Antibody)';
const HIV   = 'HIV 1 & 2 Screening';

let mongod: MongoMemoryServer;
let tenantId: string;
let doctorId: string;
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
  doctorId = await mkUser(UserRole.DOCTOR, 'Lab Doctor');
  await mkUser(UserRole.PATHOLOGIST, 'Lab Pathologist');
  await mkUser(UserRole.RADIOLOGIST, 'Lab Radiologist');
  await mkUser(UserRole.HOSPITAL_ADMIN, 'Lab Admin');
  await mkUser(UserRole.NURSE, 'Lab Nurse');
  await mkUser(UserRole.RECEPTIONIST, 'Receptionist');
  await mkUser(UserRole.MANAGER, 'Manager');

  await PatientModel.create({
    patientId: 'PAT-001', tenantId, fullName: 'John Doe',
    dateOfBirth: new Date('1980-01-01'), gender: 'MALE',
    mobileNumber: '1234567890', address: '123 Test Street',
  });
});

const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

const listMaster = (role: string = UserRole.PATHOLOGIST) =>
  request(app).get('/api/lab/pathology/test-master').set(auth(role));

const patchMaster = (key: string, body: Record<string, unknown>, role: string = UserRole.PATHOLOGIST) =>
  request(app).patch(`/api/lab/pathology/test-master/${key}`).set(auth(role)).send(body);

async function createPaidRequest(testType: string): Promise<string> {
  const res = await request(app).post('/api/lab/pathology').set(auth(UserRole.HOSPITAL_ADMIN))
    .send({ patientId: 'PAT-001', testType, referredBy: doctorId });
  expect(res.status).toBe(201);
  const requestId = res.body.data.requestId as string;
  await PaymentModel.create({
    paymentId: `PAY-${uuidv4()}`, tenantId, patientId: 'PAT-001',
    amount: 100, paymentMethod: 'CASH', description: 'Lab payment', status: 'COMPLETED',
    referenceType: 'PATHOLOGY_REQUEST', referenceId: requestId, createdBy: 'test',
  });
  return requestId;
}

function submit(requestId: string, testIndex: number, body: Record<string, unknown>) {
  return request(app).put(`/api/lab/pathology/${requestId}/reports/${testIndex}`)
    .set(auth(UserRole.PATHOLOGIST)).send(body);
}

function binary(req: request.Test) {
  return req.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });
}
const getPdf = (requestId: string, testIndex: number) =>
  binary(request(app).get(`/api/lab/pathology/${requestId}/reports/${testIndex}/pdf`).set(auth(UserRole.DOCTOR)));
const getAllPdf = (requestId: string) =>
  binary(request(app).get(`/api/lab/pathology/${requestId}/reports/pdf`).set(auth(UserRole.DOCTOR)));

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
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

// ─── Test Master CRUD ─────────────────────────────────────────────────────────

describe('GET /api/lab/pathology/test-master', () => {
  test('seeds one row per catalog test (plus Other / Unlisted) on first read, in catalog order', async () => {
    const res = await listMaster();
    expect(res.status).toBe(200);
    const rows = res.body.data as Array<Record<string, string | null>>;
    expect(rows.map((r) => r.templateKey)).toEqual([...PATHOLOGY_REPORT_TEMPLATES.map((t) => t.key), 'GENERIC']);
    expect(rows.map((r) => r.testName).slice(0, -1)).toEqual(PATHOLOGY_REPORT_TEMPLATES.map((t) => t.testName));
    // Every catalog test has a clinical note and the report footer.
    expect(rows.slice(0, -1).every((r) => !!r.clinicalNote)).toBe(true);
    expect(rows.every((r) => !!r.correlateClinically)).toBe(true);
    // Comments only where a test-specific comment is needed.
    expect(rows.filter((r) => r.comment).map((r) => r.templateKey).sort()).toEqual(['ANTI_HCV', 'HBSAG', 'HIV', 'VDRL']);
    expect(await PathologyTestMasterModel.countDocuments({ tenantId })).toBe(rows.length);
  });

  test('re-reading never duplicates or overwrites saved rows', async () => {
    await listMaster();
    await patchMaster('CBC', { clinicalNote: 'Edited CBC note' }).expect(200);
    const res = await listMaster(UserRole.HOSPITAL_ADMIN);
    expect(res.status).toBe(200);
    expect(await PathologyTestMasterModel.countDocuments({ tenantId })).toBe(res.body.data.length);
    expect(res.body.data.find((r: { templateKey: string }) => r.templateKey === 'CBC').clinicalNote).toBe('Edited CBC note');
  });

  test.each([UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.MANAGER, UserRole.RADIOLOGIST])(
    '%s cannot read or edit the Test Master (403)', async (role) => {
      expect((await listMaster(role)).status).toBe(403);
      expect((await patchMaster('CBC', { clinicalNote: 'x' }, role)).status).toBe(403);
    },
  );
});

describe('PATCH /api/lab/pathology/test-master/:templateKey', () => {
  test('updates only the sent fields, records the editor, and audits the change', async () => {
    const res = await patchMaster('HBSAG', { comment: 'Updated HBsAg comment' }, UserRole.HOSPITAL_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({
      templateKey: 'HBSAG', testName: HBSAG, comment: 'Updated HBsAg comment', updatedByName: 'Lab Admin',
    }));
    expect(res.body.data.clinicalNote).toMatch(/HBsAg/);   // untouched
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType: AuditEntityType.PATHOLOGY_TEST_MASTER, entityId: 'HBSAG', action: 'UPDATE', tenantId,
      newValue: expect.objectContaining({ comment: 'Updated HBsAg comment' }),
    }));
  });

  test('an empty clinical note / comment clears it; the footer text cannot be cleared', async () => {
    const res = await patchMaster('HIV', { clinicalNote: '   ', comment: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.clinicalNote).toBeNull();
    expect(res.body.data.comment).toBeNull();
    expect((await patchMaster('HIV', { correlateClinically: '  ' })).status).toBe(400);
  });

  test('rejects an unknown test, a malformed key, an empty body and unknown fields', async () => {
    expect((await patchMaster('NOT_A_TEST', { clinicalNote: 'x' })).status).toBe(404);
    expect((await patchMaster('bad-key', { clinicalNote: 'x' })).status).toBe(400);
    expect((await patchMaster('CBC', {})).status).toBe(400);
    expect((await patchMaster('CBC', { remarks: 'x' })).status).toBe(400);
    expect((await patchMaster('CBC', { clinicalNote: 'x'.repeat(2001) })).status).toBe(400);
  });

  test('is tenant-scoped — another tenant\'s rows are unaffected', async () => {
    await listMaster();
    const otherTenant = 'other-tenant';
    await PathologyTestMasterModel.create({
      tenantId: otherTenant, templateKey: 'CBC', testName: CBC, clinicalNote: 'Other tenant note', correlateClinically: 'x',
    });
    await patchMaster('CBC', { clinicalNote: 'Mine' }).expect(200);
    expect((await PathologyTestMasterModel.findOne({ tenantId: otherTenant, templateKey: 'CBC' }))!.clinicalNote)
      .toBe('Other tenant note');
  });
});

// ─── Test Master → report → PDF ───────────────────────────────────────────────

describe('Report generation uses the saved Test Master content', () => {
  test('request details carry each test\'s clinical content', async () => {
    const id = await createPaidRequest(`${CBC}, ${HBSAG}`);
    await patchMaster('CBC', { clinicalNote: 'CBC note v2' }).expect(200);
    const res = await request(app).get(`/api/lab/pathology/${id}`).set(auth(UserRole.DOCTOR));
    expect(res.status).toBe(200);
    const [cbc, hbsag] = res.body.data.testReports;
    expect(cbc.clinicalContent).toEqual(expect.objectContaining({ clinicalNote: 'CBC note v2', comment: null }));
    expect(hbsag.clinicalContent.comment).toMatch(/screening test/);
    expect(cbc.clinicalContent.correlateClinically).toBeTruthy();
  });

  test('a test PDF prints its Clinical Notes and the footer — and no Remarks, even for a stored remark', async () => {
    const id = await createPaidRequest(CBC);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '10.5' }, remarks: 'Legacy remark' }).expect(200);
    await patchMaster('CBC', { clinicalNote: 'CBC master note', correlateClinically: 'Correlate footer text' }).expect(200);

    const res = await getPdf(id, 0);
    expect(res.status).toBe(200);
    const text = pdfText(res.body as Buffer);
    expect(text).toContain('Clinical Notes');
    expect(text).toContain('CBC master note');
    expect(text).toContain('Please Correlate Clinically');
    expect(text).toContain('Correlate footer text');
    expect(text).not.toContain('Comment');          // CBC has no comment configured
    expect(text).not.toContain('Remarks');
    expect(text).not.toContain('Legacy remark');
  });

  test('editing the master changes the next generated PDF without resubmitting results', async () => {
    const id = await createPaidRequest(HBSAG);
    await submit(id, 0, { testName: HBSAG, values: { hbsag: 'Non-Reactive' } }).expect(200);
    const before = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(before).toContain('Comment');

    await patchMaster('HBSAG', { comment: null, clinicalNote: 'New HBsAg note' }).expect(200);
    const after = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(after).toContain('New HBsAg note');
    expect(after).not.toContain('Comment');
  });

  test('bulk PDF: each test carries its own note/comment once; the footer closes every report', async () => {
    const id = await createPaidRequest(`${CBC}, ${HBSAG}, ${HCV}, ${HIV}`);
    await patchMaster('CBC',      { clinicalNote: 'NOTE-CBC' }).expect(200);
    await patchMaster('HBSAG',    { comment: 'COMMENT-HBSAG' }).expect(200);
    await patchMaster('ANTI_HCV', { comment: 'COMMENT-HCV' }).expect(200);
    await patchMaster('HIV',      { comment: 'COMMENT-HIV' }).expect(200);
    await submit(id, 0, { testName: CBC,   values: { hemoglobin: '14' } }).expect(200);
    await submit(id, 1, { testName: HBSAG, values: { hbsag: 'Non-Reactive' } }).expect(200);
    await submit(id, 2, { testName: HCV,   values: { antiHcv: 'Non-Reactive' } }).expect(200);
    await submit(id, 3, { testName: HIV,   values: { hiv: 'Non-Reactive' } }).expect(200);

    const res = await getAllPdf(id);
    expect(res.status).toBe(200);
    const text = pdfText(res.body as Buffer);
    for (const marker of ['NOTE-CBC', 'COMMENT-HBSAG', 'COMMENT-HCV', 'COMMENT-HIV']) {
      expect({ marker, n: occurrences(text, marker) }).toEqual({ marker, n: 1 });
    }
    expect(occurrences(text, 'Please Correlate Clinically')).toBe(4);
    // Each comment follows its own test's results.
    expect(text.indexOf('COMMENT-HBSAG')).toBeLessThan(text.indexOf('Anti-HCV Antibody'));
    expect(text.indexOf('COMMENT-HCV')).toBeLessThan(text.indexOf('HIV 1 & 2 Antibodies'));
  });

  test('a free-text test (outside the catalog) prints the Other / Unlisted footer and no notes', async () => {
    const id = await createPaidRequest('Blood Culture');
    await submit(id, 0, { testName: 'Blood Culture', values: { result: 'No growth' } }).expect(200);
    await patchMaster('GENERIC', { correlateClinically: 'Generic footer' }).expect(200);
    const text = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(text).toContain('Generic footer');
    expect(text).not.toContain('Clinical Notes');
  });
});

// ─── Clinical Notes / Comment edited during result entry ─────────────────────

describe('Clinical Notes / Comment saved with a submitted report', () => {
  test('the entered text is saved with the report, prints on its PDF, and leaves the Test Master unchanged', async () => {
    const id = await createPaidRequest(CBC);
    const res = await submit(id, 0, {
      testName: CBC, values: { hemoglobin: '10.5' },
      clinicalNote: 'Report-specific note', comment: 'Report-specific comment',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.testReports[0].result).toEqual(expect.objectContaining({
      clinicalNote: 'Report-specific note', comment: 'Report-specific comment',
    }));

    const text = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(text).toContain('Report-specific note');
    expect(text).toContain('Comment');
    expect(text).toContain('Report-specific comment');

    const master = (await listMaster()).body.data.find((r: { templateKey: string }) => r.templateKey === 'CBC');
    expect(master.clinicalNote).not.toBe('Report-specific note');
    expect(master.comment).toBeNull();
    // Stored encrypted (inside resultData), never in plaintext.
    const raw = await mongoose.connection.collection('pathology_requests').findOne({ requestId: id });
    expect(JSON.stringify(raw)).not.toContain('Report-specific');
  });

  test('a later Test Master edit does not change a report that saved its own text', async () => {
    const id = await createPaidRequest(CBC);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' }, clinicalNote: 'Saved with report', comment: null }).expect(200);
    await patchMaster('CBC', { clinicalNote: 'Master edited later', comment: 'Master comment later' }).expect(200);

    const text = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(text).toContain('Saved with report');
    expect(text).not.toContain('Master edited later');
    expect(text).not.toContain('Comment');
  });

  test('reopening the report returns the saved text; an amendment can change or clear it', async () => {
    const id = await createPaidRequest(HBSAG);
    await submit(id, 0, { testName: HBSAG, values: { hbsag: 'Non-Reactive' }, clinicalNote: 'Note v1', comment: 'Comment v1' }).expect(200);

    const reopened = await request(app).get(`/api/lab/pathology/${id}`).set(auth(UserRole.PATHOLOGIST));
    expect(reopened.body.data.testReports[0].result).toEqual(expect.objectContaining({ clinicalNote: 'Note v1', comment: 'Comment v1' }));

    await submit(id, 0, { testName: HBSAG, values: { hbsag: 'Non-Reactive' }, clinicalNote: 'Note v2', comment: '' }).expect(200);
    const amended = await request(app).get(`/api/lab/pathology/${id}`).set(auth(UserRole.PATHOLOGIST));
    expect(amended.body.data.testReports[0].result).toEqual(expect.objectContaining({ clinicalNote: 'Note v2', comment: null }));
    const text = pdfText((await getPdf(id, 0)).body as Buffer);
    expect(text).toContain('Note v2');
    expect(text).not.toContain('Comment');
  });

  test('rejects over-long text', async () => {
    const id = await createPaidRequest(CBC);
    expect((await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' }, clinicalNote: 'x'.repeat(2001) })).status).toBe(400);
    expect((await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' }, comment: 'x'.repeat(2001) })).status).toBe(400);
  });
});

// ─── Enable / Disable tests ──────────────────────────────────────────────────

describe('Test Master — enable / disable tests', () => {
  const ESR = 'ESR';

  const listDisabled = (role: string = UserRole.DOCTOR) =>
    request(app).get('/api/lab/pathology/disabled-tests').set(auth(role));
  const createRequest = (testType: string, role: string = UserRole.HOSPITAL_ADMIN) =>
    request(app).post('/api/lab/pathology').set(auth(role)).send({ patientId: 'PAT-001', testType, referredBy: doctorId });
  const editRequest = (requestId: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/lab/pathology/${requestId}`).set(auth(UserRole.HOSPITAL_ADMIN)).send(body);

  test('every test is enabled by default', async () => {
    const res = await listMaster();
    expect(res.body.data.every((r: { isEnabled: boolean }) => r.isEnabled === true)).toBe(true);
    expect((await listDisabled()).body.data).toEqual([]);
  });

  test('a row saved before the flag existed reads as enabled', async () => {
    await mongoose.connection.collection('pathology_test_masters').insertOne({
      tenantId, templateKey: 'CBC', testName: CBC, clinicalNote: 'Legacy', comment: null,
      correlateClinically: 'x', updatedBy: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const cbc = (await listMaster()).body.data.find((r: { templateKey: string }) => r.templateKey === 'CBC');
    expect(cbc).toEqual(expect.objectContaining({ clinicalNote: 'Legacy', isEnabled: true }));
    expect((await listDisabled()).body.data).toEqual([]);
    expect((await createRequest(CBC)).status).toBe(201);
  });

  test('disabling hides the test and blocks it on new requests; re-enabling restores it', async () => {
    const res = await patchMaster('CBC', { isEnabled: false }, UserRole.HOSPITAL_ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(expect.objectContaining({ templateKey: 'CBC', isEnabled: false, updatedByName: 'Lab Admin' }));
    // Other content is untouched.
    expect(res.body.data.clinicalNote).toMatch(/Complete Blood Count/);
    expect(auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType: AuditEntityType.PATHOLOGY_TEST_MASTER, entityId: 'CBC', action: 'UPDATE', tenantId,
      previousValue: { isEnabled: true }, newValue: expect.objectContaining({ isEnabled: false }),
    }));

    expect((await listDisabled()).body.data).toEqual([CBC]);
    const blocked = await createRequest(CBC, UserRole.RECEPTIONIST);
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/CBC \(Complete Blood Count\) is disabled/);
    expect((await createRequest(`${ESR}, ${CBC}`)).status).toBe(400);
    expect((await createRequest(ESR)).status).toBe(201);

    await patchMaster('CBC', { isEnabled: true }).expect(200);
    expect((await listDisabled()).body.data).toEqual([]);
    expect((await createRequest(`${ESR}, ${CBC}`)).status).toBe(201);
  });

  test('existing requests, reports and PDFs are preserved; an edit may keep but not newly add a disabled test', async () => {
    const id = await createPaidRequest(`${CBC}, ${HBSAG}`);
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '14' } }).expect(200);
    await patchMaster('CBC', { isEnabled: false }).expect(200);
    await patchMaster('HIV', { isEnabled: false }).expect(200);

    const detail = await request(app).get(`/api/lab/pathology/${id}`).set(auth(UserRole.DOCTOR));
    expect(detail.status).toBe(200);
    expect(detail.body.data.testType).toBe(`${CBC}, ${HBSAG}`);
    expect(detail.body.data.testReports[0].result).not.toBeNull();
    expect((await getPdf(id, 0)).status).toBe(200);

    // Keeping the already-requested (now disabled) CBC is fine.
    expect((await editRequest(id, { testType: `${CBC}, ${HBSAG}, ${ESR}`, priority: 'URGENT' })).status).toBe(200);
    // Newly adding a disabled test is not.
    const res = await editRequest(id, { testType: `${CBC}, ${HBSAG}, ${HIV}` });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/HIV 1 & 2 Screening is disabled/);
    // The report can still be amended.
    await submit(id, 0, { testName: CBC, values: { hemoglobin: '13' } }).expect(200);
  });

  test('tests outside the catalog cannot be disabled and are always allowed', async () => {
    expect((await patchMaster('GENERIC', { isEnabled: false })).status).toBe(400);
    expect((await createRequest('Blood Culture')).status).toBe(201);
  });

  test('rejects a non-boolean isEnabled', async () => {
    expect((await patchMaster('CBC', { isEnabled: 'no' })).status).toBe(400);
  });

  test.each([UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.MANAGER, UserRole.RADIOLOGIST])(
    '%s cannot enable or disable a test (403)', async (role) => {
      expect((await patchMaster('CBC', { isEnabled: false }, role)).status).toBe(403);
      expect((await listDisabled()).body.data).toEqual([]);
    },
  );

  test.each([
    UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST, UserRole.MANAGER, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN,
  ])('%s can read the disabled tests', async (role) => {
    expect((await listDisabled(role)).status).toBe(200);
  });

  test('a Radiologist cannot read the disabled tests (403)', async () => {
    expect((await listDisabled(UserRole.RADIOLOGIST)).status).toBe(403);
  });

  test('is per hospital — another tenant\'s settings never apply', async () => {
    const otherTenant = 'other-tenant';
    await PathologyTestMasterModel.create({
      tenantId: otherTenant, templateKey: 'ESR', testName: ESR, correlateClinically: 'x', isEnabled: false,
    });
    await PathologyTestMasterModel.create({
      tenantId: otherTenant, templateKey: 'CBC', testName: CBC, correlateClinically: 'x',
    });
    expect((await listDisabled()).body.data).toEqual([]);
    expect((await createRequest(ESR)).status).toBe(201);

    await patchMaster('CBC', { isEnabled: false }).expect(200);
    expect((await PathologyTestMasterModel.findOne({ tenantId: otherTenant, templateKey: 'CBC' }))!.isEnabled).toBe(true);
  });

  test('Billing: a disabled test is not offered as a Lab Test type and cannot be charged', async () => {
    await createRequest(CBC).expect(201);
    await createRequest(ESR).expect(201);
    await patchMaster('CBC', { isEnabled: false }).expect(200);

    const types = await request(app).get('/api/lab/test-types').set(auth(UserRole.RECEPTIONIST));
    expect(types.status).toBe(200);
    const names = types.body.data.map((t: { name: string }) => t.name);
    expect(names).toContain(ESR);
    expect(names).not.toContain(CBC);

    const charge = await request(app).post('/api/charges').set(auth(UserRole.HOSPITAL_ADMIN)).send({
      patientId: 'PAT-001', category: 'LAB_TEST', description: 'CBC', amount: 100,
      testTypeId: `PATHOLOGY:${CBC}`, testTypeName: CBC,
    });
    expect(charge.status).toBe(400);
    expect(await mongoose.connection.collection('charges').countDocuments({ tenantId })).toBe(0);
  });
});
