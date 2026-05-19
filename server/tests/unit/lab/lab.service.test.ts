jest.mock('../../../src/modules/lab/lab.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/notification/notification.service');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');

import { labRepository }        from '../../../src/modules/lab/lab.repository';
import { patientRepository }    from '../../../src/modules/patient/patient.repository';
import { notificationService }  from '../../../src/modules/notification/notification.service';
import { s3Service }            from '../../../src/shared/services/s3.service';
import { LabService }           from '../../../src/modules/lab/lab.service';
import { LabRequestStatus, PATHOLOGY_REPORT_MAX_BYTES, RADIOLOGY_REPORT_MAX_BYTES } from '../../../src/modules/lab/lab.types';
import { IPathologyRequest, IRadiologyRequest } from '../../../src/modules/lab/lab.model';

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
    notes:       null,
    reportS3Key: null,
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
    notes:       null,
    reportS3Key: null,
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
