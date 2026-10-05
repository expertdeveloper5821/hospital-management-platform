jest.mock('../../../src/modules/lab/lab.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/modules/notification/notification.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
// Lab responses carry the request's payment status (null = unpaid).
jest.mock('../../../src/modules/payment/payment.repository', () => ({
  paymentRepository: {
    findCompletedByReference:  jest.fn().mockResolvedValue(null),
    findCompletedByReferences: jest.fn().mockResolvedValue([]),
  },
}));
// The request's linked OPD visit / IPD admission (none by default).
jest.mock('../../../src/modules/opd/opd.repository', () => ({
  opdRepository: {
    findPatientVisitsOnDayAt: jest.fn().mockResolvedValue([]),
    findByVisitId:            jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../../../src/modules/ipd/ipd.repository', () => ({
  ipdRepository: {
    findAdmissionCoveringDate: jest.fn().mockResolvedValue(null),
    findById:                  jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../../../src/modules/department/department.repository', () => ({
  departmentRepository: { findById: jest.fn().mockResolvedValue(null) },
}));
import { auditService } from '../../../src/shared/services/audit.service';
import { opdRepository }        from '../../../src/modules/opd/opd.repository';
import { ipdRepository }        from '../../../src/modules/ipd/ipd.repository';
import { departmentRepository } from '../../../src/modules/department/department.repository';
import { userRepository }       from '../../../src/modules/user/user.repository';
import { paymentRepository } from '../../../src/modules/payment/payment.repository';

import { labRepository }        from '../../../src/modules/lab/lab.repository';
import { patientRepository }    from '../../../src/modules/patient/patient.repository';
import { notificationService }  from '../../../src/modules/notification/notification.service';
import { s3Service }            from '../../../src/shared/services/s3.service';
import { LabService }           from '../../../src/modules/lab/lab.service';
import { LabRequestStatus, PATHOLOGY_REPORT_MAX_BYTES, RADIOLOGY_REPORT_MAX_BYTES } from '../../../src/modules/lab/lab.types';
import { IPathologyRequest, IRadiologyRequest } from '../../../src/modules/lab/lab.model';
import { UserRole } from '../../../src/shared/types/common.types';

const mockLabRepo       = labRepository       as jest.Mocked<typeof labRepository>;
const mockPatientRepo   = patientRepository   as jest.Mocked<typeof patientRepository>;
const mockNotifSvc      = notificationService as jest.Mocked<typeof notificationService>;
const mockS3            = s3Service           as jest.Mocked<typeof s3Service>;
const mockPaymentRepo   = paymentRepository   as jest.Mocked<typeof paymentRepository>;

// A COMPLETED payment for the request — report upload is gated on it.
const PAID = { paymentId: 'PAY-001', amount: 100, paymentMethod: 'CASH', createdAt: new Date(), receiptS3Key: null };

const TENANT = 'tenant-001';
const DOCTOR = 'doctor-001';

function makePathologyDoc(overrides: Partial<IPathologyRequest> = {}): IPathologyRequest {
  return {
    requestId:   'req-path-001',
    patientId:   'patient-001',
    tenantId:    TENANT,
    requestedBy: DOCTOR,
    testType:    'Blood CBC',
    referredBy:  'SELF',
    status:      LabRequestStatus.PENDING,
    priority:    'NORMAL',
    notes:       null,
    reportS3Key: null,
    isDeleted:   false,
    deletedAt:   null,
    requestedAt: new Date(),
    createdAt:   new Date(),
    updatedAt:   new Date(),
    ...overrides,
  } as unknown as IPathologyRequest;
}

function makeRadiologyDoc(overrides: Partial<IRadiologyRequest> = {}): IRadiologyRequest {
  return {
    requestId:   'req-radio-001',
    patientId:   'patient-001',
    tenantId:    TENANT,
    requestedBy: DOCTOR,
    imagingType: 'X-Ray Chest',
    referredBy:  'SELF',
    status:      LabRequestStatus.PENDING,
    priority:    'NORMAL',
    notes:       null,
    reportS3Key: null,
    isDeleted:   false,
    deletedAt:   null,
    requestedAt: new Date(),
    createdAt:   new Date(),
    updatedAt:   new Date(),
    ...overrides,
  } as unknown as IRadiologyRequest;
}

describe('LabService — createPathologyRequest', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue({ patientId: 'patient-001' });
    mockNotifSvc.sendToRole         = jest.fn().mockResolvedValue(undefined);
  });

  test('creates a pathology request and returns PENDING status', async () => {
    const doc = makePathologyDoc();
    mockLabRepo.savePathology = jest.fn().mockResolvedValue(doc);

    const result = await service.createPathologyRequest(
      { patientId: 'patient-001', testType: 'Blood CBC', referredBy: 'SELF' },
      TENANT,
      DOCTOR,
    );

    expect(result.status).toBe(LabRequestStatus.PENDING);
    expect(result.reportUrl).toBeNull();
    expect(mockLabRepo.savePathology).toHaveBeenCalledTimes(1);
  });

  test('throws NotFoundError when patient does not exist', async () => {
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue(null);

    await expect(
      service.createPathologyRequest({ patientId: 'unknown', testType: 'CBC', referredBy: 'SELF' }, TENANT, DOCTOR),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('sends notification to pathologists on creation', async () => {
    mockLabRepo.savePathology = jest.fn().mockResolvedValue(makePathologyDoc());

    await service.createPathologyRequest(
      { patientId: 'patient-001', testType: 'Blood CBC', referredBy: 'SELF' },
      TENANT,
      DOCTOR,
    );

    expect(mockNotifSvc.sendToRole).toHaveBeenCalledWith(
      'PATHOLOGIST',
      TENANT,
      expect.any(String),
      expect.any(String),
      'PATHOLOGY_REQUEST',
      expect.any(String),
    );
  });
});

describe('LabService — uploadPathologyReport', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockS3.uploadFile             = jest.fn().mockResolvedValue('s3-key');
    mockS3.getPresignedUrl        = jest.fn().mockResolvedValue('https://s3.test/presigned');
    mockNotifSvc.sendNotification = jest.fn().mockResolvedValue(undefined);
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(PAID as never);
  });

  afterEach(() => {
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(null);
  });

  test('rejects upload with 409 while the request is unpaid, before touching S3', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology   = jest.fn();
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(null);

    await expect(
      service.uploadPathologyReport('req-path-001', TENANT, DOCTOR, Buffer.alloc(100), 'application/pdf'),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/payment must be collected/i) });

    expect(mockPaymentRepo.findCompletedByReference).toHaveBeenCalledWith(TENANT, 'PATHOLOGY_REQUEST', 'req-path-001');
    expect(mockS3.uploadFile).not.toHaveBeenCalled();
    expect(mockLabRepo.updatePathology).not.toHaveBeenCalled();
  });

  test('uploads once the request has been paid', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(makePathologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'key' }));

    const result = await service.uploadPathologyReport('req-path-001', TENANT, DOCTOR, Buffer.alloc(100), 'application/pdf');

    expect(mockPaymentRepo.findCompletedByReference).toHaveBeenCalledWith(TENANT, 'PATHOLOGY_REQUEST', 'req-path-001');
    expect(mockS3.uploadFile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(LabRequestStatus.COMPLETED);
    expect(result.reportUrl).toBe('https://s3.test/presigned');
  });

  test('rejects file exceeding 10 MB with descriptive error', async () => {
    const oversizedBuffer = Buffer.alloc(PATHOLOGY_REPORT_MAX_BYTES + 1);

    await expect(
      service.uploadPathologyReport('req-001', TENANT, DOCTOR, oversizedBuffer, 'application/pdf'),
    ).rejects.toMatchObject({
      statusCode: 413,
      message: expect.stringContaining('10 MB'),
    });

    expect(mockS3.uploadFile).not.toHaveBeenCalled();
  });

  test('accepts exactly 10 MB file', async () => {
    const exactBuffer = Buffer.alloc(PATHOLOGY_REPORT_MAX_BYTES);
    const pendingDoc  = makePathologyDoc();
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'some-key' });

    mockLabRepo.findPathologyById  = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.updatePathology    = jest.fn().mockResolvedValue(completedDoc);

    const result = await service.uploadPathologyReport(
      'req-path-001', TENANT, DOCTOR, exactBuffer, 'application/pdf',
    );

    expect(mockS3.uploadFile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(LabRequestStatus.COMPLETED);
  });

  test('rejects upload when request status is already COMPLETED', async () => {
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'old-key' });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(completedDoc);

    const buffer = Buffer.alloc(100);
    await expect(
      service.uploadPathologyReport('req-path-001', TENANT, DOCTOR, buffer, 'application/pdf'),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(mockS3.uploadFile).not.toHaveBeenCalled();
  });

  test('sets status to COMPLETED and includes reportUrl in response', async () => {
    const pendingDoc   = makePathologyDoc();
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'org/t/lab/pathology/req-path-001/report.pdf' });

    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(completedDoc);

    const result = await service.uploadPathologyReport(
      'req-path-001', TENANT, DOCTOR, Buffer.alloc(512), 'application/pdf',
    );

    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith(
      'req-path-001', TENANT,
      expect.objectContaining({ status: LabRequestStatus.COMPLETED }),
    );
    expect(result.reportUrl).toBe('https://s3.test/presigned');
  });

  test('sends notification to requesting doctor after upload', async () => {
    const pendingDoc   = makePathologyDoc();
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'key' });

    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(completedDoc);

    await service.uploadPathologyReport(
      'req-path-001', TENANT, DOCTOR, Buffer.alloc(100), 'application/pdf',
    );

    expect(mockNotifSvc.sendNotification).toHaveBeenCalledWith(
      DOCTOR,
      TENANT,
      expect.stringContaining('Ready'),
      expect.any(String),
      'PATHOLOGY_REQUEST',
      'req-path-001',
    );
  });
});

describe('LabService — uploadRadiologyReport', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockS3.uploadFile             = jest.fn().mockResolvedValue('s3-key');
    mockS3.getPresignedUrl        = jest.fn().mockResolvedValue('https://s3.test/presigned');
    mockNotifSvc.sendNotification = jest.fn().mockResolvedValue(undefined);
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(PAID as never);
  });

  afterEach(() => {
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(null);
  });

  test('rejects upload with 409 while the request is unpaid, before touching S3', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology   = jest.fn();
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(null);

    await expect(
      service.uploadRadiologyReport('req-radio-001', TENANT, DOCTOR, Buffer.alloc(100), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/payment must be collected/i) });

    expect(mockPaymentRepo.findCompletedByReference).toHaveBeenCalledWith(TENANT, 'RADIOLOGY_REQUEST', 'req-radio-001');
    expect(mockS3.uploadFile).not.toHaveBeenCalled();
    expect(mockLabRepo.updateRadiology).not.toHaveBeenCalled();
  });

  test('uploads once the request has been paid', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(makeRadiologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'key' }));

    const result = await service.uploadRadiologyReport('req-radio-001', TENANT, DOCTOR, Buffer.alloc(100), 'image/png');

    expect(mockPaymentRepo.findCompletedByReference).toHaveBeenCalledWith(TENANT, 'RADIOLOGY_REQUEST', 'req-radio-001');
    expect(mockS3.uploadFile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(LabRequestStatus.COMPLETED);
    expect(result.reportUrl).toBe('https://s3.test/presigned');
  });

  test('rejects file exceeding 20 MB with descriptive error', async () => {
    const oversizedBuffer = Buffer.alloc(RADIOLOGY_REPORT_MAX_BYTES + 1);

    await expect(
      service.uploadRadiologyReport('req-001', TENANT, DOCTOR, oversizedBuffer, 'image/dicom'),
    ).rejects.toMatchObject({
      statusCode: 413,
      message: expect.stringContaining('20 MB'),
    });

    expect(mockS3.uploadFile).not.toHaveBeenCalled();
  });

  test('accepts exactly 20 MB file', async () => {
    const exactBuffer  = Buffer.alloc(RADIOLOGY_REPORT_MAX_BYTES);
    const pendingDoc   = makeRadiologyDoc();
    const completedDoc = makeRadiologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'key' });

    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(completedDoc);

    const result = await service.uploadRadiologyReport(
      'req-radio-001', TENANT, DOCTOR, exactBuffer, 'image/dicom',
    );

    expect(mockS3.uploadFile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(LabRequestStatus.COMPLETED);
  });

  test('rejects upload when radiology request is already COMPLETED', async () => {
    const completedDoc = makeRadiologyDoc({ status: LabRequestStatus.COMPLETED, reportS3Key: 'key' });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(completedDoc);

    await expect(
      service.uploadRadiologyReport('req-radio-001', TENANT, DOCTOR, Buffer.alloc(100), 'image/png'),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ─── editPathologyRequest ─────────────────────────────────────────────────────

const mockAuditSvc = auditService as jest.Mocked<typeof auditService>;

describe('LabService — editPathologyRequest', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockS3.getPresignedUrl = jest.fn().mockResolvedValue(null);
    mockAuditSvc.log       = jest.fn().mockResolvedValue(undefined);
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue({ fullName: 'Test Patient' });
  });

  test('throws 404 when request does not exist', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(null);
    await expect(
      service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'New Test' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 409 when request is already COMPLETED', async () => {
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(completedDoc);
    await expect(
      service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'Updated' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(mockLabRepo.updatePathology).not.toHaveBeenCalled();
  });

  test('rejects a status change from a DOCTOR with 403', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology  = jest.fn();
    await expect(
      service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockLabRepo.updatePathology).not.toHaveBeenCalled();
  });

  test('rejects a status change from a RADIOLOGIST with 403', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology  = jest.fn();
    await expect(
      service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, UserRole.RADIOLOGIST),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('allows a DOCTOR to resend the unchanged status with other edits', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology  = jest.fn().mockResolvedValue(makePathologyDoc());
    await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { status: 'PENDING', priority: 'URGENT' }, undefined, UserRole.DOCTOR);
    expect(mockLabRepo.updatePathology).toHaveBeenCalled();
  });

  test.each([UserRole.HOSPITAL_ADMIN, UserRole.PATHOLOGIST])('allows %s to change status', async (role) => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc());
    mockLabRepo.updatePathology  = jest.fn().mockResolvedValue(makePathologyDoc({ status: LabRequestStatus.IN_PROGRESS }));
    const result = await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, role);
    expect(result.status).toBe(LabRequestStatus.IN_PROGRESS);
  });

  test('updates only fields present in input', async () => {
    const doc     = makePathologyDoc();
    const updated = makePathologyDoc({ testType: 'New CBC', priority: 'URGENT' });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(updated);

    await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'New CBC', priority: 'URGENT' });

    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith(
      'req-path-001', TENANT,
      expect.objectContaining({ testType: 'New CBC', priority: 'URGENT' }),
      undefined,
    );
    const callArgs = (mockLabRepo.updatePathology as jest.Mock).mock.calls[0][2];
    expect(callArgs).not.toHaveProperty('notes');
    expect(callArgs).not.toHaveProperty('status');
  });

  test('accepts status change from PENDING to IN_PROGRESS', async () => {
    const doc     = makePathologyDoc();
    const updated = makePathologyDoc({ status: LabRequestStatus.IN_PROGRESS });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(updated);

    const result = await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' });
    expect(result.status).toBe(LabRequestStatus.IN_PROGRESS);
  });

  test('writes UPDATE audit log on success', async () => {
    const doc     = makePathologyDoc();
    const updated = makePathologyDoc({ notes: 'Updated notes' });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(updated);

    await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { notes: 'Updated notes' });

    expect(mockAuditSvc.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityId: 'req-path-001' }),
    );
  });

  test('redacts notes in the audit log — value never reaches the trail', async () => {
    const doc     = makePathologyDoc({ notes: 'Old confidential note' });
    const updated = makePathologyDoc({ notes: 'New confidential note' });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(updated);

    await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { notes: 'New confidential note' });

    // Plaintext still reaches the repository (encrypted-at-rest column).
    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith(
      'req-path-001', TENANT,
      expect.objectContaining({ notes: 'New confidential note' }),
      undefined,
    );

    const [entry] = mockAuditSvc.log.mock.calls[0] as [{ previousValue: Record<string, unknown>; newValue: Record<string, unknown> }];
    expect(entry.previousValue.notes).toBe('[redacted]');
    expect(entry.newValue.notes).toBe('[redacted]');
    expect(JSON.stringify(entry)).not.toContain('confidential note');
  });

  describe('status recalculation after a test-type edit', () => {
    const report = (testName: string) => ({
      testName, templateKey: 'generic', resultData: '{}', submittedBy: 'path-1', submittedAt: new Date(),
    });

    test('completes an IN_PROGRESS request when the removed test was the only unreported one', async () => {
      const doc     = makePathologyDoc({
        status: LabRequestStatus.IN_PROGRESS, testType: 'CBC, LFT', testReports: [report('CBC')],
      } as Partial<IPathologyRequest>);
      const edited  = { ...doc, testType: 'CBC' } as IPathologyRequest;
      const completed = { ...edited, status: LabRequestStatus.COMPLETED } as IPathologyRequest;
      mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
      mockLabRepo.updatePathology   = jest.fn().mockResolvedValueOnce(edited).mockResolvedValueOnce(completed);

      const result = await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'CBC' });

      expect(result.status).toBe(LabRequestStatus.COMPLETED);
      expect(mockLabRepo.updatePathology).toHaveBeenNthCalledWith(
        2, 'req-path-001', TENANT, { status: LabRequestStatus.COMPLETED }, undefined,
      );
      const [entry] = mockAuditSvc.log.mock.calls[0] as [{ previousValue: Record<string, unknown>; newValue: Record<string, unknown> }];
      expect(entry.previousValue.status).toBe(LabRequestStatus.IN_PROGRESS);
      expect(entry.newValue.status).toBe(LabRequestStatus.COMPLETED);
    });

    test('stays IN_PROGRESS while a remaining test is still unreported', async () => {
      const doc    = makePathologyDoc({
        status: LabRequestStatus.IN_PROGRESS, testType: 'CBC, LFT, KFT', testReports: [report('CBC')],
      } as Partial<IPathologyRequest>);
      const edited = { ...doc, testType: 'CBC, LFT' } as IPathologyRequest;
      mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
      mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(edited);

      const result = await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'CBC, LFT' });

      expect(result.status).toBe(LabRequestStatus.IN_PROGRESS);
      expect(mockLabRepo.updatePathology).toHaveBeenCalledTimes(1);
    });

    test('does not recalculate a PENDING request', async () => {
      const doc    = makePathologyDoc({ testType: 'CBC, LFT' });
      const edited = { ...doc, testType: 'CBC' } as IPathologyRequest;
      mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
      mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(edited);

      const result = await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'CBC' });

      expect(result.status).toBe(LabRequestStatus.PENDING);
      expect(mockLabRepo.updatePathology).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── deletePathologyRequest ───────────────────────────────────────────────────

describe('LabService — deletePathologyRequest', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockAuditSvc.log = jest.fn().mockResolvedValue(undefined);
  });

  test('throws 404 when request does not exist', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(null);
    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 403 when DOCTOR tries to delete a COMPLETED request', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ status: LabRequestStatus.COMPLETED }));
    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockLabRepo.softDeletePathology).not.toHaveBeenCalled();
  });

  test('throws 403 when PATHOLOGIST tries to delete a COMPLETED request', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ status: LabRequestStatus.COMPLETED }));
    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, 'pathologist-001', UserRole.PATHOLOGIST),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('allows HOSPITAL_ADMIN to delete a COMPLETED request', async () => {
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED });
    mockLabRepo.findPathologyById   = jest.fn().mockResolvedValue(completedDoc);
    mockLabRepo.softDeletePathology = jest.fn().mockResolvedValue({ ...completedDoc, isDeleted: true });

    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, 'admin-001', UserRole.HOSPITAL_ADMIN),
    ).resolves.toBeUndefined();
    expect(mockLabRepo.softDeletePathology).toHaveBeenCalledTimes(1);
  });

  test('allows MANAGER to delete a COMPLETED request', async () => {
    const completedDoc = makePathologyDoc({ status: LabRequestStatus.COMPLETED });
    mockLabRepo.findPathologyById   = jest.fn().mockResolvedValue(completedDoc);
    mockLabRepo.softDeletePathology = jest.fn().mockResolvedValue({ ...completedDoc, isDeleted: true });

    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, 'manager-001', UserRole.MANAGER),
    ).resolves.toBeUndefined();
  });

  test('allows DOCTOR to delete a PENDING request', async () => {
    const pendingDoc = makePathologyDoc();
    mockLabRepo.findPathologyById   = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.softDeletePathology = jest.fn().mockResolvedValue({ ...pendingDoc, isDeleted: true });

    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).resolves.toBeUndefined();
    expect(mockLabRepo.softDeletePathology).toHaveBeenCalledTimes(1);
  });

  test('allows PATHOLOGIST to delete a PENDING request', async () => {
    const pendingDoc = makePathologyDoc();
    mockLabRepo.findPathologyById   = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.softDeletePathology = jest.fn().mockResolvedValue({ ...pendingDoc, isDeleted: true });

    await expect(
      service.deletePathologyRequest('req-path-001', TENANT, 'pathologist-001', UserRole.PATHOLOGIST),
    ).resolves.toBeUndefined();
  });

  test('writes DELETE audit log with previousValue on success', async () => {
    const pendingDoc = makePathologyDoc();
    mockLabRepo.findPathologyById   = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.softDeletePathology = jest.fn().mockResolvedValue({ ...pendingDoc, isDeleted: true });

    await service.deletePathologyRequest('req-path-001', TENANT, DOCTOR, UserRole.DOCTOR);

    expect(mockAuditSvc.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action:        'DELETE',
        entityId:      'req-path-001',
        previousValue: expect.objectContaining({ requestId: 'req-path-001', testType: 'Blood CBC' }),
      }),
    );
  });
});

// ─── editRadiologyRequest ─────────────────────────────────────────────────────

describe('LabService — editRadiologyRequest', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockS3.getPresignedUrl = jest.fn().mockResolvedValue(null);
    mockAuditSvc.log       = jest.fn().mockResolvedValue(undefined);
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue({ fullName: 'Test Patient' });
  });

  test('throws 404 when request does not exist', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(null);
    await expect(
      service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { imagingType: 'MRI Brain' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 409 when request is already COMPLETED', async () => {
    const completedDoc = makeRadiologyDoc({ status: LabRequestStatus.COMPLETED });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(completedDoc);
    await expect(
      service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { imagingType: 'MRI Brain' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects a status change from a DOCTOR with 403', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology  = jest.fn();
    await expect(
      service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockLabRepo.updateRadiology).not.toHaveBeenCalled();
  });

  test('rejects a status change from a PATHOLOGIST with 403', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology  = jest.fn();
    await expect(
      service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, UserRole.PATHOLOGIST),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('allows a DOCTOR to resend the unchanged status with other edits', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology  = jest.fn().mockResolvedValue(makeRadiologyDoc());
    await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { status: 'PENDING', priority: 'URGENT' }, undefined, UserRole.DOCTOR);
    expect(mockLabRepo.updateRadiology).toHaveBeenCalled();
  });

  test.each([UserRole.HOSPITAL_ADMIN, UserRole.RADIOLOGIST])('allows %s to change status', async (role) => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc());
    mockLabRepo.updateRadiology  = jest.fn().mockResolvedValue(makeRadiologyDoc({ status: LabRequestStatus.IN_PROGRESS }));
    const result = await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { status: 'IN_PROGRESS' }, undefined, role);
    expect(result.status).toBe(LabRequestStatus.IN_PROGRESS);
  });

  test('updates only fields present in input', async () => {
    const doc     = makeRadiologyDoc();
    const updated = makeRadiologyDoc({ imagingType: 'CT Chest', priority: 'URGENT' });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(updated);

    await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { imagingType: 'CT Chest', priority: 'URGENT' });

    expect(mockLabRepo.updateRadiology).toHaveBeenCalledWith(
      'req-radio-001', TENANT,
      expect.objectContaining({ imagingType: 'CT Chest', priority: 'URGENT' }),
      undefined,
    );
  });

  test('writes UPDATE audit log on success', async () => {
    const doc     = makeRadiologyDoc();
    const updated = makeRadiologyDoc({ notes: 'Urgent scan needed' });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(updated);

    await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { notes: 'Urgent scan needed' });

    expect(mockAuditSvc.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', entityId: 'req-radio-001' }),
    );
  });

  test('redacts notes in the audit log — value never reaches the trail', async () => {
    const doc     = makeRadiologyDoc({ notes: 'Old confidential note' });
    const updated = makeRadiologyDoc({ notes: 'New confidential note' });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(updated);

    await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { notes: 'New confidential note' });

    expect(mockLabRepo.updateRadiology).toHaveBeenCalledWith(
      'req-radio-001', TENANT,
      expect.objectContaining({ notes: 'New confidential note' }),
      undefined,
    );

    const [entry] = mockAuditSvc.log.mock.calls[0] as [{ previousValue: Record<string, unknown>; newValue: Record<string, unknown> }];
    expect(entry.previousValue.notes).toBe('[redacted]');
    expect(entry.newValue.notes).toBe('[redacted]');
    expect(JSON.stringify(entry)).not.toContain('confidential note');
  });
});

// ─── deleteRadiologyRequest ───────────────────────────────────────────────────

describe('LabService — deleteRadiologyRequest', () => {
  let service: LabService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockAuditSvc.log = jest.fn().mockResolvedValue(undefined);
  });

  test('throws 404 when request does not exist', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(null);
    await expect(
      service.deleteRadiologyRequest('req-radio-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('throws 403 when DOCTOR tries to delete a COMPLETED request', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc({ status: LabRequestStatus.COMPLETED }));
    await expect(
      service.deleteRadiologyRequest('req-radio-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('throws 403 when RADIOLOGIST tries to delete a COMPLETED request', async () => {
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(makeRadiologyDoc({ status: LabRequestStatus.COMPLETED }));
    await expect(
      service.deleteRadiologyRequest('req-radio-001', TENANT, 'radiologist-001', UserRole.RADIOLOGIST),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('allows HOSPITAL_ADMIN to delete a COMPLETED request', async () => {
    const completedDoc = makeRadiologyDoc({ status: LabRequestStatus.COMPLETED });
    mockLabRepo.findRadiologyById   = jest.fn().mockResolvedValue(completedDoc);
    mockLabRepo.softDeleteRadiology = jest.fn().mockResolvedValue({ ...completedDoc, isDeleted: true });

    await expect(
      service.deleteRadiologyRequest('req-radio-001', TENANT, 'admin-001', UserRole.HOSPITAL_ADMIN),
    ).resolves.toBeUndefined();
    expect(mockLabRepo.softDeleteRadiology).toHaveBeenCalledTimes(1);
  });

  test('allows DOCTOR to delete a PENDING request', async () => {
    const pendingDoc = makeRadiologyDoc();
    mockLabRepo.findRadiologyById   = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.softDeleteRadiology = jest.fn().mockResolvedValue({ ...pendingDoc, isDeleted: true });

    await expect(
      service.deleteRadiologyRequest('req-radio-001', TENANT, DOCTOR, UserRole.DOCTOR),
    ).resolves.toBeUndefined();
  });

  test('writes DELETE audit log with previousValue on success', async () => {
    const pendingDoc = makeRadiologyDoc();
    mockLabRepo.findRadiologyById   = jest.fn().mockResolvedValue(pendingDoc);
    mockLabRepo.softDeleteRadiology = jest.fn().mockResolvedValue({ ...pendingDoc, isDeleted: true });

    await service.deleteRadiologyRequest('req-radio-001', TENANT, DOCTOR, UserRole.DOCTOR);

    expect(mockAuditSvc.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action:        'DELETE',
        entityId:      'req-radio-001',
        previousValue: expect.objectContaining({ requestId: 'req-radio-001', imagingType: 'X-Ray Chest' }),
      }),
    );
  });
});

// ─── Linked OPD/IPD encounter ────────────────────────────────────────────────

describe('LabService — linked OPD/IPD encounter', () => {
  let service: LabService;
  const mockOpdRepo  = opdRepository        as jest.Mocked<typeof opdRepository>;
  const mockIpdRepo  = ipdRepository        as jest.Mocked<typeof ipdRepository>;
  const mockDeptRepo = departmentRepository as jest.Mocked<typeof departmentRepository>;
  const mockUserRepo = userRepository       as jest.Mocked<typeof userRepository>;

  const ADMISSION = {
    admissionId: 'ADM-1', patientId: 'patient-001', wardName: 'General Ward', bedNumber: 'B-12',
    assignedDoctorIds: ['doc-1'], departmentId: 'dept-1', admissionDate: new Date('2026-10-01T05:00:00Z'),
  };
  const visit = (visitId: string, doctorIds: string[]) => ({
    visitId, patientId: 'patient-001', doctorIds, departmentId: 'dept-1',
    visitDate: new Date('2026-10-04T18:30:00Z'),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue({ patientId: 'patient-001' });
    mockNotifSvc.sendToRole         = jest.fn().mockResolvedValue(undefined);
    mockLabRepo.savePathology       = jest.fn().mockResolvedValue(makePathologyDoc());
    (mockUserRepo.findById as jest.Mock).mockResolvedValue({ role: UserRole.DOCTOR, departmentIds: [] });
    (mockUserRepo.findNamesByIds as jest.Mock).mockResolvedValue(new Map([['doc-1', 'Dr. One']]));
    (mockIpdRepo.findAdmissionCoveringDate as jest.Mock).mockResolvedValue(null);
    (mockIpdRepo.findById as jest.Mock).mockResolvedValue(null);
    (mockOpdRepo.findPatientVisitsOnDayAt as jest.Mock).mockResolvedValue([]);
    (mockOpdRepo.findByVisitId as jest.Mock).mockResolvedValue(null);
    (mockDeptRepo.findById as jest.Mock).mockResolvedValue({ name: 'Cardiology' });
  });

  const savedFields = () => (mockLabRepo.savePathology as jest.Mock).mock.calls[0][0];

  test('links the active IPD admission at creation (IPD wins over a same-day OPD visit)', async () => {
    (mockIpdRepo.findAdmissionCoveringDate as jest.Mock).mockResolvedValue(ADMISSION);
    (mockOpdRepo.findPatientVisitsOnDayAt as jest.Mock).mockResolvedValue([visit('V-1', [])]);
    await service.createPathologyRequest({ patientId: 'patient-001', testType: 'CBC', referredBy: 'SELF' }, TENANT, DOCTOR);
    expect(savedFields()).toMatchObject({ ipdAdmissionId: 'ADM-1', opdVisitId: null });
  });

  test('links the single same-day OPD visit at creation', async () => {
    (mockOpdRepo.findPatientVisitsOnDayAt as jest.Mock).mockResolvedValue([visit('V-1', [])]);
    await service.createPathologyRequest({ patientId: 'patient-001', testType: 'CBC', referredBy: 'SELF' }, TENANT, DOCTOR);
    expect(savedFields()).toMatchObject({ opdVisitId: 'V-1', ipdAdmissionId: null });
  });

  test('narrows several same-day OPD visits to the one naming the referring doctor', async () => {
    (mockOpdRepo.findPatientVisitsOnDayAt as jest.Mock).mockResolvedValue([visit('V-1', ['doc-1']), visit('V-2', ['doc-2'])]);
    await service.createPathologyRequest({ patientId: 'patient-001', testType: 'CBC', referredBy: 'doc-2' }, TENANT, DOCTOR);
    expect(savedFields()).toMatchObject({ opdVisitId: 'V-2', ipdAdmissionId: null });
  });

  test('links nothing when several same-day OPD visits cannot be told apart', async () => {
    (mockOpdRepo.findPatientVisitsOnDayAt as jest.Mock).mockResolvedValue([visit('V-1', ['doc-1']), visit('V-2', ['doc-2'])]);
    await service.createPathologyRequest({ patientId: 'patient-001', testType: 'CBC', referredBy: 'SELF' }, TENANT, DOCTOR);
    expect(savedFields()).toMatchObject({ opdVisitId: null, ipdAdmissionId: null });
  });

  test('GET returns the stored IPD admission with ward, bed, department and doctors', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ ipdAdmissionId: 'ADM-1', opdVisitId: null }));
    (mockIpdRepo.findById as jest.Mock).mockResolvedValue(ADMISSION);

    const result = await service.getPathologyRequest('req-path-001', TENANT);

    expect(mockIpdRepo.findById).toHaveBeenCalledWith('ADM-1', TENANT);
    expect(mockIpdRepo.findAdmissionCoveringDate).not.toHaveBeenCalled();
    expect(result.encounter).toEqual({
      type: 'IPD', encounterId: 'ADM-1', date: ADMISSION.admissionDate.toISOString(),
      wardName: 'General Ward', bedNumber: 'B-12', departmentName: 'Cardiology', doctorNames: ['Dr. One'],
    });
  });

  test('GET returns the stored OPD visit', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ opdVisitId: 'V-1', ipdAdmissionId: null }));
    (mockOpdRepo.findByVisitId as jest.Mock).mockResolvedValue(visit('V-1', ['doc-1']));

    const result = await service.getPathologyRequest('req-path-001', TENANT);

    expect(result.encounter).toMatchObject({
      type: 'OPD', encounterId: 'V-1', departmentName: 'Cardiology', doctorNames: ['Dr. One'], wardName: null, bedNumber: null,
    });
  });

  test('GET returns null (no re-resolution) when the request was created with no encounter', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ opdVisitId: null, ipdAdmissionId: null }));
    (mockIpdRepo.findAdmissionCoveringDate as jest.Mock).mockResolvedValue(ADMISSION);

    const result = await service.getPathologyRequest('req-path-001', TENANT);

    expect(result.encounter).toBeNull();
    expect(mockIpdRepo.findAdmissionCoveringDate).not.toHaveBeenCalled();
  });

  test('GET ignores a stored link that points at another patient', async () => {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ opdVisitId: 'V-1', ipdAdmissionId: null }));
    (mockOpdRepo.findByVisitId as jest.Mock).mockResolvedValue({ ...visit('V-1', []), patientId: 'other' });

    const result = await service.getPathologyRequest('req-path-001', TENANT);

    expect(result.encounter).toBeNull();
  });

  test('GET resolves a legacy request (no stored link) against its own requestedAt', async () => {
    const requestedAt = new Date('2026-10-02T06:00:00Z');
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(makePathologyDoc({ requestedAt }));
    (mockIpdRepo.findAdmissionCoveringDate as jest.Mock).mockResolvedValue(ADMISSION);

    const result = await service.getPathologyRequest('req-path-001', TENANT);

    expect(mockIpdRepo.findAdmissionCoveringDate).toHaveBeenCalledWith(TENANT, 'patient-001', requestedAt);
    expect(result.encounter).toMatchObject({ type: 'IPD', encounterId: 'ADM-1' });
  });
});

describe('LabService — submitPathologyTestReport', () => {
  const CBC = 'CBC (Complete Blood Count)';
  const LFT = 'LFT (Liver Function Test)';
  let service: LabService;

  // The stored request after the upsert: its testReports carry the given names.
  const withReports = (base: IPathologyRequest, names: string[]) => ({
    ...base,
    testReports: names.map((testName) => ({
      testName, templateKey: 'X', resultData: JSON.stringify({ values: [], remarks: null }),
      submittedBy: 'path-1', submittedAt: new Date(),
    })),
  }) as unknown as IPathologyRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LabService();
    mockPatientRepo.findByPatientId = jest.fn().mockResolvedValue({ patientId: 'patient-001', fullName: 'Jane', gender: 'FEMALE' });
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(PAID as never);
    (userRepository.findNamesByIds as jest.Mock).mockResolvedValue(new Map([['path-1', 'Pathologist One']]));
    mockNotifSvc.sendNotification = jest.fn().mockResolvedValue(undefined);
    mockLabRepo.updatePathology = jest.fn().mockImplementation(async (_id, _t, update) => ({ ...lastSaved, ...update }));
  });

  let lastSaved: IPathologyRequest;
  function arrange(doc: IPathologyRequest, savedNames: string[]) {
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    lastSaved = withReports(doc, savedNames);
    mockLabRepo.upsertPathologyTestReport = jest.fn().mockResolvedValue(lastSaved);
  }

  test('stores filled values only, with the female range and flag, as JSON; first test → IN_PROGRESS', async () => {
    const doc = makePathologyDoc({ testType: `${CBC}, ${LFT}` });
    arrange(doc, [CBC]);

    const result = await service.submitPathologyTestReport('req-path-001', 0, TENANT, 'path-1', {
      testName: CBC, values: { hemoglobin: '12.5', rbc: '  ', wbc: null }, remarks: '  ',
    });

    const stored = (mockLabRepo.upsertPathologyTestReport as jest.Mock).mock.calls[0][2];
    expect(stored).toMatchObject({ testName: CBC, templateKey: 'CBC', submittedBy: 'path-1' });
    expect(JSON.parse(stored.resultData)).toEqual({
      values: [{ key: 'hemoglobin', name: 'Haemoglobin (Hb)', section: null, value: '12.5', unit: 'g/dL', referenceRange: '12.0 - 15.0', flag: null }],
      remarks: null,
    });
    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith('req-path-001', TENANT, { status: LabRequestStatus.IN_PROGRESS });
    expect(result.status).toBe(LabRequestStatus.IN_PROGRESS);
  });

  test('the last outstanding test → COMPLETED', async () => {
    const doc = makePathologyDoc({ testType: `${CBC}, ${LFT}`, status: LabRequestStatus.IN_PROGRESS });
    arrange(doc, [CBC, LFT]);
    await service.submitPathologyTestReport('req-path-001', 1, TENANT, 'path-1', { testName: LFT, values: { sgpt: '20' } });
    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith('req-path-001', TENANT, { status: LabRequestStatus.COMPLETED });
  });

  test('never moves a COMPLETED request (e.g. completed by a file upload) back', async () => {
    const doc = makePathologyDoc({ testType: `${CBC}, ${LFT}`, status: LabRequestStatus.COMPLETED });
    arrange(doc, [CBC]);
    await service.submitPathologyTestReport('req-path-001', 0, TENANT, 'path-1', { testName: CBC, values: { hemoglobin: '14' } });
    expect(mockLabRepo.updatePathology).not.toHaveBeenCalled();
  });

  test('rejects an unpaid request before storing anything', async () => {
    arrange(makePathologyDoc({ testType: CBC }), [CBC]);
    mockPaymentRepo.findCompletedByReference.mockResolvedValue(null);
    await expect(service.submitPathologyTestReport('req-path-001', 0, TENANT, 'path-1', { testName: CBC, values: { hemoglobin: '14' } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(mockLabRepo.upsertPathologyTestReport).not.toHaveBeenCalled();
  });

  test('a free-text (legacy) test uses the generic Result field', async () => {
    arrange(makePathologyDoc({ testType: 'Blood CBC' }), ['Blood CBC']);
    await service.submitPathologyTestReport('req-path-001', 0, TENANT, 'path-1', { testName: 'Blood CBC', values: { result: 'Normal study' } });
    const stored = (mockLabRepo.upsertPathologyTestReport as jest.Mock).mock.calls[0][2];
    expect(stored.templateKey).toBe('GENERIC');
    expect(JSON.parse(stored.resultData).values[0]).toMatchObject({ key: 'result', value: 'Normal study', flag: null });
  });

  test('notifies the requester and referring doctor (not the submitter) and never audits values', async () => {
    arrange(makePathologyDoc({ testType: CBC, requestedBy: 'nurse-1', referredBy: DOCTOR, opdVisitId: null, ipdAdmissionId: null }), [CBC]);
    await service.submitPathologyTestReport('req-path-001', 0, TENANT, 'path-1', { testName: CBC, values: { hemoglobin: '9' } });
    const recipients = (mockNotifSvc.sendNotification as jest.Mock).mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual([DOCTOR, 'nurse-1'].sort());
    expect(JSON.stringify((auditService.log as jest.Mock).mock.calls)).not.toContain('"9"');
  });
});
