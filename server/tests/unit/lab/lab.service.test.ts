jest.mock('../../../src/modules/lab/lab.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/modules/notification/notification.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
import { auditService } from '../../../src/shared/services/audit.service';

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

const TENANT = 'tenant-001';
const DOCTOR = 'doctor-001';

function makePathologyDoc(overrides: Partial<IPathologyRequest> = {}): IPathologyRequest {
  return {
    requestId:   'req-path-001',
    patientId:   'patient-001',
    tenantId:    TENANT,
    requestedBy: DOCTOR,
    testType:    'Blood CBC',
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
      { patientId: 'patient-001', testType: 'Blood CBC' },
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
      service.createPathologyRequest({ patientId: 'unknown', testType: 'CBC' }, TENANT, DOCTOR),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('sends notification to pathologists on creation', async () => {
    mockLabRepo.savePathology = jest.fn().mockResolvedValue(makePathologyDoc());

    await service.createPathologyRequest(
      { patientId: 'patient-001', testType: 'Blood CBC' },
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

  test('updates only fields present in input', async () => {
    const doc     = makePathologyDoc();
    const updated = makePathologyDoc({ testType: 'New CBC', priority: 'URGENT' });
    mockLabRepo.findPathologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updatePathology   = jest.fn().mockResolvedValue(updated);

    await service.editPathologyRequest('req-path-001', TENANT, DOCTOR, { testType: 'New CBC', priority: 'URGENT' });

    expect(mockLabRepo.updatePathology).toHaveBeenCalledWith(
      'req-path-001', TENANT,
      expect.objectContaining({ testType: 'New CBC', priority: 'URGENT' }),
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

  test('updates only fields present in input', async () => {
    const doc     = makeRadiologyDoc();
    const updated = makeRadiologyDoc({ imagingType: 'CT Chest', priority: 'URGENT' });
    mockLabRepo.findRadiologyById = jest.fn().mockResolvedValue(doc);
    mockLabRepo.updateRadiology   = jest.fn().mockResolvedValue(updated);

    await service.editRadiologyRequest('req-radio-001', TENANT, DOCTOR, { imagingType: 'CT Chest', priority: 'URGENT' });

    expect(mockLabRepo.updateRadiology).toHaveBeenCalledWith(
      'req-radio-001', TENANT,
      expect.objectContaining({ imagingType: 'CT Chest', priority: 'URGENT' }),
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
