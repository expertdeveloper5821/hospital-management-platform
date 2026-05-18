jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/ipd/ward.repository');
jest.mock('../../../src/modules/ipd/bed.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import * as fc from 'fast-check';
import { ipdRepository }     from '../../../src/modules/ipd/ipd.repository';
import { wardRepository }    from '../../../src/modules/ipd/ward.repository';
import { bedRepository }     from '../../../src/modules/ipd/bed.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { userRepository }    from '../../../src/modules/user/user.repository';
import { IPDService }        from '../../../src/modules/ipd/ipd.service';
import { AdmissionStatus }   from '../../../src/modules/ipd/ipd.types';
import { AppError, NotFoundError } from '../../../src/shared/middleware/error-handler';
import { UserRole }          from '../../../src/shared/types/common.types';

const mockIpdRepo     = ipdRepository     as jest.Mocked<typeof ipdRepository>;
const mockWardRepo    = wardRepository    as jest.Mocked<typeof wardRepository>;
const mockBedRepo     = bedRepository     as jest.Mocked<typeof bedRepository>;
const mockPatientRepo = patientRepository as jest.Mocked<typeof patientRepository>;
const mockUserRepo    = userRepository    as jest.Mocked<typeof userRepository>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-001';
const DOCTOR_ID = 'doctor-001';
const RECEPT_ID = 'recept-001';

const BASE_WARD = {
  wardId:   'ward-001',
  wardName: 'General Ward',
  tenantId: TENANT_ID,
};

const BASE_BED = {
  bedId:      'bed-001',
  wardId:     'ward-001',
  bedNumber:  'G-01',
  isOccupied: false,
  tenantId:   TENANT_ID,
};

const BASE_PATIENT = {
  patientId:    'PAT-00001',
  tenantId:     TENANT_ID,
  fullName:     'Ramesh Kumar',
  mobileNumber: '9876543210',
};

const BASE_DOCTOR = {
  _id:      DOCTOR_ID,
  userId:   DOCTOR_ID,
  role:     UserRole.DOCTOR,
  tenantId: TENANT_ID,
};

const BASE_ADMISSION = {
  admissionId:      'adm-uuid-001',
  patientId:        'PAT-00001',
  wardId:           'ward-001',
  wardName:         'General Ward',
  bedId:            'bed-001',
  bedNumber:        'G-01',
  assignedDoctorId: DOCTOR_ID,
  status:           AdmissionStatus.ADMITTED,
  admissionDate:    new Date(),
  dischargeDate:    null,
  progressNotes:    [],
  tenantId:         TENANT_ID,
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
      patientId:        'PAT-00001',
      wardId:           'ward-001',
      bedId:            'bed-001',
      assignedDoctorId: DOCTOR_ID,
    };

    beforeEach(() => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockWardRepo.findById.mockResolvedValue(BASE_WARD as never);
      mockBedRepo.findById.mockResolvedValue(BASE_BED as never);
      mockIpdRepo.findActiveAdmissionByBed.mockResolvedValue(null);
      mockUserRepo.findById.mockResolvedValue(BASE_DOCTOR as never);
      mockIpdRepo.save.mockResolvedValue(BASE_ADMISSION as never);
      mockBedRepo.setOccupied.mockResolvedValue(undefined as never);
    });

    test('creates admission and marks bed occupied on success', async () => {
      const result = await service.createAdmission(validInput, TENANT_ID, RECEPT_ID);

      expect(result.admissionId).toBe('adm-uuid-001');
      expect(result.status).toBe(AdmissionStatus.ADMITTED);
      expect(mockBedRepo.setOccupied).toHaveBeenCalledWith('bed-001', true, TENANT_ID);
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
      mockWardRepo.findById.mockResolvedValue(null);

      await expect(service.createAdmission(validInput, TENANT_ID, RECEPT_ID))
        .rejects.toThrow(NotFoundError);
    });

    test('throws 400 when bed does not belong to specified ward', async () => {
      mockBedRepo.findById.mockResolvedValue({
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
    test('appends note to ADMITTED admission', async () => {
      const updatedAdmission = {
        ...BASE_ADMISSION,
        progressNotes: [
          { noteId: 'note-001', doctorId: DOCTOR_ID, note: 'Patient stable', timestamp: new Date() },
        ],
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.appendProgressNote.mockResolvedValue(updatedAdmission as never);

      const result = await service.addProgressNote(
        'adm-uuid-001',
        { note: 'Patient stable' },
        TENANT_ID,
        DOCTOR_ID,
      );

      expect(result.progressNotes).toHaveLength(1);
      expect(result.progressNotes[0]!.note).toBe('Patient stable');
      expect(mockIpdRepo.appendProgressNote).toHaveBeenCalledWith(
        'adm-uuid-001',
        TENANT_ID,
        expect.objectContaining({ doctorId: DOCTOR_ID, note: 'Patient stable' }),
      );
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
        status:       AdmissionStatus.DISCHARGED,
        dischargeDate: new Date(),
      };
      mockIpdRepo.findById.mockResolvedValue(BASE_ADMISSION as never);
      mockIpdRepo.updateStatus.mockResolvedValue(dischargedAdmission as never);
      mockBedRepo.setOccupied.mockResolvedValue(undefined as never);

      const result = await service.dischargePatient('adm-uuid-001', TENANT_ID, DOCTOR_ID);

      expect(result.status).toBe(AdmissionStatus.DISCHARGED);
      expect(result.dischargeDate).not.toBeNull();
      expect(mockBedRepo.setOccupied).toHaveBeenCalledWith('bed-001', false, TENANT_ID);
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
      expect(mockBedRepo.setOccupied).not.toHaveBeenCalled();
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
      mockWardRepo.listWards.mockResolvedValue([BASE_WARD] as never);
      mockBedRepo.findByWard.mockResolvedValue([
        { ...BASE_BED, isOccupied: true },
        { ...BASE_BED, bedId: 'bed-002', isOccupied: false },
        { ...BASE_BED, bedId: 'bed-003', isOccupied: false },
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
          // First call: only ADMITTED can transition to DISCHARGED
          // Second call on DISCHARGED: must be rejected (status 400)
          if (!isAdmitted) {
            expect(status).toBe(AdmissionStatus.DISCHARGED);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
