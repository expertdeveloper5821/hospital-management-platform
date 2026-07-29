jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/modules/department/department.repository');
jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/modules/lab/lab.repository');
jest.mock('../../../src/modules/payment/payment.repository');
jest.mock('../../../src/shared/services/s3.service');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('../../../src/modules/audit/audit.model', () => ({
  AuditLogModel: { find: jest.fn() },
}));

import { ipdRepository }        from '../../../src/modules/ipd/ipd.repository';
import { opdRepository }        from '../../../src/modules/opd/opd.repository';
import { patientRepository }    from '../../../src/modules/patient/patient.repository';
import { userRepository }       from '../../../src/modules/user/user.repository';
import { departmentRepository } from '../../../src/modules/department/department.repository';
import { tenantRepository }     from '../../../src/modules/tenant/tenant.repository';
import { labRepository }        from '../../../src/modules/lab/lab.repository';
import { paymentRepository }    from '../../../src/modules/payment/payment.repository';
import { s3Service }            from '../../../src/shared/services/s3.service';
import { AuditLogModel }        from '../../../src/modules/audit/audit.model';
import { IPDService }           from '../../../src/modules/ipd/ipd.service';
import { AdmissionStatus }      from '../../../src/modules/ipd/ipd.types';
import { ConflictError, NotFoundError } from '../../../src/shared/middleware/error-handler';
import { UserRole } from '../../../src/shared/types/common.types';

const mockIpdRepo  = ipdRepository        as jest.Mocked<typeof ipdRepository>;
const mockOpdRepo  = opdRepository        as jest.Mocked<typeof opdRepository>;
const mockPatRepo  = patientRepository    as jest.Mocked<typeof patientRepository>;
const mockUserRepo = userRepository       as jest.Mocked<typeof userRepository>;
const mockDeptRepo = departmentRepository as jest.Mocked<typeof departmentRepository>;
const mockTenRepo  = tenantRepository     as jest.Mocked<typeof tenantRepository>;
const mockLabRepo  = labRepository        as jest.Mocked<typeof labRepository>;
const mockPayRepo  = paymentRepository    as jest.Mocked<typeof paymentRepository>;
const mockS3       = s3Service            as jest.Mocked<typeof s3Service>;
const mockAuditFind = AuditLogModel.find as jest.Mock;

const TENANT_ID    = 'tenant-001';
const ADMISSION_ID = 'adm-001';
const PATIENT_ID   = 'PAT-00001';
const DOCTOR_ID    = 'doc-001';
const NURSE_ID     = 'nurse-001';
const RECEPT_ID    = 'recept-001';

function makeAuditQuery(docs: object[]) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) }) };
}

const BASE_ADMISSION = {
  admissionId: ADMISSION_ID,
  patientId:   PATIENT_ID,
  wardId:      'ward-001',
  bedId:       'bed-001',
  bedNumber:   'B-12',
  wardName:    'General Ward',
  assignedDoctorIds: [DOCTOR_ID],
  departmentId: 'dept-cardio',
  status:       AdmissionStatus.DISCHARGED,
  admissionDate: new Date('2026-01-06T08:00:00.000Z'),
  dischargeDate: new Date('2026-01-10T14:30:00.000Z'),
  progressNotes: [
    { noteId: 'n1', doctorId: NURSE_ID,  note: 'Stable overnight.', timestamp: new Date('2026-01-08T09:00:00.000Z') },
    { noteId: 'n2', doctorId: DOCTOR_ID, note: 'Reviewed vitals.',  timestamp: new Date('2026-01-07T09:00:00.000Z') },
  ],
};

const BASE_PATIENT = {
  patientId: PATIENT_ID, fullName: 'Ravi Kumar', dateOfBirth: new Date('1980-01-01'),
  gender: 'MALE', mobileNumber: '9876543210', address: '45 Park Lane',
  createdAt: new Date('2025-01-01T10:00:00.000Z'),
};

const BASE_TENANT = {
  name: 'City Hospital', adminEmail: 'admin@city.test',
  branding: { displayName: 'City Hospital', primaryColor: '#1A73E8', logoUrl: null },
  onboardingDocuments: { addressLine: '1 Main St', city: 'Metropolis', state: 'State', pincode: '100001', gstNumber: '22AAAAA0000A1Z5' },
};

const BASE_WARD = { wardId: 'ward-001', name: 'General Ward', assignedNurseIds: [NURSE_ID] };

function paginated<T>(data: T[]) {
  return { data, total: data.length, page: 1, limit: 500, totalPages: 1 };
}

describe('IPDService — getDischargeSummaryData', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();

    mockIpdRepo.findById = jest.fn().mockResolvedValue(BASE_ADMISSION as never);
    mockIpdRepo.findWardById = jest.fn().mockResolvedValue(BASE_WARD as never);
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(BASE_PATIENT as never);
    mockTenRepo.findById = jest.fn().mockResolvedValue(BASE_TENANT as never);
    mockOpdRepo.findByPatient = jest.fn().mockResolvedValue(paginated([]) as never);
    mockLabRepo.findPathologyByPatient = jest.fn().mockResolvedValue(paginated([]) as never);
    mockLabRepo.findRadiologyByPatient = jest.fn().mockResolvedValue(paginated([]) as never);
    mockPayRepo.findByFilters = jest.fn().mockResolvedValue(paginated([]) as never);
    mockDeptRepo.findById = jest.fn().mockResolvedValue(null);
    mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map());
    mockUserRepo.findById = jest.fn().mockResolvedValue(null);
    mockS3.getPresignedUrl = jest.fn().mockResolvedValue('https://s3.test/report.pdf');
    mockAuditFind.mockReturnValue(makeAuditQuery([]));
  });

  test('throws NotFoundError when admission does not exist', async () => {
    mockIpdRepo.findById = jest.fn().mockResolvedValue(null);
    await expect(service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN))
      .rejects.toThrow(NotFoundError);
  });

  test('throws ConflictError when the admission is still ADMITTED (not yet discharged)', async () => {
    mockIpdRepo.findById = jest.fn().mockResolvedValue({ ...BASE_ADMISSION, status: AdmissionStatus.ADMITTED } as never);
    await expect(service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN))
      .rejects.toThrow(ConflictError);
  });

  test('throws NotFoundError when the patient record is missing', async () => {
    mockPatRepo.findByPatientId = jest.fn().mockResolvedValue(null);
    await expect(service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN))
      .rejects.toThrow(NotFoundError);
  });

  test('happy path: returns fully-populated hospital, patient, and admission info', async () => {
    mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[DOCTOR_ID, 'Dr. Asha Rao'], [NURSE_ID, 'Nurse Priya']]));
    mockDeptRepo.findById = jest.fn().mockResolvedValue({ name: 'Cardiology' } as never);

    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);

    expect(result.hospital.name).toBe('City Hospital');
    expect(result.hospital.address).toContain('Metropolis');
    expect(result.hospital.registrationNumber).toBe('22AAAAA0000A1Z5');
    expect(result.patient.fullName).toBe('Ravi Kumar');
    expect(result.patient.age).toBeGreaterThan(0);
    expect(result.admission.wardName).toBe('General Ward');
    expect(result.admission.bedNumber).toBe('B-12');
    expect(result.admission.departmentName).toBe('Cardiology');
    expect(result.admission.assignedDoctorNames).toEqual(['Dr. Asha Rao']);
    expect(result.admission.assignedNurseNames).toEqual(['Nurse Priya']);
  });

  test('progress notes are sorted chronologically (ascending) regardless of storage order', async () => {
    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(result.admission.progressNotes.map((n) => n.timestamp)).toEqual([
      '2026-01-07T09:00:00.000Z', '2026-01-08T09:00:00.000Z',
    ]);
  });

  test('progress note author role is resolved via userRepository.findById (not just name)', async () => {
    mockUserRepo.findById = jest.fn().mockImplementation((_tenantId: string, id: string) =>
      Promise.resolve(id === DOCTOR_ID ? { role: UserRole.DOCTOR } : { role: UserRole.NURSE }));
    mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[DOCTOR_ID, 'Dr. Asha Rao'], [NURSE_ID, 'Nurse Priya']]));

    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    const byNurse = result.admission.progressNotes.find((n) => n.authorName === 'Nurse Priya');
    expect(byNurse?.authorRole).toBe(UserRole.NURSE);
  });

  test('a departmentId that no longer resolves to an active department yields departmentName: null (no crash)', async () => {
    mockDeptRepo.findById = jest.fn().mockResolvedValue(null);
    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(result.admission.departmentName).toBeNull();
  });

  test('OPD visits are mapped with resolved department/doctor names', async () => {
    mockOpdRepo.findByPatient = jest.fn().mockResolvedValue(paginated([{
      visitId: 'OPD-1', visitDate: new Date('2026-01-05T09:00:00.000Z'), status: 'COMPLETED',
      departmentId: 'dept-cardio', doctorIds: [DOCTOR_ID], diagnosis: 'Hypertension', prescription: 'Amlodipine',
      notes: '<p>Feeling better</p>',
    }]) as never);
    mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[DOCTOR_ID, 'Dr. Asha Rao']]));
    mockDeptRepo.findById = jest.fn().mockResolvedValue({ name: 'Cardiology' } as never);

    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(result.opdVisits).toHaveLength(1);
    expect(result.opdVisits[0]).toMatchObject({
      visitId: 'OPD-1', departmentName: 'Cardiology', doctorNames: ['Dr. Asha Rao'],
      diagnosis: 'Hypertension', prescription: 'Amlodipine', notesHtml: '<p>Feeling better</p>',
    });
  });

  test('lab requests include both pathology and radiology, with a resolved report URL', async () => {
    mockLabRepo.findPathologyByPatient = jest.fn().mockResolvedValue(paginated([{
      requestId: 'LAB-1', testType: 'CBC', status: 'COMPLETED', priority: 'NORMAL',
      requestedBy: DOCTOR_ID, departmentId: null, requestedAt: new Date('2026-01-06T10:00:00.000Z'),
      notes: null, reportS3Key: 'org/t1/reports/1.pdf',
    }]) as never);
    mockLabRepo.findRadiologyByPatient = jest.fn().mockResolvedValue(paginated([{
      requestId: 'LAB-2', imagingType: 'X-Ray', status: 'PENDING', priority: 'URGENT',
      requestedBy: DOCTOR_ID, departmentId: null, requestedAt: new Date('2026-01-06T11:00:00.000Z'),
      notes: null, reportS3Key: null,
    }]) as never);

    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(result.labRequests).toHaveLength(2);
    const pathology = result.labRequests.find((r) => r.category === 'PATHOLOGY');
    const radiology = result.labRequests.find((r) => r.category === 'RADIOLOGY');
    expect(pathology?.type).toBe('CBC');
    expect(pathology?.reportUrl).toBe('https://s3.test/report.pdf');
    expect(radiology?.type).toBe('X-Ray');
    expect(radiology?.reportUrl).toBeNull(); // no reportS3Key at all
  });

  test('a failed presigned-URL lookup degrades to reportUrl: null rather than throwing', async () => {
    mockLabRepo.findPathologyByPatient = jest.fn().mockResolvedValue(paginated([{
      requestId: 'LAB-1', testType: 'CBC', status: 'COMPLETED', priority: 'NORMAL',
      requestedBy: DOCTOR_ID, departmentId: null, requestedAt: new Date(), notes: null,
      reportS3Key: 'org/t1/reports/1.pdf',
    }]) as never);
    mockS3.getPresignedUrl = jest.fn().mockRejectedValue(new Error('S3 unavailable'));

    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(result.labRequests[0].reportUrl).toBeNull();
  });

  describe('hospital logo — S3 key resolved to a presigned URL', () => {
    test('a configured logo key is resolved to a presigned URL (not passed through as a raw S3 key)', async () => {
      mockTenRepo.findById = jest.fn().mockResolvedValue({
        ...BASE_TENANT,
        branding: { ...BASE_TENANT.branding, logoUrl: 'tenants/tenant-001/logos/logo.png' },
      } as never);
      mockS3.getPresignedUrl = jest.fn().mockResolvedValue('https://s3.test/presigned-logo.png');

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);

      expect(mockS3.getPresignedUrl).toHaveBeenCalledWith('tenants/tenant-001/logos/logo.png', 86400);
      expect(result.hospital.logoUrl).toBe('https://s3.test/presigned-logo.png');
    });

    test('no configured logo yields hospital.logoUrl: null without calling S3', async () => {
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.hospital.logoUrl).toBeNull();
      expect(mockS3.getPresignedUrl).not.toHaveBeenCalled();
    });

    test('a failed presigned-URL lookup degrades to hospital.logoUrl: null rather than throwing', async () => {
      mockTenRepo.findById = jest.fn().mockResolvedValue({
        ...BASE_TENANT,
        branding: { ...BASE_TENANT.branding, logoUrl: 'tenants/tenant-001/logos/logo.png' },
      } as never);
      mockS3.getPresignedUrl = jest.fn().mockRejectedValue(new Error('S3 unavailable'));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.hospital.logoUrl).toBeNull();
    });
  });

  describe('hospital branding — used for the discharge-summary letterhead', () => {
    test('the exact primaryColor saved by the Hospital Admin in Branding settings is passed through unchanged', async () => {
      mockTenRepo.findById = jest.fn().mockResolvedValue({
        ...BASE_TENANT,
        branding: { ...BASE_TENANT.branding, primaryColor: '#7B1FA2' },
      } as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.hospital.primaryColor).toBe('#7B1FA2');
    });

    test('registrationNumber is sourced from onboardingDocuments.gstNumber', async () => {
      mockTenRepo.findById = jest.fn().mockResolvedValue({
        ...BASE_TENANT,
        onboardingDocuments: { ...BASE_TENANT.onboardingDocuments, gstNumber: '07BBBBB1111B2Z6' },
      } as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.hospital.registrationNumber).toBe('07BBBBB1111B2Z6');
    });

    test('falls back to name/branding/address/registrationNumber defaults when the tenant record is missing (no crash)', async () => {
      mockTenRepo.findById = jest.fn().mockResolvedValue(null);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.hospital.name).toBe('Hospital');
      expect(result.hospital.primaryColor).toBe(''); // no tenant → no configured color → PDF falls back to black, not a hardcoded hue
      expect(result.hospital.address).toBeNull();
      expect(result.hospital.email).toBeNull();
      expect(result.hospital.registrationNumber).toBeNull();
      expect(result.hospital.logoUrl).toBeNull();
    });
  });

  describe('billing — role-gated inclusion', () => {
    const payments = [
      { amount: 500, paymentMethod: 'CASH', status: 'COMPLETED', description: 'OPD Fee', createdAt: new Date('2026-01-05T09:30:00.000Z') },
      { amount: 200, paymentMethod: 'UPI',  status: 'PENDING',   description: 'Extra',   createdAt: new Date('2026-01-06T09:30:00.000Z') },
    ];

    test('included for a role with payment-view permission (HOSPITAL_ADMIN)', async () => {
      mockPayRepo.findByFilters = jest.fn().mockResolvedValue(paginated(payments) as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.billing).not.toBeNull();
      expect(result.billing?.payments).toHaveLength(2);
      // total only counts COMPLETED payments
      expect(result.billing?.total).toBe(500);
    });

    test('included for RECEPTIONIST (matches GET /api/payments role gate)', async () => {
      mockPayRepo.findByFilters = jest.fn().mockResolvedValue(paginated(payments) as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.RECEPTIONIST);
      expect(result.billing).not.toBeNull();
    });

    test('omitted (null) for a role without payment-view permission (DOCTOR)', async () => {
      mockPayRepo.findByFilters = jest.fn().mockResolvedValue(paginated(payments) as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.DOCTOR);
      expect(result.billing).toBeNull();
      // Must not even query payments for a role that can't see them.
      expect(mockPayRepo.findByFilters).not.toHaveBeenCalled();
    });

    test('omitted (null) for NURSE', async () => {
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.NURSE);
      expect(result.billing).toBeNull();
    });

    test('omitted (null) when the role has permission but there are no payments at all', async () => {
      mockPayRepo.findByFilters = jest.fn().mockResolvedValue(paginated([]) as never);
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.billing).toBeNull();
    });
  });

  describe('"registered by" / "discharged by" — best-effort audit-log lookups', () => {
    test('resolves registeredByName from the earliest PATIENT CREATE audit entry', async () => {
      mockAuditFind.mockImplementation((query: Record<string, unknown>) => {
        if (query.entityType === 'PATIENT') {
          return makeAuditQuery([{ userId: RECEPT_ID, newValue: { fullName: 'Ravi Kumar' }, timestamp: new Date('2025-01-01T09:00:00Z') }]);
        }
        return makeAuditQuery([]);
      });
      mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[RECEPT_ID, 'Reception Staff']]));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.patient.registeredByName).toBe('Reception Staff');
    });

    test('skips a PATIENT CREATE entry that is actually a first-time medical-card generation, not real registration', async () => {
      mockAuditFind.mockImplementation((query: Record<string, unknown>) => {
        if (query.entityType === 'PATIENT') {
          return makeAuditQuery([
            { userId: 'card-gen-user', newValue: { medicalCardGenerated: true }, timestamp: new Date('2024-12-01T09:00:00Z') },
            { userId: RECEPT_ID, newValue: { fullName: 'Ravi Kumar' }, timestamp: new Date('2025-01-01T09:00:00Z') },
          ]);
        }
        return makeAuditQuery([]);
      });
      mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[RECEPT_ID, 'Reception Staff'], ['card-gen-user', 'Someone Else']]));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.patient.registeredByName).toBe('Reception Staff');
    });

    test('resolves dischargedByName from the UPDATE entry whose newValue.status is DISCHARGED', async () => {
      mockAuditFind.mockImplementation((query: Record<string, unknown>) => {
        if (query.entityType === 'IPD_ADMISSION') {
          return makeAuditQuery([
            { userId: DOCTOR_ID, newValue: { status: 'DISCHARGED' }, timestamp: new Date('2026-01-10T14:30:00Z') },
            { userId: NURSE_ID, newValue: { assignedDoctorIds: [] }, timestamp: new Date('2026-01-09T09:00:00Z') },
          ]);
        }
        return makeAuditQuery([]);
      });
      mockUserRepo.findNamesByIds = jest.fn().mockResolvedValue(new Map([[DOCTOR_ID, 'Dr. Asha Rao']]));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.admission.dischargedByName).toBe('Dr. Asha Rao');
    });

    test('resolves to null (not an error) when no matching audit entry exists', async () => {
      mockAuditFind.mockReturnValue(makeAuditQuery([]));
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.patient.registeredByName).toBeNull();
      expect(result.admission.dischargedByName).toBeNull();
    });

    test('resolves to null (not an error) when the audit query itself throws (e.g. TTL-expired collection issue)', async () => {
      mockAuditFind.mockImplementation(() => { throw new Error('boom'); });
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.patient.registeredByName).toBeNull();
      expect(result.admission.dischargedByName).toBeNull();
    });
  });

  test('generatedAt is a fresh timestamp (this is a live, never-persisted report)', async () => {
    const before = Date.now();
    const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
    expect(new Date(result.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  // ─── Assignment-scope authorization (mirrors getAdmissionById) ────────────
  // BASE_ADMISSION.wardId = 'ward-001', patientId = PATIENT_ID.
  describe('assignment-scope enforcement', () => {
    test('rejects with NotFoundError when nurseWardIds does not include the admission ward, before aggregating any data', async () => {
      await expect(
        service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.NURSE, ['some-other-ward'], undefined),
      ).rejects.toThrow(NotFoundError);
      expect(mockPatRepo.findByPatientId).not.toHaveBeenCalled();
      expect(mockOpdRepo.findByPatient).not.toHaveBeenCalled();
      expect(mockLabRepo.findPathologyByPatient).not.toHaveBeenCalled();
    });

    test('allows access when nurseWardIds includes the admission ward', async () => {
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.NURSE, ['ward-001'], undefined);
      expect(result.patient.fullName).toBe('Ravi Kumar');
    });

    test('rejects with NotFoundError when doctorPatientIds does not include the admission patient, before aggregating any data', async () => {
      await expect(
        service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.DOCTOR, undefined, ['some-other-patient']),
      ).rejects.toThrow(NotFoundError);
      expect(mockPatRepo.findByPatientId).not.toHaveBeenCalled();
      expect(mockOpdRepo.findByPatient).not.toHaveBeenCalled();
    });

    test('allows access when doctorPatientIds includes the admission patient', async () => {
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.DOCTOR, undefined, [PATIENT_ID]);
      expect(result.patient.fullName).toBe('Ravi Kumar');
    });

    test('unrestricted (undefined scope) roles like HOSPITAL_ADMIN bypass both checks', async () => {
      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN, undefined, undefined);
      expect(result.patient.fullName).toBe('Ravi Kumar');
    });
  });

  // ─── Pagination — no silent truncation past the first page ────────────────
  // Each source repository call is a paginated method; a patient with more
  // than one page's worth of history must not have records silently dropped.
  describe('pagination — fetches every page, not just the first', () => {
    function pagedSlice<T>(items: T[], page: number, limit: number) {
      const start = (page - 1) * limit;
      return { data: items.slice(start, start + limit), total: items.length, page, limit, totalPages: Math.ceil(items.length / limit) };
    }

    test('OPD visits beyond the first page are still included', async () => {
      const visits = Array.from({ length: 501 }, (_, i) => ({
        visitId: `OPD-${i}`, visitDate: new Date('2026-01-01T00:00:00.000Z'), status: 'COMPLETED',
        departmentId: null, doctorIds: [], diagnosis: null, prescription: null, notes: null,
      }));
      mockOpdRepo.findByPatient = jest.fn().mockImplementation((_t: string, _p: string, filters: { page: number; limit: number }) =>
        Promise.resolve(pagedSlice(visits, filters.page, filters.limit) as never));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.opdVisits).toHaveLength(501);
      expect(mockOpdRepo.findByPatient).toHaveBeenCalledTimes(2);
    });

    test('pathology and radiology requests beyond the first page are still included', async () => {
      const pathology = Array.from({ length: 520 }, (_, i) => ({
        requestId: `LAB-P-${i}`, testType: 'CBC', status: 'COMPLETED', priority: 'NORMAL',
        requestedBy: DOCTOR_ID, departmentId: null, requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        notes: null, reportS3Key: null,
      }));
      const radiology = Array.from({ length: 510 }, (_, i) => ({
        requestId: `LAB-R-${i}`, imagingType: 'X-Ray', status: 'PENDING', priority: 'NORMAL',
        requestedBy: DOCTOR_ID, departmentId: null, requestedAt: new Date('2026-01-01T00:00:00.000Z'),
        notes: null, reportS3Key: null,
      }));
      mockLabRepo.findPathologyByPatient = jest.fn().mockImplementation((_t: string, query: { page: number; limit: number }) =>
        Promise.resolve(pagedSlice(pathology, query.page, query.limit) as never));
      mockLabRepo.findRadiologyByPatient = jest.fn().mockImplementation((_t: string, query: { page: number; limit: number }) =>
        Promise.resolve(pagedSlice(radiology, query.page, query.limit) as never));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.labRequests.filter((r) => r.category === 'PATHOLOGY')).toHaveLength(520);
      expect(result.labRequests.filter((r) => r.category === 'RADIOLOGY')).toHaveLength(510);
    });

    test('the collected-payment total is calculated across the full payment set, not just the first page', async () => {
      const payments = Array.from({ length: 750 }, (_, i) => ({
        amount: 100, paymentMethod: 'CASH', status: 'COMPLETED', description: `Payment ${i}`,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }));
      mockPayRepo.findByFilters = jest.fn().mockImplementation((_t: string, query: { page: number; limit: number }) =>
        Promise.resolve(pagedSlice(payments, query.page, query.limit) as never));

      const result = await service.getDischargeSummaryData(ADMISSION_ID, TENANT_ID, UserRole.HOSPITAL_ADMIN);
      expect(result.billing?.payments).toHaveLength(750);
      expect(result.billing?.total).toBe(75000);
      expect(mockPayRepo.findByFilters).toHaveBeenCalledTimes(2);
    });
  });
});
