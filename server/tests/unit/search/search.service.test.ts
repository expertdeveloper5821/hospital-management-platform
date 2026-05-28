jest.mock('../../../src/modules/patient/patient.model');
jest.mock('../../../src/modules/user/user.model');
jest.mock('../../../src/modules/opd/opd.model');
jest.mock('../../../src/modules/ipd/ipd.model');
jest.mock('../../../src/modules/lab/lab.model');

import { PatientModel }      from '../../../src/modules/patient/patient.model';
import { UserModel }         from '../../../src/modules/user/user.model';
import { OPDVisitModel }     from '../../../src/modules/opd/opd.model';
import { IPDAdmissionModel } from '../../../src/modules/ipd/ipd.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../../../src/modules/lab/lab.model';
import { SearchService }     from '../../../src/modules/search/search.service';
import { SearchEntityType }  from '../../../src/modules/search/search.types';

const TENANT = 'tenant-001';

// ─── Helper: create a chainable Mongoose query mock ──────────────────────────

function makeFindMock(docs: object[]) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    limit:  jest.fn().mockReturnThis(),
    lean:   jest.fn().mockResolvedValue(docs),
  };
  return jest.fn().mockReturnValue(chain);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SearchService.search', () => {
  let service: SearchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SearchService();

    // Default: all searches return empty
    (PatientModel.find as jest.Mock)      = makeFindMock([]);
    (UserModel.find as jest.Mock)         = makeFindMock([]);
    (OPDVisitModel.find as jest.Mock)     = makeFindMock([]);
    (IPDAdmissionModel.find as jest.Mock) = makeFindMock([]);
    (PathologyRequestModel.find as jest.Mock)  = makeFindMock([]);
    (RadiologyRequestModel.find as jest.Mock)  = makeFindMock([]);
  });

  // ─── Patient search ────────────────────────────────────────────────────────

  describe('patient search', () => {
    test('returns patient results mapped to SearchResult shape', async () => {
      (PatientModel.find as jest.Mock) = makeFindMock([
        { patientId: 'PAT-001', fullName: 'John Doe', mobileNumber: '9876543210' },
      ]);

      const result = await service.search(TENANT, 'John');

      const patient = result.results.find((r) => r.entityType === SearchEntityType.PATIENT);
      expect(patient).toBeDefined();
      expect(patient!.title).toBe('John Doe');
      expect(patient!.subtitle).toBe('9876543210');
      expect(patient!.href).toContain('PAT-001');
      expect(patient!.id).toBe('PAT-001');
    });

    test('patient search filters by tenantId and uses case-insensitive regex', async () => {
      (PatientModel.find as jest.Mock) = makeFindMock([]);

      await service.search(TENANT, 'alice');

      const callArgs = (PatientModel.find as jest.Mock).mock.calls[0][0];
      expect(callArgs.tenantId).toBe(TENANT);
      expect(callArgs.$or).toBeDefined();
      const fullNameCondition = callArgs.$or.find((c: Record<string, unknown>) => 'fullName' in c);
      expect(fullNameCondition.fullName.$options).toBe('i');
    });
  });

  // ─── User search ───────────────────────────────────────────────────────────

  describe('user search', () => {
    test('returns user results with role in subtitle', async () => {
      (UserModel.find as jest.Mock) = makeFindMock([
        { _id: 'uid-1', name: 'Dr Smith', email: 'smith@hospital.com', role: 'DOCTOR' },
      ]);

      const result = await service.search(TENANT, 'Smith');

      const user = result.results.find((r) => r.entityType === SearchEntityType.USER);
      expect(user).toBeDefined();
      expect(user!.title).toBe('Dr Smith');
      expect(user!.subtitle).toContain('DOCTOR');
    });
  });

  // ─── OPD visit search ──────────────────────────────────────────────────────

  describe('OPD visit search', () => {
    test('returns OPD results with visitId in title', async () => {
      (OPDVisitModel.find as jest.Mock) = makeFindMock([
        { visitId: 'OPD-001', patientId: 'PAT-001', chiefComplaint: 'Fever', status: 'OPEN', visitDate: new Date() },
      ]);

      const result = await service.search(TENANT, 'Fever');

      const visit = result.results.find((r) => r.entityType === SearchEntityType.OPD_VISIT);
      expect(visit).toBeDefined();
      expect(visit!.title).toContain('OPD-001');
      expect(visit!.subtitle).toContain('Fever');
    });
  });

  // ─── IPD search ────────────────────────────────────────────────────────────

  describe('IPD search', () => {
    test('returns IPD results with ward info in subtitle', async () => {
      (IPDAdmissionModel.find as jest.Mock) = makeFindMock([
        { admissionId: 'IPD-001', patientId: 'PAT-001', wardName: 'General', bedNumber: '5', status: 'ACTIVE' },
      ]);

      const result = await service.search(TENANT, 'General');

      const ipd = result.results.find((r) => r.entityType === SearchEntityType.IPD);
      expect(ipd).toBeDefined();
      expect(ipd!.title).toContain('IPD-001');
      expect(ipd!.subtitle).toContain('General');
    });
  });

  // ─── Lab request search ────────────────────────────────────────────────────

  describe('lab request search', () => {
    test('returns lab results from both pathology and radiology', async () => {
      (PathologyRequestModel.find as jest.Mock) = makeFindMock([
        { requestId: 'PATH-001', patientId: 'PAT-001', testType: 'Blood CBC', status: 'PENDING' },
      ]);
      (RadiologyRequestModel.find as jest.Mock) = makeFindMock([
        { requestId: 'RADIO-001', patientId: 'PAT-001', testType: 'Chest X-Ray', status: 'PENDING' },
      ]);

      const result = await service.search(TENANT, 'PAT-001');

      const labResults = result.results.filter((r) => r.entityType === SearchEntityType.LAB_REQUEST);
      expect(labResults.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Type filter ───────────────────────────────────────────────────────────

  describe('type filter', () => {
    test('only searches the specified entity type when type param is provided', async () => {
      (PatientModel.find as jest.Mock) = makeFindMock([
        { patientId: 'PAT-001', fullName: 'Alice', mobileNumber: '111' },
      ]);

      const result = await service.search(TENANT, 'Alice', SearchEntityType.PATIENT);

      expect(PatientModel.find).toHaveBeenCalledTimes(1);
      expect(UserModel.find).not.toHaveBeenCalled();
      expect(OPDVisitModel.find).not.toHaveBeenCalled();
      expect(result.results.every((r) => r.entityType === SearchEntityType.PATIENT)).toBe(true);
    });
  });

  // ─── 5-result cap ──────────────────────────────────────────────────────────

  describe('5-result cap per entity', () => {
    test('limits patient results to 5', async () => {
      const findChain = {
        select: jest.fn().mockReturnThis(),
        limit:  jest.fn().mockReturnThis(),
        lean:   jest.fn().mockResolvedValue([]),
      };
      (PatientModel.find as jest.Mock) = jest.fn().mockReturnValue(findChain);

      await service.search(TENANT, 'test', SearchEntityType.PATIENT);

      expect(findChain.limit).toHaveBeenCalledWith(5);
    });
  });

  // ─── Query escaping ────────────────────────────────────────────────────────

  describe('query escaping', () => {
    test('escapes regex special characters in the query', async () => {
      (PatientModel.find as jest.Mock) = makeFindMock([]);

      await service.search(TENANT, 'foo.*bar+', SearchEntityType.PATIENT);

      const callArgs = (PatientModel.find as jest.Mock).mock.calls[0][0];
      const fullNameCondition = callArgs.$or.find((c: Record<string, unknown>) => 'fullName' in c);
      // Special characters must be escaped
      expect(fullNameCondition.fullName.$regex).toContain('\\.');
      expect(fullNameCondition.fullName.$regex).toContain('\\*');
      expect(fullNameCondition.fullName.$regex).toContain('\\+');
    });
  });

  // ─── Response shape ────────────────────────────────────────────────────────

  describe('response shape', () => {
    test('returns query, results, and total count', async () => {
      const result = await service.search(TENANT, 'xyz');

      expect(result).toHaveProperty('query', 'xyz');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('total');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.total).toBe(result.results.length);
    });

    test('trims whitespace from query', async () => {
      const result = await service.search(TENANT, '  test  ');
      expect(result.query).toBe('test');
    });
  });
});
