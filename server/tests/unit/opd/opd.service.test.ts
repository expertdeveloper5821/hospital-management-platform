jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/shared/services/audit.service');

import { opdRepository }     from '../../../src/modules/opd/opd.repository';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { OPDService }        from '../../../src/modules/opd/opd.service';
import { OPDVisitStatus }    from '../../../src/modules/opd/opd.types';
import { NotFoundError, ConflictError } from '../../../src/shared/middleware/error-handler';

const mockOpdRepo     = opdRepository     as jest.Mocked<typeof opdRepository>;
const mockPatientRepo = patientRepository as jest.Mocked<typeof patientRepository>;

const BASE_PATIENT = {
  patientId: 'PAT-ABCD1234',
  tenantId:  't1',
  fullName:  'Ravi Kumar',
};

function makeVisit(overrides: Partial<{
  visitId:  string;
  status:   OPDVisitStatus;
  doctorId: string | null;
}> = {}) {
  return {
    visitId:        overrides.visitId  ?? 'OPD-TEST0001',
    tenantId:       't1',
    patientId:      'PAT-ABCD1234',
    doctorId:       overrides.doctorId ?? null,
    visitDate:      new Date('2026-05-15T00:00:00.000Z'),
    queueNumber:    1,
    status:         overrides.status   ?? OPDVisitStatus.OPEN,
    chiefComplaint: 'Fever and headache',
    diagnosis:      null,
    prescription:   null,
    notes:          null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
  };
}

const VALID_CREATE_REQ = {
  patientId:      'PAT-ABCD1234',
  chiefComplaint: 'Fever and headache',
  visitDate:      '2026-05-15',
};

describe('OPDService — example-based', () => {
  let service: OPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OPDService();
  });

  // ── createVisit ────────────────────────────────────────────────────────────
  describe('createVisit', () => {
    test('creates visit with OPEN status and auto-assigned queue number', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      const result = await service.createVisit('t1', VALID_CREATE_REQ, 'user-1');

      expect(result.status).toBe(OPDVisitStatus.OPEN);
      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status:         OPDVisitStatus.OPEN,
          chiefComplaint: 'Fever and headache',
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

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1');

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

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1');

      expect(savedVisitId).toMatch(/^OPD-[A-F0-9]{8}$/);
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.createVisit('t1', VALID_CREATE_REQ, 'user-1'))
        .rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.save).not.toHaveBeenCalled();
    });

    test('optional fields default to null', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);

      await service.createVisit('t1', VALID_CREATE_REQ, 'user-1');

      expect(mockOpdRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ doctorId: null, notes: null, diagnosis: null, prescription: null }),
      );
    });

    test('defaults visitDate to today when not provided', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      mockOpdRepo.countByDate.mockResolvedValue(0);
      mockOpdRepo.save.mockResolvedValue(makeVisit() as never);
      const before = new Date();
      before.setHours(0, 0, 0, 0);

      await service.createVisit('t1', { patientId: 'PAT-ABCD1234', chiefComplaint: 'Cough' }, 'user-1');

      const savedDate = (mockOpdRepo.save.mock.calls[0] as unknown[])[0] as { visitDate: Date };
      expect(savedDate.visitDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ── updateVisit ────────────────────────────────────────────────────────────
  describe('updateVisit', () => {
    test('updates allowed fields on OPEN visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(
        makeVisit({ status: OPDVisitStatus.OPEN }) as never,
      );

      await service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: 'Viral fever' }, 'doctor-1');

      expect(mockOpdRepo.update).toHaveBeenCalledWith(
        't1', 'OPD-TEST0001',
        expect.objectContaining({ diagnosis: 'Viral fever' }),
      );
    });

    test('updates allowed fields on IN_PROGRESS visit', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.IN_PROGRESS }) as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit({ status: OPDVisitStatus.IN_PROGRESS }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'BP normal' }, 'doctor-1'),
      ).resolves.toBeDefined();
    });

    test('throws ConflictError when visit is COMPLETED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.COMPLETED }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { diagnosis: 'Updated' }, 'doctor-1'),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('throws ConflictError when visit is CANCELLED', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit({ status: OPDVisitStatus.CANCELLED }) as never);

      await expect(
        service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Should fail' }, 'doctor-1'),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.update).not.toHaveBeenCalled();
    });

    test('throws NotFoundError when visit does not exist', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(null);

      await expect(
        service.updateVisit('t1', 'OPD-MISSING', { diagnosis: 'X' }, 'doctor-1'),
      ).rejects.toThrow(NotFoundError);
    });

    test('updates visitDate and converts string to Date', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.countByDate.mockResolvedValue(2);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-06-01' }, 'doctor-1');

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.visitDate).toBeInstanceOf(Date);
      expect((updateArg.visitDate as Date).getFullYear()).toBe(2026);
    });

    test('recalculates queueNumber when visitDate changes to a different day', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never); // stored: 2026-05-15
      mockOpdRepo.countByDate.mockResolvedValue(3); // 3 visits already on new date
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-06-01' }, 'doctor-1');

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg.queueNumber).toBe(4); // count+1
      expect(mockOpdRepo.countByDate).toHaveBeenCalled();
    });

    test('does not recalculate queueNumber when visitDate is unchanged', async () => {
      // makeVisit sets visitDate to 2026-05-15
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { visitDate: '2026-05-15' }, 'doctor-1');

      expect(mockOpdRepo.countByDate).not.toHaveBeenCalled();
      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('queueNumber');
    });

    test('only provided fields are passed to repository update', async () => {
      mockOpdRepo.findByVisitId.mockResolvedValue(makeVisit() as never);
      mockOpdRepo.update.mockResolvedValue(makeVisit() as never);

      await service.updateVisit('t1', 'OPD-TEST0001', { notes: 'Mild fever' }, 'doctor-1');

      const updateArg = (mockOpdRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).toHaveProperty('notes', 'Mild fever');
      expect(updateArg).not.toHaveProperty('diagnosis');
      expect(updateArg).not.toHaveProperty('chiefComplaint');
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
      );
      expect(result.status).toBe(OPDVisitStatus.COMPLETED);
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
    test('returns only OPEN and IN_PROGRESS visits', async () => {
      const visits = [
        makeVisit({ visitId: 'OPD-OPEN0001', status: OPDVisitStatus.OPEN }),
        makeVisit({ visitId: 'OPD-INPR0001', status: OPDVisitStatus.IN_PROGRESS }),
        makeVisit({ visitId: 'OPD-DONE0001', status: OPDVisitStatus.COMPLETED }),
        makeVisit({ visitId: 'OPD-CANC0001', status: OPDVisitStatus.CANCELLED }),
      ];
      mockOpdRepo.findByDate.mockResolvedValue(visits as never);

      const queue = await service.getQueue('t1', '2026-05-15');

      expect(queue).toHaveLength(2);
      expect(queue.map((v) => v.visitId)).toEqual(['OPD-OPEN0001', 'OPD-INPR0001']);
    });

    test('returns empty array when no active visits', async () => {
      mockOpdRepo.findByDate.mockResolvedValue([
        makeVisit({ status: OPDVisitStatus.COMPLETED }),
        makeVisit({ status: OPDVisitStatus.CANCELLED }),
      ] as never);

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
    test('returns paginated history for a valid patient', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(BASE_PATIENT as never);
      const expected = { data: [makeVisit()], total: 1, page: 1, limit: 20, totalPages: 1 };
      mockOpdRepo.findByPatient.mockResolvedValue(expected as never);

      const result = await service.getPatientHistory('t1', 'PAT-ABCD1234', 1, 20);

      expect(result.total).toBe(1);
      expect(mockOpdRepo.findByPatient).toHaveBeenCalledWith('t1', 'PAT-ABCD1234', 1, 20);
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockPatientRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.getPatientHistory('t1', 'PAT-MISSING', 1, 20))
        .rejects.toThrow(NotFoundError);

      expect(mockOpdRepo.findByPatient).not.toHaveBeenCalled();
    });
  });
});
