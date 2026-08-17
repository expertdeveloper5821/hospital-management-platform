jest.mock('../../../src/modules/department/department.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import { userRepository } from '../../../src/modules/user/user.repository';
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
