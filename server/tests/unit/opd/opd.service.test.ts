jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/ipd/ipd.service');
jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/payment/payment.repository');
jest.mock('../../../src/modules/tenant/tenant.service');
jest.mock('../../../src/modules/department/department.service');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import { opdRepository }     from '../../../src/modules/opd/opd.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { ipdService }        from '../../../src/modules/ipd/ipd.service';
import { ipdRepository }     from '../../../src/modules/ipd/ipd.repository';
import { paymentRepository } from '../../../src/modules/payment/payment.repository';
import { tenantService }     from '../../../src/modules/tenant/tenant.service';
import { departmentService } from '../../../src/modules/department/department.service';
import { userRepository }    from '../../../src/modules/user/user.repository';
import { OPDService }        from '../../../src/modules/opd/opd.service';
import { OPDVisitStatus, OPDPaymentValidityReason } from '../../../src/modules/opd/opd.types';
import { UserRole }          from '../../../src/shared/types/common.types';
import { NotFoundError, ConflictError, ValidationError } from '../../../src/shared/middleware/error-handler';
import { toIstMidnight, toIstDateKey } from '../../../src/modules/attendance/attendance.timezone';
import { auditService }      from '../../../src/shared/services/audit.service';

const mockAuditService = auditService as jest.Mocked<typeof auditService>;

const mockOpdRepo        = opdRepository     as jest.Mocked<typeof opdRepository>;
const mockPatientRepo    = patientRepository as jest.Mocked<typeof patientRepository>;
const mockIpdService     = ipdService        as jest.Mocked<typeof ipdService>;
const mockIpdRepo        = ipdRepository     as jest.Mocked<typeof ipdRepository>;
const mockPaymentRepo    = paymentRepository as jest.Mocked<typeof paymentRepository>;
const mockTenantSvc      = tenantService     as jest.Mocked<typeof tenantService>;
const mockDepartmentSvc  = departmentService as jest.Mocked<typeof departmentService>;
const mockUserRepo       = userRepository    as jest.Mocked<typeof userRepository>;

const BASE_PATIENT = {
  patientId: 'PAT-ABCD1234',
  tenantId:  't1',
  fullName:  'Ravi Kumar',
};

function makeVisit(overrides: Partial<{
  visitId:   string;
  status:    OPDVisitStatus;
  doctorIds: string[];
  nurseIds:  string[];
}> = {}) {
  return {
    visitId:        overrides.visitId  ?? 'OPD-TEST0001',
    tenantId:       't1',
    patientId:      'PAT-ABCD1234',
    doctorIds:      overrides.doctorIds ?? [],
    nurseIds:       overrides.nurseIds  ?? [],
    visitDate:      new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:    1,
    status:         overrides.status   ?? OPDVisitStatus.OPEN,
    diagnosis:      null,
    prescription:   null,
    notes:          null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };
}

const VALID_CREATE_REQ = {
  patientId: 'PAT-ABCD1234',
  visitDate: '2026-05-15',
};

describe('OPDService — example-based', () => {
  let service: OPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OPDService();
    // Default: no resolvable department (matches the common case of no/blank
    // doctorIds in most fixtures below) — individual tests override this.
    mockDepartmentSvc.resolveDepartmentFromDoctorIds.mockResolvedValue(null);
  });

  // ── createVisit ────────────────────────────────────────────────────────────
  describe('createVisit', () => {
    test('creates visit with OPEN status and auto-assigned queue number', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      const result = await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(result.status).toBe(OPDVisitStatus.OPEN);
      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status:         OPDVisitStatus.OPEN,
          queueNumber:    1,
          diagnosis:      null,
          prescription:   null,
        }),
      );
    });

    test('queue number is count+1 for the day', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(4);
      let savedQueueNumber = 0;
      mockOpdRepo.save.mockImplementation(async (data) => {
        savedQueueNumber = (data as { queueNumber: number }).queueNumber;
        return makeVisit() as never;
      });

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(savedQueueNumber).toBe(5);
    });

    test('visitId has OPD- prefix with 8 uppercase hex chars', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      let savedVisitId = '';
      mockOpdRepo.save.mockImplementation(async (data) => {
        savedVisitId = (data as { visitId: string }).visitId;
        return makeVisit({ visitId: savedVisitId }) as never;
      });

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(savedVisitId).toMatch(/^OPD-[A-F0-9]{8}$/);
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN))
        .rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.save).not.toHaveBeenCalled();
    });

    test('optional fields default to null', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ doctorIds: [], notes: null, diagnosis: null, prescription: null }),
      );
    });

    // ── department resolution (revenue mapping fix) ───────────────────────────
    test('resolves departmentId from the assigned doctor(s), not the patient', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT, departmentId: 'DEPT-STALE' } as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit({ doctorIds: ['doc-1'] }) as never);
      mockDepartmentSvc.resolveDepartmentFromDoctorIds.mockResolvedValue('DEPT-CARDIO');

      await service.createVisit('t1', { ...VALID_CREATE_REQ, doctorIds: ['doc-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).toHaveBeenCalledWith('t1', ['doc-1']);
      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: 'DEPT-CARDIO' }),
      );
    });

    test('departmentId is null when no doctor is assigned', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).toHaveBeenCalledWith('t1', []);
      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: null }),
      );
    });

    test('departmentId is null when the assigned doctor(s) have no department', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit({ doctorIds: ['doc-1'] }) as never);
      mockDepartmentSvc.resolveDepartmentFromDoctorIds.mockResolvedValue(null);

      await service.createVisit('t1', { ...VALID_CREATE_REQ, doctorIds: ['doc-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN);

      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ departmentId: null }),
      );
    });

    test('defaults visitDate to today when not provided', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);
      const before = toIstMidnight(new Date());

      await service.createVisit('t1', { patientId: 'PAT-ABCD1234' }, 'user-1', UserRole.RECEPTIONIST);

      const savedDate = (mockOpdRepo.save.mock.calls[0] as unknown[])[0] as { visitDate: Date };
      expect(savedDate.visitDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    // ── past-date validation ──────────────────────────────────────────────────
    test('rejects a past visitDate for a normal role (RECEPTIONIST)', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);

      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: '2020-01-01' }, 'user-1', UserRole.RECEPTIONIST),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: '2020-01-01' }, 'user-1', UserRole.RECEPTIONIST),
      ).rejects.toThrow('Past dates are not allowed for OPD visits.');

      expect(mockOpdRepo.save).not.toHaveBeenCalled();
    });

    test('rejects a past visitDate for DOCTOR and NURSE roles', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);

      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: '2020-01-01' }, 'user-1', UserRole.DOCTOR),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: '2020-01-01' }, 'user-1', UserRole.NURSE),
      ).rejects.toThrow(ValidationError);
    });

    test('allows a past visitDate for an authorized role (HOSPITAL_ADMIN)', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: '2020-01-01' }, 'admin-1', UserRole.HOSPITAL_ADMIN),
      ).resolves.toBeDefined();
      expect(mockOpdRepo.save).toHaveBeenCalled();
    });

    test('allows today\'s date for a normal role', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);
      const todayStr = toIstDateKey(new Date());

      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: todayStr }, 'user-1', UserRole.RECEPTIONIST),
      ).resolves.toBeDefined();
    });

    test('allows a future date for a normal role', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);
      const future = new Date();
      future.setDate(future.getDate() + 7);
      const futureStr = future.toISOString().substring(0, 10);

      await expect(
        service.createVisit('t1', { ...VALID_CREATE_REQ, visitDate: futureStr }, 'user-1', UserRole.RECEPTIONIST),
      ).resolves.toBeDefined();
    });

    // ── Assign Nurse (doctor-wise, multi-nurse OPD nurse assignment) ─────────
    describe('nurse assignment', () => {
      const NURSE_1 = { _id: 'nurse-1', tenantId: 't1', role: UserRole.NURSE, isActive: true, name: 'Nurse XYZ' };
      const NURSE_2 = { _id: 'nurse-2', tenantId: 't1', role: UserRole.NURSE, isActive: true, name: 'Nurse PQR' };

      function mockNurse(id: string) {
        mockUserRepo.findById.mockImplementation(async (_tid, uid) =>
          (uid === 'nurse-1' ? NURSE_1 : uid === 'nurse-2' ? NURSE_2 : null) as never);
      }

      test('nurse assignment is optional — visit creates fine with no nurseIds', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockOpdRepo.countByDate.mockResolvedValue(0);
        mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

        await service.createVisit('t1', VALID_CREATE_REQ, 'user-1', UserRole.HOSPITAL_ADMIN);

        expect(mockOpdRepo.save).toHaveBeenCalledWith(expect.objectContaining({ nurseIds: [] }));
        expect(mockOpdRepo.addNurseAssignments).not.toHaveBeenCalled();
        expect(mockUserRepo.findById).not.toHaveBeenCalled();
      });

      test('multiple valid nurseIds — all stored on the visit and added to the first doctor\'s mapping', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockOpdRepo.countByDate.mockResolvedValue(0);
        mockOpdRepo.save.mockResolvedValue(makeVisit({ doctorIds: ['doc-1', 'doc-2'] }) as never);
        mockNurse('nurse-1');
        mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

        await service.createVisit(
          't1',
          { ...VALID_CREATE_REQ, doctorIds: ['doc-1', 'doc-2'], nurseIds: ['nurse-1', 'nurse-2'] },
          'user-1', UserRole.HOSPITAL_ADMIN,
        );

        expect(mockOpdRepo.save).toHaveBeenCalledWith(expect.objectContaining({ nurseIds: ['nurse-1', 'nurse-2'] }));
        expect(mockOpdRepo.addNurseAssignments).toHaveBeenCalledWith('t1', 'doc-1', ['nurse-1', 'nurse-2']);
      });

      test('duplicate nurseIds in the request are de-duplicated', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockOpdRepo.countByDate.mockResolvedValue(0);
        mockOpdRepo.save.mockResolvedValue(makeVisit({ doctorIds: ['doc-1'] }) as never);
        mockNurse('nurse-1');
        mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

        await service.createVisit(
          't1',
          { ...VALID_CREATE_REQ, doctorIds: ['doc-1'], nurseIds: ['nurse-1', 'nurse-1'] },
          'user-1', UserRole.HOSPITAL_ADMIN,
        );

        expect(mockOpdRepo.save).toHaveBeenCalledWith(expect.objectContaining({ nurseIds: ['nurse-1'] }));
        expect(mockOpdRepo.addNurseAssignments).toHaveBeenCalledWith('t1', 'doc-1', ['nurse-1']);
      });

      test('nurseIds given but no doctor assigned — visit stores the nurses, no mapping is added', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockOpdRepo.countByDate.mockResolvedValue(0);
        mockOpdRepo.save.mockResolvedValue(makeVisit() as never);
        mockNurse('nurse-1');
        mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

        await service.createVisit('t1', { ...VALID_CREATE_REQ, nurseIds: ['nurse-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN);

        expect(mockOpdRepo.save).toHaveBeenCalledWith(expect.objectContaining({ nurseIds: ['nurse-1'] }));
        expect(mockOpdRepo.addNurseAssignments).not.toHaveBeenCalled();
      });

      test('rejects when any nurseId does not resolve to a user', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockUserRepo.findById.mockResolvedValue(null);

        await expect(
          service.createVisit('t1', { ...VALID_CREATE_REQ, nurseIds: ['ghost'] }, 'user-1', UserRole.HOSPITAL_ADMIN),
        ).rejects.toThrow(ValidationError);
        expect(mockOpdRepo.save).not.toHaveBeenCalled();
      });

      test('rejects when any nurseId belongs to a non-NURSE user', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockUserRepo.findById.mockResolvedValue({ ...NURSE_1, role: UserRole.DOCTOR } as never);

        await expect(
          service.createVisit('t1', { ...VALID_CREATE_REQ, nurseIds: ['nurse-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN),
        ).rejects.toThrow(ValidationError);
      });

      test('rejects an inactive nurse', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockUserRepo.findById.mockResolvedValue({ ...NURSE_1, isActive: false } as never);

        await expect(
          service.createVisit('t1', { ...VALID_CREATE_REQ, nurseIds: ['nurse-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN),
        ).rejects.toThrow(ValidationError);
      });

      test('rejects a nurse currently assigned to an IPD ward', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockUserRepo.findById.mockResolvedValue(NURSE_1 as never);
        mockIpdRepo.findWardIdsByNurse.mockResolvedValue(['ward-1']);

        await expect(
          service.createVisit('t1', { ...VALID_CREATE_REQ, doctorIds: ['doc-1'], nurseIds: ['nurse-1'] }, 'user-1', UserRole.HOSPITAL_ADMIN),
        ).rejects.toThrow(ConflictError);
        expect(mockOpdRepo.save).not.toHaveBeenCalled();
        expect(mockOpdRepo.addNurseAssignments).not.toHaveBeenCalled();
      });

      test('rejects the whole request when one nurse in a multi-nurse selection is invalid', async () => {
        mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
        mockNurse('nurse-1'); // 'nurse-1'/'nurse-2' both resolve to valid nurses; 'ghost' resolves to null.
        mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

        await expect(
          service.createVisit('t1', { ...VALID_CREATE_REQ, doctorIds: ['doc-1'], nurseIds: ['nurse-1', 'nurse-2', 'ghost'] }, 'user-1', UserRole.HOSPITAL_ADMIN),
        ).rejects.toThrow(ValidationError);
        expect(mockOpdRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  // ── updateVisit ────────────────────────────────────────────────────────────
  describe('updateVisit', () => {
    test('updates allowed fields on OPEN visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.OPEN }) as never,
      );

      await service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: 'Viral fever' }, 'doctor-1', UserRole.DOCTOR);

      expect(mockOpdRepo.update).toHaveBeenCalledWith(
        't1', 'OPD-TEST0001',
        expect.objectContaining({ diagnosis: 'Viral fever' }),
        undefined,
      );
    });

    test('updates allowed fields on IN_PROGRESS visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.IN_PROGRESS }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ status: OPDVisitStatus.IN_PROGRESS }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'BP normal' }, 'doctor-1', UserRole.DOCTOR),
      ).resolves.toBeDefined();
    });

    test('throws ConflictError when visit is COMPLETED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.COMPLETED }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: 'Updated' }, 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('throws ConflictError when visit is CANCELLED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.CANCELLED }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Should fail' }, 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    // ── Nurse notes-only edit (assigned-to-visit ownership check) ────────────
    test('a nurse assigned to the visit (nurseIds) can update notes', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Vitals checked' }, 'nurse-1', UserRole.NURSE),
      ).resolves.toBeDefined();

      expect(mockOpdRepo.update).toHaveBeenCalledWith(
        't1', 'OPD-TEST0001',
        expect.objectContaining({ notes: 'Vitals checked' }),
        undefined,
      );
    });

    test('throws NotFoundError when a nurse not listed in the visit\'s nurseIds tries to update it', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Should be blocked' }, 'nurse-2', UserRole.NURSE),
      ).rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    // scopedPatientIds is ward-only (see resolveNursePatientIds); a nurse
    // with no ward assignment at all — an empty scopedPatientIds — must
    // still be able to edit a visit she's directly named on via nurseIds.
    test('a directly-assigned nurse with an empty (ward-only) scopedPatientIds can still update notes', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Vitals checked' }, 'nurse-1', UserRole.NURSE, []),
      ).resolves.toBeDefined();
    });

    // Being directly assigned to a *different* visit for the same patient
    // (patientId-based historical relationship) must never grant access to
    // this one — only this visit's own nurseIds counts.
    test('a nurse assigned to another visit for the same patient cannot update this one', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-2'] }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Should be blocked' }, 'nurse-1', UserRole.NURSE, []),
      ).rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('throws NotFoundError when visit does not exist', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(
        service.updateVisit('t1', 'OPD-MISSING', { diagnosis: 'X' }, 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow(NotFoundError);
    });

    test('updates visitDate and converts string to Date', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.countByDate.mockResolvedValue(2);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-06-01' }, 'doctor-1', UserRole.HOSPITAL_ADMIN);

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.visitDate).toBeInstanceOf(Date);
      expect((updateArg.visitDate as Date).getFullYear()).toBe(2026);
    });

    test('recalculates queueNumber when visitDate changes to a different day', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never); // stored: 2026-05-15
      mockOpdRepo.countByDate.mockResolvedValue(3); // 3 visits already on new date
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-06-01' }, 'doctor-1', UserRole.HOSPITAL_ADMIN);

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.queueNumber).toBe(4); // count+1
      expect(mockOpdRepo.countByDate).toHaveBeenCalled();
    });

    test('does not recalculate queueNumber when visitDate is unchanged', async () => {
      // makeVisit sets visitDate to 2026-05-15
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-05-15' }, 'doctor-1', UserRole.HOSPITAL_ADMIN);

      expect(mockOpdRepo.countByDate).not.toHaveBeenCalled();
      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('queueNumber');
    });

    test('only provided fields are passed to repository update', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Mild fever' }, 'doctor-1', UserRole.DOCTOR);

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).toHaveProperty('notes', 'Mild fever');
      expect(updateArg).not.toHaveProperty('diagnosis');
    });

    // ── department re-resolution on doctor change (revenue mapping fix) ──────
    test('re-resolves departmentId when doctorIds changes', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ doctorIds: ['doc-old'] }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ doctorIds: ['doc-new'] }) as never);
      mockDepartmentSvc.resolveDepartmentFromDoctorIds.mockResolvedValue('DEPT-NEW');

      await service.updateVisit('t1', 'OPD-TEST0001', { doctorIds: ['doc-new'] }, 'admin-1', UserRole.HOSPITAL_ADMIN);

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).toHaveBeenCalledWith('t1', ['doc-new']);
      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.departmentId).toBe('DEPT-NEW');
    });

    test('clears departmentId to null when doctorIds is updated to an empty array', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ doctorIds: ['doc-old'] }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ doctorIds: [] }) as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { doctorIds: [] }, 'admin-1', UserRole.HOSPITAL_ADMIN);

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).toHaveBeenCalledWith('t1', []);
      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.departmentId).toBeNull();
    });

    test('leaves departmentId untouched when doctorIds is not part of the update', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Mild fever' }, 'doctor-1', UserRole.DOCTOR);

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).not.toHaveBeenCalled();
      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('departmentId');
    });

    // ── past-date validation ──────────────────────────────────────────────────
    test('rejects moving visitDate to the past for a normal role', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2020-01-01' }, 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow(ValidationError);
      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2020-01-01' }, 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow('Past dates are not allowed for OPD visits.');

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('allows moving visitDate to the past for an authorized role (HOSPITAL_ADMIN)', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2020-01-01' }, 'admin-1', UserRole.HOSPITAL_ADMIN),
      ).resolves.toBeDefined();
    });

    // ── audit trail for clinical field changes ───────────────────────────────
    test('explicitly clearing a previously-set diagnosis is sent through and audited as [cleared], not [redacted]', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue({ ...makeVisit(), diagnosis: 'Old diagnosis' } as never);
      mockOpdRepo.update.mockResolvedValue({ ...makeVisit(), diagnosis: '' } as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: '' }, 'doctor-1', UserRole.DOCTOR);

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.diagnosis).toBe('');

      const auditArg = mockAuditService.log.mock.calls[0][0];
      expect(auditArg.userId).toBe('doctor-1');
      expect(auditArg.previousValue?.diagnosis).toBe('[redacted]');
      expect(auditArg.newValue?.diagnosis).toBe('[cleared]');
      // The actual clinical text must never appear in the audit entry.
      expect(JSON.stringify(auditArg)).not.toContain('Old diagnosis');
    });

    test('setting a diagnosis for the first time (previously empty) is audited as a plain [redacted] set, not a clear', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never); // diagnosis: null
      mockOpdRepo.update.mockResolvedValue({ ...makeVisit(), diagnosis: 'Viral fever' } as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: 'Viral fever' }, 'doctor-1', UserRole.DOCTOR);

      const auditArg = mockAuditService.log.mock.calls[0][0];
      expect(auditArg.previousValue?.diagnosis).toBeNull();
      expect(auditArg.newValue?.diagnosis).toBe('[redacted]');
    });

    test('resending an unchanged diagnosis is not recorded in the audit diff at all', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue({ ...makeVisit(), diagnosis: 'Same', notes: 'unchanged too' } as never);
      mockOpdRepo.update.mockResolvedValue({ ...makeVisit(), diagnosis: 'Same' } as never);

      // Mirrors the frontend's Edit form, which always resends the current
      // diagnosis/notes value even when the user didn't touch it.
      await service.updateVisit(
        't1', 'OPD-TEST0001', { diagnosis: 'Same', notes: 'unchanged too' }, 'doctor-1', UserRole.DOCTOR,
      );

      // Nothing actually changed, so no audit entry is written at all.
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    test('doctorIds resent unchanged (order-independent) skips department re-resolution, the duplicate check, and the audit diff', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ doctorIds: ['doc-a', 'doc-b'] }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ doctorIds: ['doc-a', 'doc-b'] }) as never);

      // Same set, different order — resending it must not be misreported as
      // a doctor reassignment, nor re-trigger the department/duplicate checks
      // that a genuine reassignment needs.
      await service.updateVisit(
        't1', 'OPD-TEST0001', { doctorIds: ['doc-b', 'doc-a'] }, 'admin-1', UserRole.HOSPITAL_ADMIN,
      );

      expect(mockDepartmentSvc.resolveDepartmentFromDoctorIds).not.toHaveBeenCalled();
      expect(mockOpdRepo.findActiveDuplicate).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });
  });

  // ── startConsultation (nurse direct-assignment guard) ────────────────────────
  describe('startConsultation', () => {
    test('a nurse directly assigned to the visit (nurseIds) can start it', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ nurseIds: ['nurse-1'], status: OPDVisitStatus.IN_PROGRESS }) as never,
      );

      const result = await service.startConsultation('t1', 'OPD-TEST0001', 'nurse-1', UserRole.NURSE);

      expect(result.status).toBe(OPDVisitStatus.IN_PROGRESS);
    });

    test('throws NotFoundError when a nurse not listed in the visit\'s nurseIds tries to start it', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);

      await expect(
        service.startConsultation('t1', 'OPD-TEST0001', 'nurse-2', UserRole.NURSE),
      ).rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    // scopedPatientIds is ward-only (see resolveNursePatientIds); a nurse
    // with no ward assignment but a direct nurseIds match must still pass.
    test('a directly-assigned nurse with an empty (ward-only) scopedPatientIds still starts it', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: ['nurse-1'] }) as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ nurseIds: ['nurse-1'], status: OPDVisitStatus.IN_PROGRESS }) as never,
      );

      await expect(
        service.startConsultation('t1', 'OPD-TEST0001', 'nurse-1', UserRole.NURSE, []),
      ).resolves.toBeDefined();
    });

    // scopedPatientIds allows ward-based access even without a direct
    // nurseIds match — but that's not enough to start a visit, mirroring
    // updateVisit's "view via ward, edit only if directly assigned" split.
    test('a ward-scoped but not directly-assigned nurse cannot start the visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ nurseIds: [] }) as never);

      await expect(
        service.startConsultation('t1', 'OPD-TEST0001', 'nurse-1', UserRole.NURSE, ['PAT-ABCD1234']),
      ).rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('a Doctor can start a visit unaffected by the nurse-only direct-assignment guard', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.IN_PROGRESS }) as never,
      );

      const result = await service.startConsultation('t1', 'OPD-TEST0001', 'doctor-1', UserRole.DOCTOR);

      expect(result.status).toBe(OPDVisitStatus.IN_PROGRESS);
    });

    test('throws NotFoundError when visit does not exist', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(
        service.startConsultation('t1', 'OPD-MISSING', 'doctor-1', UserRole.DOCTOR),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── completeVisit ──────────────────────────────────────────────────────────
  describe('completeVisit', () => {
    test('sets status to COMPLETED and records diagnosis', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.COMPLETED }) as never,
      );

      const result = await service.completeVisit(
        't1', 'OPD-TEST0001', { diagnosis: 'Viral fever, resolved' }, 'doctor-1',
      );

      expect(mockOpdRepo.update).toHaveBeenCalledWith(
        't1', 'OPD-TEST0001',
        expect.objectContaining({ status: OPDVisitStatus.COMPLETED, diagnosis: 'Viral fever, resolved' }),
        undefined,
      );
      expect(result.status).toBe(OPDVisitStatus.COMPLETED);

      const auditArg = mockAuditService.log.mock.calls[0][0];
      expect(auditArg.userId).toBe('doctor-1');
      expect(auditArg.newValue?.diagnosis).toBe('[redacted]');
      expect(JSON.stringify(auditArg)).not.toContain('Viral fever, resolved');
    });

    test('records a prescription supplied at Complete in the audit diff, redacted', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never); // prescription: null
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.COMPLETED }) as never,
      );

      await service.completeVisit(
        't1', 'OPD-TEST0001', { diagnosis: 'Flu', prescription: 'Paracetamol 500mg' }, 'doctor-1',
      );

      const auditArg = mockAuditService.log.mock.calls[0][0];
      expect(auditArg.previousValue?.prescription).toBeNull();
      expect(auditArg.newValue?.prescription).toBe('[redacted]');
      expect(JSON.stringify(auditArg)).not.toContain('Paracetamol');
    });

    test('throws ConflictError when completing an already-COMPLETED visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.COMPLETED }) as never);

      await expect(
        service.completeVisit('t1', 'OPD-TEST0001', { diagnosis: 'Re-complete' }, 'doctor-1'),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('throws ConflictError when completing a CANCELLED visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.CANCELLED }) as never);

      await expect(
        service.completeVisit('t1', 'OPD-TEST0001', { diagnosis: 'X' }, 'doctor-1'),
      ).rejects.toThrow(ConflictError);
    });

    test('throws NotFoundError when visit does not exist', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(
        service.completeVisit('t1', 'OPD-MISSING', { diagnosis: 'X' }, 'doctor-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── cancelVisit ────────────────────────────────────────────────────────────
  describe('cancelVisit', () => {
    test('sets status to CANCELLED on OPEN visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.CANCELLED }) as never,
      );

      const result = await service.cancelVisit('t1', 'OPD-TEST0001', 'rc-1');

      expect(mockOpdRepo.update).toHaveBeenCalledWith(
        't1', 'OPD-TEST0001',
        expect.objectContaining({ status: OPDVisitStatus.CANCELLED }),
        undefined,
      );
      expect(result.status).toBe(OPDVisitStatus.CANCELLED);
    });

    test('throws ConflictError when visit is already COMPLETED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.COMPLETED }) as never);

      await expect(service.cancelVisit('t1', 'OPD-TEST0001', 'rc-1'))
        .rejects.toThrow(ConflictError);
    });

    test('throws ConflictError when visit is already CANCELLED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.CANCELLED }) as never);

      await expect(service.cancelVisit('t1', 'OPD-TEST0001', 'rc-1'))
        .rejects.toThrow(ConflictError);
    });
  });

  // ── getQueue ───────────────────────────────────────────────────────────────
  describe('getQueue', () => {
    test('returns all visits for the date regardless of status', async () => {
      const visits = [
        makeVisit({ visitId: 'OPD-OPEN0001', status: OPDVisitStatus.OPEN }),
        makeVisit({ visitId: 'OPD-INPR0001', status: OPDVisitStatus.IN_PROGRESS }),
        makeVisit({ visitId: 'OPD-DONE0001', status: OPDVisitStatus.COMPLETED }),
        makeVisit({ visitId: 'OPD-CANC0001', status: OPDVisitStatus.CANCELLED }),
      ];
      mockOpdRepo.findByDate.mockResolvedValue(visits as never);

      const queue = await service.getQueue('t1', '2026-05-15');

      expect(queue).toHaveLength(4);
      expect(queue.map((v) => v.visitId)).toEqual([
        'OPD-OPEN0001', 'OPD-INPR0001', 'OPD-DONE0001', 'OPD-CANC0001',
      ]);
    });

    test('returns empty array when no visits exist for the date', async () => {
      mockOpdRepo.findByDate.mockResolvedValue([] as never);

      const queue = await service.getQueue('t1', '2026-05-15');

      expect(queue).toHaveLength(0);
    });

    test('passes doctorId filter to repository', async () => {
      mockOpdRepo.findByDate.mockResolvedValue([]);

      await service.getQueue('t1', '2026-05-15', 'doc-99');

      expect(mockOpdRepo.findByDate).toHaveBeenCalledWith(
        't1',
        expect.any(Date),
        'doc-99',
        undefined,
        undefined,
      );
    });

    test('passes patientIds (ward scope) and nurseId (direct assignment) filters to repository', async () => {
      mockOpdRepo.findByDate.mockResolvedValue([]);

      await service.getQueue('t1', '2026-05-15', undefined, undefined, ['PAT-1'], 'nurse-1');

      expect(mockOpdRepo.findByDate).toHaveBeenCalledWith(
        't1',
        expect.any(Date),
        undefined,
        ['PAT-1'],
        'nurse-1',
      );
    });

    test('defaults to today when no date provided', async () => {
      mockOpdRepo.findByDate.mockResolvedValue([]);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      await service.getQueue('t1');

      const calledDate = (mockOpdRepo.findByDate.mock.calls[0] as unknown[])[1] as Date;
      expect(calledDate.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
    });
  });

  // ── getVisitById ───────────────────────────────────────────────────────────
  describe('getVisitById', () => {
    test('returns visit when found', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);

      const result = await service.getVisitById('t1', 'OPD-TEST0001');

      expect(result.visitId).toBe('OPD-TEST0001');
      expect(mockOpdRepo.findByVisitId).toHaveBeenCalledWith('t1', 'OPD-TEST0001');
    });

    test('throws NotFoundError for unknown visitId', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(service.getVisitById('t1', 'OPD-MISSING')).rejects.toThrow(NotFoundError);
    });

    test('enforces tenant isolation', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(service.getVisitById('other-tenant', 'OPD-TEST0001')).rejects.toThrow(NotFoundError);
      expect(mockOpdRepo.findByVisitId).toHaveBeenCalledWith('other-tenant', 'OPD-TEST0001');
    });
  });

  // ── getPatientHistory ──────────────────────────────────────────────────────
  describe('getPatientHistory', () => {
    const baseFilters = { page: 1, limit: 10 };

    test('returns paginated history for a valid patient', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      const expected = { data: [makeVisit()], total: 1, page: 1, limit: 10, totalPages: 1 };
      mockOpdRepo.findByPatient.mockResolvedValue(expected as never);

      const result = await service.getPatientHistory('t1', 'PAT-ABCD1234', baseFilters);

      expect(result.total).toBe(1);
      expect(mockOpdRepo.findByPatient).toHaveBeenCalledWith('t1', 'PAT-ABCD1234', baseFilters);
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.getPatientHistory('t1', 'PAT-MISSING', baseFilters))
        .rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.findByPatient).not.toHaveBeenCalled();
    });

    test('passes startDate/endDate/status/search filters to repository', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      const expected = { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
      mockOpdRepo.findByPatient.mockResolvedValue(expected as never);

      const filters = { page: 1, limit: 10, startDate: '2026-01-01', endDate: '2026-03-31', status: 'COMPLETED' as const, search: 'fever' };
      await service.getPatientHistory('t1', 'PAT-ABCD1234', filters);

      expect(mockOpdRepo.findByPatient).toHaveBeenCalledWith('t1', 'PAT-ABCD1234', filters);
    });

    test('maps fullName from patient onto each visit in result', async () => {
      const patientWithName = { ...BASE_PATIENT, fullName: 'Ravi Kumar' };
      mockPatientRepo.findByPatientId.mockResolvedValue(patientWithName as never);
      const visit = makeVisit();
      mockOpdRepo.findByPatient.mockResolvedValue({ data: [visit], total: 1, page: 1, limit: 10, totalPages: 1 } as never);

      const result = await service.getPatientHistory('t1', 'PAT-ABCD1234', baseFilters);

      expect(result.data[0].fullName).toBe('Ravi Kumar');
    });
  });

  // ── Role-based access scope resolution ───────────────────────────────────────
  describe('resolveNursePatientIds', () => {
    // Ward-based (IPDService) patients only — direct per-visit assignment
    // (a visit's own nurseIds) is deliberately NOT folded into this
    // patient-level set (see the doc comment on the method). It's enforced
    // separately, at the visit/query level, so a nurse assigned to one visit
    // for a patient never gains visibility into that patient's other,
    // unrelated visits. See opd.routes.test.ts's "Nurse OPD visibility —
    // direct visit assignment" suite for the end-to-end behavior.
    test('delegates to IPDService for ward-based patient scope', async () => {
      mockIpdService.resolveNursePatientIds.mockResolvedValue(['PAT-00001']);

      const result = await service.resolveNursePatientIds('t1', 'nurse-1', UserRole.NURSE);

      expect(result).toEqual(['PAT-00001']);
      expect(mockIpdService.resolveNursePatientIds).toHaveBeenCalledWith('t1', 'nurse-1', UserRole.NURSE);
    });

    test('a nurse with no ward sees an empty list, not undefined', async () => {
      mockIpdService.resolveNursePatientIds.mockResolvedValue([]);

      const result = await service.resolveNursePatientIds('t1', 'nurse-1', UserRole.NURSE);

      expect(result).toEqual([]);
    });

    test('returns undefined for any other role, without querying IPDService', async () => {
      const result = await service.resolveNursePatientIds('t1', 'admin-1', UserRole.HOSPITAL_ADMIN);

      expect(result).toBeUndefined();
      expect(mockIpdService.resolveNursePatientIds).not.toHaveBeenCalled();
    });
  });

  describe('resolveDoctorPatientIds', () => {
    test('delegates to IPDService.resolveDoctorPatientIds', async () => {
      mockIpdService.resolveDoctorPatientIds.mockResolvedValue(['PAT-00002']);

      const result = await service.resolveDoctorPatientIds('t1', 'doc-1', UserRole.DOCTOR);

      expect(result).toEqual(['PAT-00002']);
      expect(mockIpdService.resolveDoctorPatientIds).toHaveBeenCalledWith('t1', 'doc-1', UserRole.DOCTOR);
    });
  });

  describe('resolveMutationScopedPatientIds', () => {
    test('resolves via the nurse path for a NURSE', async () => {
      mockIpdService.resolveNursePatientIds.mockResolvedValue(['PAT-N1']);

      const result = await service.resolveMutationScopedPatientIds('t1', 'nurse-1', UserRole.NURSE);

      expect(result).toEqual(['PAT-N1']);
      expect(mockIpdService.resolveDoctorPatientIds).not.toHaveBeenCalled();
    });

    test('resolves via the doctor path for a DOCTOR', async () => {
      mockIpdService.resolveDoctorPatientIds.mockResolvedValue(['PAT-D1']);

      const result = await service.resolveMutationScopedPatientIds('t1', 'doc-1', UserRole.DOCTOR);

      expect(result).toEqual(['PAT-D1']);
      expect(mockIpdService.resolveNursePatientIds).not.toHaveBeenCalled();
    });

    test('returns undefined for any other role, without calling IPDService', async () => {
      const result = await service.resolveMutationScopedPatientIds('t1', 'admin-1', UserRole.HOSPITAL_ADMIN);

      expect(result).toBeUndefined();
      expect(mockIpdService.resolveNursePatientIds).not.toHaveBeenCalled();
      expect(mockIpdService.resolveDoctorPatientIds).not.toHaveBeenCalled();
    });
  });

  // ── getPaymentValidity ─────────────────────────────────────────────────────
  describe('getPaymentValidity', () => {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Offsets from "now" rather than fixed dates, so the comparison against
    // the service's internal "today" always lands on the intended side of the
    // validity boundary regardless of when the suite runs.
    function daysAgo(n: number): Date {
      return new Date(Date.now() - n * MS_PER_DAY);
    }

    function makePayment(overrides: Partial<{ paymentId: string; createdAt: Date }> = {}) {
      return {
        paymentId: overrides.paymentId ?? 'pay-1',
        tenantId:  't1',
        patientId: 'PAT-ABCD1234',
        createdAt: overrides.createdAt ?? daysAgo(0),
      };
    }

    beforeEach(() => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
    });

    test('throws NotFoundError when the patient does not exist', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null as never);

      await expect(service.getPaymentValidity('t1', 'PAT-MISSING')).rejects.toThrow(NotFoundError);
    });

    test('NO_PAYMENT — patient has no completed OPD payment', async () => {
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType.mockResolvedValue(null as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result).toMatchObject({
        paymentRequired:   true,
        reason:            OPDPaymentValidityReason.NO_PAYMENT,
        latestPaymentId:   null,
        latestPaymentDate: null,
        validUntil:        null,
        validityDays:      15,
      });
      expect(mockPaymentRepo.findLatestCompletedByPatientAndReferenceType)
        .toHaveBeenCalledWith('t1', 'PAT-ABCD1234', 'OPD_VISIT');
    });

    test('VALID — latest payment is well within the configured validity window', async () => {
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ createdAt: daysAgo(5) }) as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
      expect(result.paymentRequired).toBe(false);
    });

    test('EXPIRED — latest payment is well past the configured validity window', async () => {
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ createdAt: daysAgo(20) }) as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result.reason).toBe(OPDPaymentValidityReason.EXPIRED);
      expect(result.paymentRequired).toBe(true);
    });

    test('boundary — payment made exactly validityDays ago is still VALID (inclusive)', async () => {
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ createdAt: daysAgo(15) }) as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
      expect(result.paymentRequired).toBe(false);
    });

    test('boundary — the day after validityDays has elapsed is EXPIRED', async () => {
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ createdAt: daysAgo(16) }) as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result.reason).toBe(OPDPaymentValidityReason.EXPIRED);
      expect(result.paymentRequired).toBe(true);
    });

    test('configurable validity — the same payment age can be VALID or EXPIRED depending on the tenant setting', async () => {
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ createdAt: daysAgo(5) }) as never);

      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 3 });
      const expired = await service.getPaymentValidity('t1', 'PAT-ABCD1234');
      expect(expired.reason).toBe(OPDPaymentValidityReason.EXPIRED);

      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 10 });
      const valid = await service.getPaymentValidity('t1', 'PAT-ABCD1234');
      expect(valid.reason).toBe(OPDPaymentValidityReason.VALID);
    });

    test('multiple payments — only the repository-resolved latest COMPLETED payment governs validity', async () => {
      // The repository is responsible for the "latest" resolution (sorted by
      // createdAt desc); the service must not re-sort or second-guess it.
      mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
      mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
        .mockResolvedValue(makePayment({ paymentId: 'pay-latest', createdAt: daysAgo(1) }) as never);

      const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234');

      expect(result.latestPaymentId).toBe('pay-latest');
      expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
    });

    // ── doctor-specific validity ─────────────────────────────────────────────
    describe('doctor-specific validity', () => {
      test('doctorIds given — delegates to the doctor-scoped repository lookup, not the patient-wide one', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType
          .mockResolvedValue(makePayment({ createdAt: daysAgo(5) }) as never);

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', ['doc-1']);

        expect(mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType)
          .toHaveBeenCalledWith('t1', 'PAT-ABCD1234', ['doc-1'], 'OPD_VISIT');
        expect(mockPaymentRepo.findLatestCompletedByPatientAndReferenceType).not.toHaveBeenCalled();
        expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
      });

      test('VALID — same doctor, payment within the validity window', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType
          .mockResolvedValue(makePayment({ createdAt: daysAgo(5) }) as never);

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', ['doc-1']);

        expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
        expect(result.paymentRequired).toBe(false);
      });

      test('EXPIRED — same doctor, payment past the validity window', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType
          .mockResolvedValue(makePayment({ createdAt: daysAgo(20) }) as never);

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', ['doc-1']);

        expect(result.reason).toBe(OPDPaymentValidityReason.EXPIRED);
        expect(result.paymentRequired).toBe(true);
      });

      test('DIFFERENT_DOCTOR — no payment for the requested doctor, but the patient has a completed OPD payment for another doctor', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType.mockResolvedValue(null as never);
        mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
          .mockResolvedValue(makePayment({ createdAt: daysAgo(1) }) as never); // still valid for the *other* doctor

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', ['doc-2']);

        expect(result.reason).toBe(OPDPaymentValidityReason.DIFFERENT_DOCTOR);
        expect(result.paymentRequired).toBe(true);
        expect(result.latestPaymentId).toBeNull();
        expect(result.validUntil).toBeNull();
      });

      test('NO_PAYMENT — doctorIds given, but the patient has never made any completed OPD payment', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType.mockResolvedValue(null as never);
        mockPaymentRepo.findLatestCompletedByPatientAndReferenceType.mockResolvedValue(null as never);

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', ['doc-1']);

        expect(result.reason).toBe(OPDPaymentValidityReason.NO_PAYMENT);
        expect(result.paymentRequired).toBe(true);
      });

      test('no doctorIds (none selected yet) — falls back to the patient-wide check, matching pre-selection UI state', async () => {
        mockTenantSvc.getOpdSettings.mockResolvedValue({ validityDays: 15 });
        mockPaymentRepo.findLatestCompletedByPatientAndReferenceType
          .mockResolvedValue(makePayment({ createdAt: daysAgo(5) }) as never);

        const result = await service.getPaymentValidity('t1', 'PAT-ABCD1234', []);

        expect(mockPaymentRepo.findLatestCompletedByPatientDoctorsAndReferenceType).not.toHaveBeenCalled();
        expect(result.reason).toBe(OPDPaymentValidityReason.VALID);
      });
    });
  });

  // ── getAvailableOpdNurses ──────────────────────────────────────────────────
  describe('getAvailableOpdNurses', () => {
    test('excludes nurses currently on any ward roster', async () => {
      mockUserRepo.findAll.mockResolvedValue({
        data: [
          { _id: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' },
          { _id: 'nurse-2', name: 'Nurse PQR', email: 'pqr@h.com' },
        ],
        total: 2, page: 1, limit: 500, totalPages: 1,
      } as never);
      mockIpdRepo.findAssignedNurseIds.mockResolvedValue(['nurse-2']);

      const result = await service.getAvailableOpdNurses('t1');

      expect(result).toEqual([{ userId: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' }]);
      expect(mockUserRepo.findAll).toHaveBeenCalledWith(
        't1', { role: UserRole.NURSE, isActive: true }, 1, 500,
      );
    });

    test('returns an empty list when every nurse is on IPD duty', async () => {
      mockUserRepo.findAll.mockResolvedValue({
        data: [{ _id: 'nurse-1', name: 'Nurse XYZ', email: 'xyz@h.com' }],
        total: 1, page: 1, limit: 500, totalPages: 1,
      } as never);
      mockIpdRepo.findAssignedNurseIds.mockResolvedValue(['nurse-1']);

      const result = await service.getAvailableOpdNurses('t1');

      expect(result).toEqual([]);
    });
  });

  // ── getDoctorNurseAssignments ──────────────────────────────────────────────
  describe('getDoctorNurseAssignments', () => {
    test('returns an empty nurses list when the doctor has no existing mapping', async () => {
      mockOpdRepo.findNurseAssignmentsByDoctor.mockResolvedValue([]);

      const result = await service.getDoctorNurseAssignments('t1', 'doc-1');

      expect(result).toEqual({ doctorId: 'doc-1', nurses: [] });
      expect(mockUserRepo.findNamesByIds).not.toHaveBeenCalled();
    });

    test('returns every mapped nurse, each with isAvailable=true when not on any ward', async () => {
      mockOpdRepo.findNurseAssignmentsByDoctor.mockResolvedValue([
        { tenantId: 't1', doctorId: 'doc-1', nurseId: 'nurse-1' },
        { tenantId: 't1', doctorId: 'doc-1', nurseId: 'nurse-2' },
      ] as never);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map([
        ['nurse-1', 'Nurse XYZ'],
        ['nurse-2', 'Nurse PQR'],
      ]));
      mockIpdRepo.findAssignedNurseIds.mockResolvedValue([]);

      const result = await service.getDoctorNurseAssignments('t1', 'doc-1');

      expect(result).toEqual({
        doctorId: 'doc-1',
        nurses: [
          { nurseId: 'nurse-1', nurseName: 'Nurse XYZ', isAvailable: true },
          { nurseId: 'nurse-2', nurseName: 'Nurse PQR', isAvailable: true },
        ],
      });
    });

    test('flags isAvailable=false per-nurse for whichever mapped nurse is now on an IPD ward', async () => {
      mockOpdRepo.findNurseAssignmentsByDoctor.mockResolvedValue([
        { tenantId: 't1', doctorId: 'doc-1', nurseId: 'nurse-1' },
        { tenantId: 't1', doctorId: 'doc-1', nurseId: 'nurse-2' },
      ] as never);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map([
        ['nurse-1', 'Nurse XYZ'],
        ['nurse-2', 'Nurse PQR'],
      ]));
      mockIpdRepo.findAssignedNurseIds.mockResolvedValue(['nurse-2']);

      const result = await service.getDoctorNurseAssignments('t1', 'doc-1');

      expect(result.nurses).toEqual([
        { nurseId: 'nurse-1', nurseName: 'Nurse XYZ', isAvailable: true },
        { nurseId: 'nurse-2', nurseName: 'Nurse PQR', isAvailable: false },
      ]);
    });
  });
});
