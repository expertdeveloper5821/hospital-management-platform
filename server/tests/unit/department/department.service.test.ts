jest.mock('../../../src/modules/department/department.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import { userRepository } from '../../../src/modules/user/user.repository';
import { departmentRepository } from '../../../src/modules/department/department.repository';
import { DepartmentService } from '../../../src/modules/department/department.service';
import { UserRole } from '../../../src/shared/types/common.types';

const mockUserRepo = userRepository as jest.Mocked<typeof userRepository>;

// Valid-shaped 24-hex-char ids — userRepository.findById queries by Mongo _id,
// and resolveDepartmentFromDoctorIds only calls it for ids that look like one
// (see the malformed-id test below), same guard userRepository.findNamesByIds
// already applies.
const DOC_1 = '507f1f77bcf86cd799439011';
const DOC_2 = '507f1f77bcf86cd799439012';

function makeDoctor(overrides: Partial<{ userId: string; departmentIds: string[] }> = {}) {
  return {
    userId:        overrides.userId ?? DOC_1,
    role:          UserRole.DOCTOR,
    departmentIds: overrides.departmentIds ?? [],
  };
}

// resolveDepartmentFromDoctorIds is the single algorithm OPD visits and IPD
// admissions both rely on to map a doctor assignment to a department for
// revenue purposes — see CLAUDE.md "Department-wise revenue resolution".
describe('DepartmentService — resolveDepartmentFromDoctorIds', () => {
  let service: DepartmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DepartmentService();
  });

  test('returns the first doctor\'s first department', async () => {
    mockUserRepo.findById.mockResolvedValue(makeDoctor({ departmentIds: ['DEPT-CARDIO', 'DEPT-ENT'] }) as never);

    const result = await service.resolveDepartmentFromDoctorIds('t1', [DOC_1]);

    expect(result).toBe('DEPT-CARDIO');
  });

  test('returns null when no doctorIds are given', async () => {
    const result = await service.resolveDepartmentFromDoctorIds('t1', []);

    expect(result).toBeNull();
    expect(mockUserRepo.findById).not.toHaveBeenCalled();
  });

  test('returns null when the doctor has no department assigned', async () => {
    mockUserRepo.findById.mockResolvedValue(makeDoctor({ departmentIds: [] }) as never);

    const result = await service.resolveDepartmentFromDoctorIds('t1', [DOC_1]);

    expect(result).toBeNull();
  });

  test('returns null when the doctor does not exist', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    const result = await service.resolveDepartmentFromDoctorIds('t1', [DOC_1]);

    expect(result).toBeNull();
  });

  // OPD, unlike IPD, never validated that doctorIds are real Doctor users on
  // create/update — a malformed id must resolve to "no department", not
  // throw a Mongoose CastError.
  test('skips a malformed doctorId without querying the repository', async () => {
    const result = await service.resolveDepartmentFromDoctorIds('t1', ['not-an-object-id']);

    expect(result).toBeNull();
    expect(mockUserRepo.findById).not.toHaveBeenCalled();
  });

  test('skips a doctor with no department in favour of the next one that has it', async () => {
    mockUserRepo.findById
      .mockResolvedValueOnce(makeDoctor({ userId: DOC_1, departmentIds: [] }) as never)
      .mockResolvedValueOnce(makeDoctor({ userId: DOC_2, departmentIds: ['DEPT-ORTHO'] }) as never);

    const result = await service.resolveDepartmentFromDoctorIds('t1', [DOC_1, DOC_2]);

    expect(result).toBe('DEPT-ORTHO');
    expect(mockUserRepo.findById).toHaveBeenCalledTimes(2);
  });

  test('stops at the first doctor that resolves — does not check doctors after it', async () => {
    mockUserRepo.findById
      .mockResolvedValueOnce(makeDoctor({ userId: DOC_1, departmentIds: ['DEPT-CARDIO'] }) as never);

    const result = await service.resolveDepartmentFromDoctorIds('t1', [DOC_1, DOC_2]);

    expect(result).toBe('DEPT-CARDIO');
    expect(mockUserRepo.findById).toHaveBeenCalledTimes(1);
  });
});

describe('DepartmentService — listDepartmentsPaginated', () => {
  const mockDeptRepo = departmentRepository as jest.Mocked<typeof departmentRepository>;
  let service: DepartmentService;
  const page = { data: [], total: 0, page: 2, limit: 10, totalPages: 0 };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DepartmentService();
    mockDeptRepo.findPaginated.mockResolvedValue(page as never);
  });

  test('passes page/limit through and skips the doctor lookup without a search', async () => {
    const result = await service.listDepartmentsPaginated('t1', {}, 2, 10);

    expect(result).toBe(page);
    expect(mockUserRepo.findDepartmentIdsByDoctorName).not.toHaveBeenCalled();
    expect(mockDeptRepo.findPaginated).toHaveBeenCalledWith(
      't1', { search: undefined, matchedDepartmentIds: undefined }, 2, 10,
    );
  });

  test('resolves departments of matching doctors so search covers doctor names', async () => {
    mockUserRepo.findDepartmentIdsByDoctorName.mockResolvedValue(['DEPT-CARDIO']);

    await service.listDepartmentsPaginated('t1', { search: '  smith ' }, 1, 10);

    expect(mockUserRepo.findDepartmentIdsByDoctorName).toHaveBeenCalledWith('t1', 'smith');
    expect(mockDeptRepo.findPaginated).toHaveBeenCalledWith(
      't1', { search: 'smith', matchedDepartmentIds: ['DEPT-CARDIO'] }, 1, 10,
    );
  });
});

// The Pediatric / Non-Pediatric departments pick an OPD visit's / IPD
// admission's vitals set and are seeded lazily, missing rows only.
describe('DepartmentService — ensureVitalsDepartments', () => {
  const deptRepo = departmentRepository as jest.Mocked<typeof departmentRepository>;
  let service: DepartmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DepartmentService();
    deptRepo.findByName.mockResolvedValue(null);
  });

  test('creates both departments with no doctors when the tenant has neither', async () => {
    deptRepo.findClaimedVitalsProfiles.mockResolvedValue([]);

    await service.ensureVitalsDepartments('t1');

    expect(deptRepo.save).toHaveBeenCalledTimes(2);
    expect(deptRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', name: 'Pediatric', vitalsProfile: 'PEDIATRIC', headDoctorId: null, description: null,
    }));
    expect(deptRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1', name: 'Non-Pediatric', vitalsProfile: 'NON_PEDIATRIC', headDoctorId: null, description: null,
    }));
  });

  test('never re-creates a profile already claimed (including a renamed or deleted one)', async () => {
    deptRepo.findClaimedVitalsProfiles.mockResolvedValue(['PEDIATRIC', 'NON_PEDIATRIC']);

    await service.ensureVitalsDepartments('t1');

    expect(deptRepo.save).not.toHaveBeenCalled();
    expect(deptRepo.update).not.toHaveBeenCalled();
  });

  test('blanks only the placeholder description an earlier seed wrote', async () => {
    deptRepo.findClaimedVitalsProfiles.mockResolvedValue(['PEDIATRIC', 'NON_PEDIATRIC']);

    await service.ensureVitalsDepartments('t1');

    expect(deptRepo.clearSeededVitalsDescriptions).toHaveBeenCalledWith('t1', ['Pediatric vitals', 'Non-Pediatric vitals']);
  });

  test('adopts an existing department with the same name instead of duplicating it', async () => {
    deptRepo.findClaimedVitalsProfiles.mockResolvedValue(['NON_PEDIATRIC']);
    deptRepo.findByName.mockResolvedValue({ departmentId: 'DEPT-OLD', name: 'pediatric', vitalsProfile: null } as never);

    await service.ensureVitalsDepartments('t1');

    expect(deptRepo.update).toHaveBeenCalledWith('t1', 'DEPT-OLD', { vitalsProfile: 'PEDIATRIC' });
    expect(deptRepo.save).not.toHaveBeenCalled();
  });

  test('ignores a concurrent seed that loses on the unique index', async () => {
    deptRepo.findClaimedVitalsProfiles.mockResolvedValue([]);
    deptRepo.save.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));

    await expect(service.ensureVitalsDepartments('t1')).resolves.toBeUndefined();
  });

  test('getVitalsProfile reads the department profile, null for none', async () => {
    deptRepo.findById.mockResolvedValue({ departmentId: 'DEPT-PED', vitalsProfile: 'PEDIATRIC' } as never);

    await expect(service.getVitalsProfile('t1', 'DEPT-PED')).resolves.toBe('PEDIATRIC');
    await expect(service.getVitalsProfile('t1', null)).resolves.toBeNull();
  });
});
