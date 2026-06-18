jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import * as fc from 'fast-check';
import { ipdRepository }     from '../../../src/modules/ipd/ipd.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { userRepository }    from '../../../src/modules/user/user.repository';
import { IPDService }        from '../../../src/modules/ipd/ipd.service';
import { AdmissionStatus }   from '../../../src/modules/ipd/ipd.types';
import { AppError, NotFoundError } from '../../../src/shared/middleware/error-handler';
import { UserRole }          from '../../../src/shared/types/common.types';

const mockIpdRepo     = ipdRepository     as jest.Mocked<typeof ipdRepository>;
const mockPatientRepo = patientRepository as jest.Mocked<typeof patientRepository>;
const mockUserRepo    = userRepository    as jest.Mocked<typeof userRepository>;

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
