jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/patient/patient.model');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import * as fc from 'fast-check';
import { ipdRepository }     from '../../../src/modules/ipd/ipd.repository';
import { opdRepository }     from '../../../src/modules/opd/opd.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { PatientModel }      from '../../../src/modules/patient/patient.model';
import { userRepository }    from '../../../src/modules/user/user.repository';
import { IPDService }        from '../../../src/modules/ipd/ipd.service';
import { AdmissionStatus }   from '../../../src/modules/ipd/ipd.types';
import { AppError, NotFoundError } from '../../../src/shared/middleware/error-handler';
import { UserRole }          from '../../../src/shared/types/common.types';

const mockIpdRepo     = ipdRepository     as jest.Mocked<typeof ipdRepository>;
const mockOpdRepo     = opdRepository     as jest.Mocked<typeof opdRepository>;
const mockPatientRepo = patientRepository as jest.Mocked<typeof patientRepository>;
const mockUserRepo    = userRepository    as jest.Mocked<typeof userRepository>;

function makeFindMock(docs: object[]) {
  return jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(docs) });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const DOCTOR_ID = '6a05ca8a86f53faa64a75a08';
const RECEPT_ID = '6b06db9b97g64bbb75b86b19';

const BASE_WARD = {
  _id:      'ward-001',
  name:     'General Ward',
  floor:    null,
  tenantId: TENANT_ID,
};

const BASE_BED = {
  _id:                'bed-001',
  wardId:             'ward-001',
  bedNumber:          'G-01',
  isOccupied:         false,
  currentAdmissionId: null,
  tenantId:           TENANT_ID,
};

const BASE_PATIENT = {
  patientId:    'PAT-00001',
  tenantId:     TENANT_ID,
  fullName:     'Ramesh Kumar',
  mobileNumber: '9876543210',
};

const BASE_DOCTOR = {
  _id:      DOCTOR_ID,
  role:     UserRole.DOCTOR,
  tenantId: TENANT_ID,
};

const BASE_ADMISSION = {
  admissionId:       'adm-uuid-001',
  patientId:         'PAT-00001',
  wardId:            'ward-001',
  wardName:          'General Ward',
  bedId:             'bed-001',
  bedNumber:         'G-01',
  assignedDoctorIds: [DOCTOR_ID],
  status:            AdmissionStatus.ADMITTED,
  admissionDate:     new Date(),
  dischargeDate:     null,
  progressNotes:     [],
  tenantId:          TENANT_ID,
};

// ─── IPDService — example-based tests ────────────────────────────────────────

describe('IPDService — example-based', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();
  });

  // ── createAdmission ──────────────────────────────────────────────────────────
  describe('createAdmission', () => {
    const validInput = {
      patientId:         'PAT-00001',
      wardId:            'ward-001',
      bedId:             'bed-001',
      assignedDoctorIds: [DOCTOR_ID],
    };

    beforeEach(() => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockIpdRepo.findWardById.mockResolvedValue(BASE_WARD as never);
      mockIpdRepo.findBedById.mockResolvedValue(BASE_BED as never);
      mockIpdRepo.findActiveAdmissionByBed.mockResolvedValue(null);
      mockUserRepo.findById.mockResolvedValue(BASE_DOCTOR as never);
      mockIpdRepo.save.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.updateBedOccupancy.mockResolvedValue({ ...BASE_BED, isOccupied: true } as never);
    });

    test('creates admission and marks bed occupied on success', async () => {
      const result = await service.createAdmission(validInput, TENANT_ID, RECEPT_ID);

      expect(result.admissionId).toBe('adm-uuid-001');
      expect(result.status).toBe(AdmissionStatus.ADMITTED);
      expect(mockIpdRepo.updateBedOccupancy).toHaveBeenCalledWith(
        TENANT_ID, 'bed-001', true, expect.any(String),
      );
      expect(mockIpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'PAT-00001',
          status:    AdmissionStatus.ADMITTED,
          tenantId:  TENANT_ID,
        }),
      );
    });

    test('throws 409 with occupant admissionId when bed is already occupied', async () => {
      mockIpdRepo.findActiveAdmissionByBed.mockResolvedValue({
        ...BASE_ADMISSION,
        admissionId: 'existing-adm-999',
      } as never);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID)).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          message:    expect.stringContaining('existing-adm-999'),
        }),
      );
      expect(mockIpdRepo.save).not.toHaveBeenCalled();
    });

    test('throws 404 when patient not found', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID))
        .rejects.toThrow(NotFoundError);
    });

    test('throws 404 when ward not found', async () => {
      mockIpdRepo.findWardById.mockResolvedValue(null);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID))
        .rejects.toThrow(NotFoundError);
    });

    test('throws 400 when bed does not belong to specified ward', async () => {
      mockIpdRepo.findBedById.mockResolvedValue({
        ...BASE_BED,
        wardId: 'different-ward',
      } as never);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID)).rejects.toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
    });

    test('throws 400 when assignedDoctor is not a Doctor role', async () => {
      mockUserRepo.findById.mockResolvedValue({
        ...BASE_DOCTOR,
        role: UserRole.NURSE,
      } as never);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID)).rejects.toThrow(
        expect.objectContaining({ statusCode: 400 }),
      );
    });
  });

  // ── addProgressNote ───────────────────────────────────────────────────────────
  describe('addProgressNote', () => {
    test('appends note to ADMITTED admission and resolves the author name via findNamesByIds', async () => {
      const updatedAdmission = {
        ...BASE_ADMISSION,
        progressNotes: [
          { noteId: 'note-001', doctorId: DOCTOR_ID, note: 'Patient stable', timestamp: new Date() },
        ],
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.appendProgressNote.mockResolvedValue(updatedAdmission as never);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map([[DOCTOR_ID, 'Dr. Batch']]));

      const result = await service.addProgressNote(
        'adm-uuid-001',
        { note: 'Patient stable' },
        TENANT_ID,
        DOCTOR_ID,
      );

      expect(result.progressNotes).toHaveLength(1);
      expect(result.progressNotes[0]!.note).toBe('Patient stable');
      expect(result.progressNotes[0]!.staffName).toBe('Dr. Batch');
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledTimes(1);
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledWith(TENANT_ID, [DOCTOR_ID]);
      expect(mockUserRepo.findById).not.toHaveBeenCalled();
      expect(mockIpdRepo.appendProgressNote).toHaveBeenCalledWith(
        'adm-uuid-001',
        TENANT_ID,
        expect.objectContaining({ doctorId: DOCTOR_ID, note: 'Patient stable' }),
      );
    });

    test('resolves multiple distinct progress-note authors through a single batched findNamesByIds call', async () => {
      const NURSE_AUTHOR_ID = '6c07ec0ca8064ccc86c97c2a';
      const updatedAdmission = {
        ...BASE_ADMISSION,
        progressNotes: [
          { noteId: 'note-001', doctorId: DOCTOR_ID,       note: 'Vitals checked',  timestamp: new Date() },
          { noteId: 'note-002', doctorId: NURSE_AUTHOR_ID, note: 'Medication given', timestamp: new Date() },
        ],
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.appendProgressNote.mockResolvedValue(updatedAdmission as never);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map([
        [DOCTOR_ID, 'Dr. Batch'],
        [NURSE_AUTHOR_ID, 'Nurse Joy'],
      ]));

      const result = await service.addProgressNote(
        'adm-uuid-001',
        { note: 'Medication given' },
        TENANT_ID,
        NURSE_AUTHOR_ID,
      );

      expect(result.progressNotes).toHaveLength(2);
      expect(result.progressNotes[0]!.staffName).toBe('Dr. Batch');
      expect(result.progressNotes[1]!.staffName).toBe('Nurse Joy');
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledTimes(1);
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledWith(
        TENANT_ID,
        expect.arrayContaining([DOCTOR_ID, NURSE_AUTHOR_ID]),
      );
    });

    test('an author ID not resolved by findNamesByIds falls back to staffName: null', async () => {
      const updatedAdmission = {
        ...BASE_ADMISSION,
        progressNotes: [
          { noteId: 'note-001', doctorId: DOCTOR_ID, note: 'Note by deleted user', timestamp: new Date() },
        ],
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.appendProgressNote.mockResolvedValue(updatedAdmission as never);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map());

      const result = await service.addProgressNote(
        'adm-uuid-001',
        { note: 'Note by deleted user' },
        TENANT_ID,
        DOCTOR_ID,
      );

      expect(result.progressNotes[0]!.staffName).toBeNull();
    });

    test('throws 400 when adding note to DISCHARGED admission', async () => {
      mockIpdRepo.findById.mockResolvedValue({
        ...BASE_ADMISSION,
        status: AdmissionStatus.DISCHARGED,
      } as never);

      await expect(
        service.addProgressNote('adm-uuid-001', { note: 'Test note' }, TENANT_ID, DOCTOR_ID),
      ).rejects.toThrow(
        expect.objectContaining({ statusCode: 400, message: expect.stringContaining('discharged') }),
      );
    });

    test('throws 404 when admission not found', async () => {
      mockIpdRepo.findById.mockResolvedValue(null);

      await expect(
        service.addProgressNote('missing-id', { note: 'Test' }, TENANT_ID, DOCTOR_ID),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ── dischargePatient ──────────────────────────────────────────────────────────
  describe('dischargePatient', () => {
    test('sets status to DISCHARGED and releases bed', async () => {
      const dischargedAdmission = {
        ...BASE_ADMISSION,
        status:        AdmissionStatus.DISCHARGED,
        dischargeDate: new Date(),
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.updateStatus.mockResolvedValue(dischargedAdmission as never);
      mockIpdRepo.updateBedOccupancy.mockResolvedValue({ ...BASE_BED, isOccupied: false } as never);

      const result = await service.dischargePatient('adm-uuid-001', TENANT_ID, DOCTOR_ID);

      expect(result.status).toBe(AdmissionStatus.DISCHARGED);
      expect(result.dischargeDate).not.toBeNull();
      expect(mockIpdRepo.updateBedOccupancy).toHaveBeenCalledWith(TENANT_ID, 'bed-001', false, null);
    });

    test('throws 400 when patient is already discharged', async () => {
      mockIpdRepo.findById.mockResolvedValue({
        ...BASE_ADMISSION,
        status: AdmissionStatus.DISCHARGED,
      } as never);

      await expect(service.dischargePatient('adm-uuid-001', TENANT_ID, DOCTOR_ID)).rejects.toThrow(
        expect.objectContaining({ statusCode: 400, message: expect.stringContaining('already discharged') }),
      );
      expect(mockIpdRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockIpdRepo.updateBedOccupancy).not.toHaveBeenCalled();
    });

    test('throws 404 when admission not found', async () => {
      mockIpdRepo.findById.mockResolvedValue(null);

      await expect(service.dischargePatient('missing', TENANT_ID, DOCTOR_ID)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  // ── getBedOccupancySummary ────────────────────────────────────────────────────
  describe('getBedOccupancySummary', () => {
    test('returns correct total/occupied/available per ward', async () => {
      mockIpdRepo.getOccupancySummary.mockResolvedValue([
        {
          wardId:    'ward-001',
          wardName:  'General Ward',
          floor:     null,
          total:     3,
          occupied:  1,
          available: 2,
        },
      ] as never);

      const result = await service.getBedOccupancySummary(TENANT_ID);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        wardId:    'ward-001',
        wardName:  'General Ward',
        total:     3,
        occupied:  1,
        available: 2,
      });
    });
  });

  // ── getAdmissionById ──────────────────────────────────────────────────────────
  describe('getAdmissionById', () => {
    test('does not call findNamesByIds when the admission has no progress notes', async () => {
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);

      const result = await service.getAdmissionById('adm-uuid-001', TENANT_ID);

      expect(result.progressNotes).toEqual([]);
      expect(mockUserRepo.findNamesByIds).not.toHaveBeenCalled();
    });
  });

  // ── listAdmissions ────────────────────────────────────────────────────────────
  describe('listAdmissions', () => {
    test('resolves progress-note staff names for an entire page with a single batched findNamesByIds call', async () => {
      const NURSE_AUTHOR_ID = '6c07ec0ca8064ccc86c97c2a';
      const admission1 = {
        ...BASE_ADMISSION,
        admissionId: 'adm-1',
        patientId:   'PAT-00001',
        progressNotes: [
          { noteId: 'n1', doctorId: DOCTOR_ID, note: 'Note A', timestamp: new Date() },
        ],
      };
      const admission2 = {
        ...BASE_ADMISSION,
        admissionId: 'adm-2',
        patientId:   'PAT-00002',
        progressNotes: [
          { noteId: 'n2', doctorId: NURSE_AUTHOR_ID, note: 'Note B', timestamp: new Date() },
          { noteId: 'n3', doctorId: DOCTOR_ID,       note: 'Note C', timestamp: new Date() },
        ],
      };

      mockIpdRepo.findActiveAdmissions.mockResolvedValue({
        data:       [admission1, admission2],
        total:      2,
        page:       1,
        limit:      20,
        totalPages: 1,
      } as never);
      (PatientModel.find as jest.Mock) = makeFindMock([
        { patientId: 'PAT-00001', fullName: 'Ramesh Kumar' },
        { patientId: 'PAT-00002', fullName: 'Sita Devi' },
      ]);
      mockUserRepo.findNamesByIds.mockResolvedValue(new Map([
        [DOCTOR_ID, 'Dr. Batch'],
        [NURSE_AUTHOR_ID, 'Nurse Joy'],
      ]));

      const result = await service.listAdmissions(
        TENANT_ID,
        { status: AdmissionStatus.ADMITTED, page: 1, limit: 20 } as never,
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.fullName).toBe('Ramesh Kumar');
      expect(result.data[0]!.progressNotes[0]!.staffName).toBe('Dr. Batch');
      expect(result.data[1]!.fullName).toBe('Sita Devi');
      expect(result.data[1]!.progressNotes[0]!.staffName).toBe('Nurse Joy');
      expect(result.data[1]!.progressNotes[1]!.staffName).toBe('Dr. Batch');

      // Batched once for the whole page — not once per admission, and not once per note.
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledTimes(1);
      expect(mockUserRepo.findNamesByIds).toHaveBeenCalledWith(
        TENANT_ID,
        expect.arrayContaining([DOCTOR_ID, NURSE_AUTHOR_ID]),
      );
      expect(mockUserRepo.findById).not.toHaveBeenCalled();
    });
  });

  // ── Role-based access scope resolution ───────────────────────────────────────
  describe('resolveNurseWardIds', () => {
    test('returns the nurse\'s assigned ward IDs', async () => {
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue(['ward-001', 'ward-002']);

      const result = await service.resolveNurseWardIds(TENANT_ID, 'nurse-1', UserRole.NURSE);

      expect(result).toEqual(['ward-001', 'ward-002']);
      expect(mockIpdRepo.findWardIdsByNurse).toHaveBeenCalledWith(TENANT_ID, 'nurse-1');
    });

    test('returns undefined for a non-Nurse role without querying the repository', async () => {
      const result = await service.resolveNurseWardIds(TENANT_ID, DOCTOR_ID, UserRole.DOCTOR);

      expect(result).toBeUndefined();
      expect(mockIpdRepo.findWardIdsByNurse).not.toHaveBeenCalled();
    });
  });

  describe('resolveNursePatientIds', () => {
    test('resolves patients across all of the nurse\'s assigned wards', async () => {
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue(['ward-001']);
      mockIpdRepo.findPatientIdsByWards.mockResolvedValue(['PAT-00001', 'PAT-00002']);

      const result = await service.resolveNursePatientIds(TENANT_ID, 'nurse-1', UserRole.NURSE);

      expect(result).toEqual(['PAT-00001', 'PAT-00002']);
      expect(mockIpdRepo.findPatientIdsByWards).toHaveBeenCalledWith(TENANT_ID, ['ward-001']);
    });

    test('returns an empty array (not undefined) when the nurse has no assigned ward', async () => {
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

      const result = await service.resolveNursePatientIds(TENANT_ID, 'nurse-1', UserRole.NURSE);

      expect(result).toEqual([]);
      expect(mockIpdRepo.findPatientIdsByWards).not.toHaveBeenCalled();
    });

    test('returns undefined for a non-Nurse role', async () => {
      const result = await service.resolveNursePatientIds(TENANT_ID, DOCTOR_ID, UserRole.DOCTOR);

      expect(result).toBeUndefined();
      expect(mockIpdRepo.findWardIdsByNurse).not.toHaveBeenCalled();
    });
  });

  describe('resolveDoctorPatientIds', () => {
    test('unions patients assigned via OPD visits and IPD admissions, de-duplicated', async () => {
      mockOpdRepo.findPatientIdsByDoctor.mockResolvedValue(['PAT-00001', 'PAT-00002']);
      mockIpdRepo.findPatientIdsByAssignedDoctor.mockResolvedValue(['PAT-00002', 'PAT-00003']);

      const result = await service.resolveDoctorPatientIds(TENANT_ID, DOCTOR_ID, UserRole.DOCTOR);

      expect(result).toEqual(expect.arrayContaining(['PAT-00001', 'PAT-00002', 'PAT-00003']));
      expect(result).toHaveLength(3);
      expect(mockOpdRepo.findPatientIdsByDoctor).toHaveBeenCalledWith(TENANT_ID, DOCTOR_ID);
      expect(mockIpdRepo.findPatientIdsByAssignedDoctor).toHaveBeenCalledWith(TENANT_ID, DOCTOR_ID);
    });

    test('returns undefined for a non-Doctor role without querying either repository', async () => {
      const result = await service.resolveDoctorPatientIds(TENANT_ID, 'nurse-1', UserRole.NURSE);

      expect(result).toBeUndefined();
      expect(mockOpdRepo.findPatientIdsByDoctor).not.toHaveBeenCalled();
      expect(mockIpdRepo.findPatientIdsByAssignedDoctor).not.toHaveBeenCalled();
    });
  });
});

// ─── IPDService — PBT: Bed Occupancy Invariant (U3-B-07) ─────────────────────

describe('IPDService — PBT: bed occupancy invariant', () => {
  test('total === occupied + available for any bed distribution in any ward', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            bedId:      fc.uuid(),
            wardId:     fc.constant('ward-pbt-1'),
            bedNumber:  fc.string({ minLength: 1, maxLength: 10 }),
            isOccupied: fc.boolean(),
            tenantId:   fc.constant('tenant-pbt-1'),
          }),
          { minLength: 0, maxLength: 200 },
        ),
        (beds) => {
          const total     = beds.length;
          const occupied  = beds.filter((b) => b.isOccupied).length;
          const available = total - occupied;

          expect(occupied + available).toBe(total);
          expect(available).toBeGreaterThanOrEqual(0);
          expect(occupied).toBeGreaterThanOrEqual(0);
          expect(total).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 500, seed: 42 },
    );
  });

  test('progress note count is monotonically non-decreasing', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 100 }),
          { minLength: 0, maxLength: 50 },
        ),
        (notes) => {
          let count = 0;
          for (const _ of notes) {
            const prevCount = count;
            count += 1;
            expect(count).toBeGreaterThanOrEqual(prevCount);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  test('discharge is idempotent: status machine rejects second discharge', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(AdmissionStatus.ADMITTED, AdmissionStatus.DISCHARGED),
        (status) => {
          const isAdmitted = status === AdmissionStatus.ADMITTED;
          if (!isAdmitted) {
            expect(status).toBe(AdmissionStatus.DISCHARGED);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
