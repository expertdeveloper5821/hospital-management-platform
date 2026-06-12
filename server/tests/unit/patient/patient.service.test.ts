jest.mock('../../../src/modules/patient/patient.repository');
jest.mock('../../../src/modules/tenant/tenant.repository');
jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/shared/services/audit.service');
jest.mock('../../../src/shared/services/pdf.service');

import * as fc from 'fast-check';
import { patientRepository } from '../../../src/modules/patient/patient.repository';
import { tenantRepository }  from '../../../src/modules/tenant/tenant.repository';
import { ipdRepository }     from '../../../src/modules/ipd/ipd.repository';
import { pdfService }        from '../../../src/shared/services/pdf.service';
import { PatientService, DuplicateWarningError } from '../../../src/modules/patient/patient.service';
import { NotFoundError, ConflictError } from '../../../src/shared/middleware/error-handler';
import { Gender, BloodGroup } from '../../../src/modules/patient/patient.types';

const mockRepo      = patientRepository as jest.Mocked<typeof patientRepository>;
const mockTenantRepo = tenantRepository as jest.Mocked<typeof tenantRepository>;
const mockIpdRepo   = ipdRepository    as jest.Mocked<typeof ipdRepository>;
const mockPdfSvc    = pdfService        as jest.Mocked<typeof pdfService>;

const BASE_PATIENT = {
  _id:                    { toString: () => 'mongo-id-1' },
  patientId:              'PAT-ABCD1234',
  tenantId:               't1',
  fullName:               'Ravi Kumar',
  dateOfBirth:            new Date('1990-05-15'),
  gender:                 Gender.MALE,
  mobileNumber:           '9876543210',
  address:                '12 MG Road, Bengaluru',
  aadhaarNumber:          null,
  emergencyContactName:   null,
  emergencyContactMobile: null,
  bloodGroup:             null,
  createdAt:              new Date(),
  updatedAt:              new Date(),
};

const BASE_TENANT = {
  _id:        't1',
  name:       'Apollo Hospital',
  branding:   { displayName: 'Apollo', primaryColor: '#1A73E8', logoUrl: null },
};

describe('PatientService — example-based', () => {
  let service: PatientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatientService();
  });

  // ── createPatient ──────────────────────────────────────────────────────────
  describe('createPatient', () => {
    const validReq = {
      fullName:     'Ravi Kumar',
      dateOfBirth:  '1990-05-15',
      gender:       Gender.MALE,
      mobileNumber: '9876543210',
      address:      '12 MG Road, Bengaluru',
    } as const;

    test('creates patient and returns it when no duplicate exists', async () => {
      mockRepo.findByMobile.mockResolvedValue(null);
      mockRepo.save.mockResolvedValue({ ...BASE_PATIENT } as never);

      const result = await service.createPatient('t1', validReq, 'admin-1');

      expect(result.patientId).toBe('PAT-ABCD1234');
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', mobileNumber: '9876543210' }),
      );
    });

    test('throws DuplicateWarningError when mobile exists and forceCreate is not set', async () => {
      mockRepo.findByMobile.mockResolvedValue({ ...BASE_PATIENT } as never);

      await expect(service.createPatient('t1', validReq, 'admin-1'))
        .rejects.toThrow(DuplicateWarningError);

      expect(mockRepo.save).not.toHaveBeenCalled();
    });

    test('DuplicateWarningError carries existingPatientId', async () => {
      mockRepo.findByMobile.mockResolvedValue({ ...BASE_PATIENT } as never);

      await expect(service.createPatient('t1', validReq, 'admin-1'))
        .rejects.toMatchObject({ existingPatientId: 'PAT-ABCD1234', isDuplicateWarning: true });
    });

    test('proceeds when forceCreate:true even if mobile is duplicate', async () => {
      mockRepo.findByMobile.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockRepo.save.mockResolvedValue({ ...BASE_PATIENT, patientId: 'PAT-NEW00001' } as never);

      const result = await service.createPatient('t1', { ...validReq, forceCreate: true }, 'admin-1');

      expect(mockRepo.save).toHaveBeenCalled();
      expect(result.patientId).toBe('PAT-NEW00001');
    });

    test('generated patientId has PAT- prefix', async () => {
      mockRepo.findByMobile.mockResolvedValue(null);
      let savedPatientId = '';
      mockRepo.save.mockImplementation(async (data) => {
        savedPatientId = (data as { patientId: string }).patientId;
        return { ...BASE_PATIENT, patientId: savedPatientId } as never;
      });

      await service.createPatient('t1', validReq, 'admin-1');

      expect(savedPatientId).toMatch(/^PAT-[A-F0-9]{8}$/);
    });

    test('sets optional fields to null when not provided', async () => {
      mockRepo.findByMobile.mockResolvedValue(null);
      mockRepo.save.mockResolvedValue({ ...BASE_PATIENT } as never);

      await service.createPatient('t1', validReq, 'admin-1');

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          aadhaarNumber:          null,
          emergencyContactName:   null,
          emergencyContactMobile: null,
          bloodGroup:             null,
        }),
      );
    });

    test('includes optional fields when provided', async () => {
      mockRepo.findByMobile.mockResolvedValue(null);
      mockRepo.save.mockResolvedValue({ ...BASE_PATIENT, bloodGroup: BloodGroup.O_POS } as never);

      await service.createPatient('t1', { ...validReq, bloodGroup: BloodGroup.O_POS, aadhaarNumber: '123456789012' }, 'admin-1');

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bloodGroup: 'O+', aadhaarNumber: '123456789012' }),
      );
    });
  });

  // ── updatePatient ──────────────────────────────────────────────────────────
  describe('updatePatient', () => {
    test('throws NotFoundError when patient does not exist', async () => {
      mockRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.updatePatient('t1', 'PAT-MISSING', { fullName: 'New Name' }, 'actor'))
        .rejects.toThrow(NotFoundError);

      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    test('calls update with only provided fields', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockRepo.update.mockResolvedValue({ ...BASE_PATIENT, fullName: 'Updated Name' } as never);

      await service.updatePatient('t1', 'PAT-ABCD1234', { fullName: 'Updated Name' }, 'actor');

      expect(mockRepo.update).toHaveBeenCalledWith(
        't1', 'PAT-ABCD1234',
        expect.objectContaining({ fullName: 'Updated Name' }),
      );
      // should NOT include keys not provided
      const updateArg = (mockRepo.update.mock.calls[0] as unknown[])[2] as Record<string, unknown>;
      expect(updateArg).not.toHaveProperty('gender');
    });

    test('records previousValue and newValue in audit log on update', async () => {
      const auditService = jest.requireMock('../../../src/shared/services/audit.service').auditService as jest.Mocked<{ log: jest.Mock }>;
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockRepo.update.mockResolvedValue({ ...BASE_PATIENT, fullName: 'Updated Name' } as never);

      await service.updatePatient('t1', 'PAT-ABCD1234', { fullName: 'Updated Name' }, 'actor');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action:        'UPDATE',
          entityId:      'PAT-ABCD1234',
          previousValue: expect.objectContaining({ fullName: 'Ravi Kumar' }),
          newValue:      expect.objectContaining({ fullName: 'Updated Name' }),
        }),
      );
    });

    test('throws NotFoundError when update returns null (race condition)', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockRepo.update.mockResolvedValue(null);

      await expect(service.updatePatient('t1', 'PAT-ABCD1234', { fullName: 'X' }, 'actor'))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ── getPatientById ─────────────────────────────────────────────────────────
  describe('getPatientById', () => {
    test('returns patient when found', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);

      const result = await service.getPatientById('t1', 'PAT-ABCD1234');

      expect(result.fullName).toBe('Ravi Kumar');
      expect(mockRepo.findByPatientId).toHaveBeenCalledWith('t1', 'PAT-ABCD1234');
    });

    test('throws NotFoundError for unknown patient', async () => {
      mockRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.getPatientById('t1', 'PAT-MISSING')).rejects.toThrow(NotFoundError);
    });

    test('enforces tenant isolation — different tenantId returns NotFoundError', async () => {
      mockRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.getPatientById('other-tenant', 'PAT-ABCD1234')).rejects.toThrow(NotFoundError);
      expect(mockRepo.findByPatientId).toHaveBeenCalledWith('other-tenant', 'PAT-ABCD1234');
    });
  });

  // ── deletePatient ──────────────────────────────────────────────────────────
  describe('deletePatient', () => {
    test('soft-deletes patient when no active IPD admission', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockIpdRepo.findActiveAdmissionByPatient.mockResolvedValue(null);
      mockRepo.softDelete.mockResolvedValue({ ...BASE_PATIENT, isDeleted: true } as never);

      await expect(service.deletePatient('t1', 'PAT-ABCD1234', 'admin-1')).resolves.toBeUndefined();
      expect(mockRepo.softDelete).toHaveBeenCalledWith('t1', 'PAT-ABCD1234');
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockRepo.findByPatientId.mockResolvedValue(null);

      await expect(service.deletePatient('t1', 'PAT-MISSING', 'admin-1')).rejects.toThrow(NotFoundError);
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
    });

    test('throws ConflictError when patient has active IPD admission', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockIpdRepo.findActiveAdmissionByPatient.mockResolvedValue({ admissionId: 'ADM-001', status: 'ADMITTED' } as never);

      await expect(service.deletePatient('t1', 'PAT-ABCD1234', 'admin-1')).rejects.toThrow(ConflictError);
      expect(mockRepo.softDelete).not.toHaveBeenCalled();
    });

    test('ConflictError message mentions active IPD admission', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockIpdRepo.findActiveAdmissionByPatient.mockResolvedValue({ admissionId: 'ADM-001', status: 'ADMITTED' } as never);

      await expect(service.deletePatient('t1', 'PAT-ABCD1234', 'admin-1'))
        .rejects.toMatchObject({ message: expect.stringContaining('active IPD admission') });
    });

    test('writes audit log entry on successful delete', async () => {
      const { auditService } = jest.requireMock('../../../src/shared/services/audit.service');
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockIpdRepo.findActiveAdmissionByPatient.mockResolvedValue(null);
      mockRepo.softDelete.mockResolvedValue({ ...BASE_PATIENT, isDeleted: true } as never);

      await service.deletePatient('t1', 'PAT-ABCD1234', 'admin-1');

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entityId: 'PAT-ABCD1234', userId: 'admin-1' }),
      );
    });
  });

  // ── searchPatients ─────────────────────────────────────────────────────────
  describe('searchPatients', () => {
    test('delegates to repository with correct tenantId', async () => {
      const expected = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      mockRepo.search.mockResolvedValue(expected);

      const result = await service.searchPatients('t1', 'Ravi', 1, 20);

      expect(mockRepo.search).toHaveBeenCalledWith('t1', 'Ravi', 1, 20, undefined);
      expect(result).toEqual(expected);
    });

    test('passes undefined q when no search term', async () => {
      const expected = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
      mockRepo.search.mockResolvedValue(expected);

      await service.searchPatients('t1', undefined, 1, 20);

      expect(mockRepo.search).toHaveBeenCalledWith('t1', undefined, 1, 20, undefined);
    });
  });

  // ── generateMedicalCard ────────────────────────────────────────────────────
  describe('generateMedicalCard', () => {
    test('returns buffer from pdfService', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockTenantRepo.findById.mockResolvedValue({ ...BASE_TENANT } as never);
      const stubPdf = Buffer.from('PDF-STUB');
      mockPdfSvc.generateMedicalCard.mockResolvedValue(stubPdf);

      const result = await service.generateMedicalCard('t1', 'PAT-ABCD1234');

      expect(result).toBe(stubPdf);
      expect(mockPdfSvc.generateMedicalCard).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'PAT-ABCD1234', hospitalName: 'Apollo' }),
      );
    });

    test('throws NotFoundError when patient does not exist', async () => {
      mockRepo.findByPatientId.mockResolvedValue(null);
      mockTenantRepo.findById.mockResolvedValue({ ...BASE_TENANT } as never);

      await expect(service.generateMedicalCard('t1', 'PAT-MISSING')).rejects.toThrow(NotFoundError);
    });

    test('throws NotFoundError when tenant does not exist', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockTenantRepo.findById.mockResolvedValue(null);

      await expect(service.generateMedicalCard('t1', 'PAT-ABCD1234')).rejects.toThrow(NotFoundError);
    });

    test('uses branding.displayName as hospitalName when set', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockTenantRepo.findById.mockResolvedValue({
        ...BASE_TENANT,
        branding: { displayName: 'Apollo Branded', primaryColor: '#fff', logoUrl: null },
      } as never);
      mockPdfSvc.generateMedicalCard.mockResolvedValue(Buffer.from(''));

      await service.generateMedicalCard('t1', 'PAT-ABCD1234');

      expect(mockPdfSvc.generateMedicalCard).toHaveBeenCalledWith(
        expect.objectContaining({ hospitalName: 'Apollo Branded' }),
      );
    });

    test('falls back to tenant.name when displayName is empty', async () => {
      mockRepo.findByPatientId.mockResolvedValue({ ...BASE_PATIENT } as never);
      mockTenantRepo.findById.mockResolvedValue({
        ...BASE_TENANT,
        name:     'Apollo Hospital',
        branding: { displayName: '', primaryColor: '#fff', logoUrl: null },
      } as never);
      mockPdfSvc.generateMedicalCard.mockResolvedValue(Buffer.from(''));

      await service.generateMedicalCard('t1', 'PAT-ABCD1234');

      expect(mockPdfSvc.generateMedicalCard).toHaveBeenCalledWith(
        expect.objectContaining({ hospitalName: 'Apollo Hospital' }),
      );
    });
  });
});

// ─── PBT (Property-Based Tests) ───────────────────────────────────────────────
describe('PatientService — property-based', () => {
  let service: PatientService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PatientService();
  });

  // U2-A-07: patient ID uniqueness invariant
  test('PBT: every created patient receives a unique PAT-XXXXXXXX id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 20 }), // N patients to create
        async (n) => {
          const ids = new Set<string>();

          mockRepo.findByMobile.mockResolvedValue(null);
          mockRepo.save.mockImplementation(async (data) => {
            const d = data as { patientId: string };
            ids.add(d.patientId);
            return { ...BASE_PATIENT, patientId: d.patientId } as never;
          });

          for (let i = 0; i < n; i++) {
            await service.createPatient(
              't1',
              {
                fullName:     `Patient ${i}`,
                dateOfBirth:  '1990-01-01',
                gender:       Gender.MALE,
                mobileNumber: `98765${String(i).padStart(5, '0')}`,
                address:      'Test Address',
              },
              'actor',
            );
          }

          // All IDs are unique
          expect(ids.size).toBe(n);
          // All IDs match the expected format
          for (const id of ids) {
            expect(id).toMatch(/^PAT-[A-F0-9]{8}$/);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  // U2-A-07: search result consistency
  test('PBT: searching by exact mobile always returns the created patient', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1000000, max: 9999999999 }).map((n) => String(n)),
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (mobile, name) => {
          const expectedPatient = {
            ...BASE_PATIENT,
            patientId:    'PAT-FINDME01',
            mobileNumber: mobile,
            fullName:     name,
            tenantId:     't1',
          };

          mockRepo.search.mockResolvedValue({
            data:       [expectedPatient as never],
            total:      1,
            page:       1,
            limit:      20,
            totalPages: 1,
          });

          const result = await service.searchPatients('t1', mobile, 1, 20);

          expect(result.data.length).toBeGreaterThan(0);
          expect(result.data[0].mobileNumber).toBe(mobile);
        },
      ),
      { numRuns: 30 },
    );
  });
});
