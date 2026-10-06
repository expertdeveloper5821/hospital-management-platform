jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/audit.service');

import { userRepository } from '../../../src/modules/user/user.repository';
import { opdRepository }  from '../../../src/modules/opd/opd.repository';
import { ipdRepository }  from '../../../src/modules/ipd/ipd.repository';
import { emailService }   from '../../../src/shared/services/email.service';
import { UserService }    from '../../../src/modules/user/user.service';
import { UserRole }       from '../../../src/shared/types/common.types';
import {
  ConflictError,
  NotFoundError,
} from '../../../src/shared/middleware/error-handler';

const mockRepo     = userRepository as jest.Mocked<typeof userRepository>;
const mockOpdRepo  = opdRepository  as jest.Mocked<typeof opdRepository>;
const mockIpdRepo  = ipdRepository  as jest.Mocked<typeof ipdRepository>;
const mockEmailSvc = emailService   as jest.Mocked<typeof emailService>;

describe('UserService — example-based', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no active encounters anywhere — individual tests override.
    mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);
    mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);
    service = new UserService();
  });

  // ── createUser ───────────────────────────────────────────────────────────────
  test('createUser returns user and sends welcome email', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    const saved = { _id: { toString: () => 'u1' }, email: 'dr@h.com', role: UserRole.DOCTOR };
    mockRepo.save.mockResolvedValue(saved as never);
    mockEmailSvc.sendWelcomeEmail.mockResolvedValue(undefined);

    const result = await service.createUser(
      't1',
      { email: 'dr@h.com', name: 'Dr John', role: UserRole.DOCTOR },
      'admin-1',
    );

    expect(result.email).toBe('dr@h.com');
    expect(mockEmailSvc.sendWelcomeEmail).toHaveBeenCalledWith(
      'dr@h.com',
      expect.any(String),
      expect.stringContaining('/login'),
      't1',
    );
  });

  test('createUser throws ConflictError when email already exists in tenant', async () => {
    mockRepo.findByEmail.mockResolvedValue({ email: 'dr@h.com' } as never);

    await expect(
      service.createUser('t1', { email: 'dr@h.com', name: 'Dr John', role: UserRole.DOCTOR }, 'admin-1'),
    ).rejects.toThrow(ConflictError);

    expect(mockRepo.save).not.toHaveBeenCalled();
  });

  test('createUser saves with isFirstLogin:true (temp password forces first-change)', async () => {
    mockRepo.findByEmail.mockResolvedValue(null);
    const saved = { _id: { toString: () => 'u2' }, email: 'nurse@h.com', role: UserRole.NURSE };
    mockRepo.save.mockResolvedValue(saved as never);
    mockEmailSvc.sendWelcomeEmail.mockResolvedValue(undefined);

    await service.createUser('t1', { email: 'nurse@h.com', name: 'Nurse Joy', role: UserRole.NURSE }, 'admin-1');

    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isFirstLogin: true, isActive: true }),
    );
  });

  // ── deactivateUser ────────────────────────────────────────────────────────────
  test('deactivateUser sets isActive to false', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.DOCTOR,
    } as never);
    mockRepo.setActive.mockResolvedValue(undefined);

    await service.deactivateUser('t1', 'u1', 'admin-1');

    expect(mockRepo.setActive).toHaveBeenCalledWith('t1', 'u1', false);
  });

  test('deactivateUser throws NotFoundError when user does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.deactivateUser('t1', 'missing', 'admin-1')).rejects.toThrow(NotFoundError);
  });

  test('deactivateUser throws ConflictError when deactivating the last active Hospital Admin', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.HOSPITAL_ADMIN,
    } as never);
    mockRepo.countActiveAdmins.mockResolvedValue(1);

    await expect(service.deactivateUser('t1', 'u1', 'admin-1')).rejects.toThrow(ConflictError);
    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  test('deactivateUser succeeds when there are multiple active admins', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.HOSPITAL_ADMIN,
    } as never);
    mockRepo.countActiveAdmins.mockResolvedValue(2);
    mockRepo.setActive.mockResolvedValue(undefined);

    await expect(service.deactivateUser('t1', 'u1', 'admin-1')).resolves.toBeUndefined();
    expect(mockRepo.setActive).toHaveBeenCalledWith('t1', 'u1', false);
  });

  test('deactivateUser skips admin count check for non-admin roles', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.NURSE,
    } as never);
    mockRepo.setActive.mockResolvedValue(undefined);

    await service.deactivateUser('t1', 'u1', 'admin-1');

    expect(mockRepo.countActiveAdmins).not.toHaveBeenCalled();
  });

  // ── reactivateUser ───────────────────────────────────────────────────────────
  test('reactivateUser sets isActive to true for an inactive user', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.NURSE,
      isActive: false,
    } as never);
    mockRepo.setActive.mockResolvedValue(undefined);

    await service.reactivateUser('t1', 'u1', 'admin-1');

    expect(mockRepo.setActive).toHaveBeenCalledWith('t1', 'u1', true);
  });

  test('reactivateUser throws NotFoundError when user does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.reactivateUser('t1', 'missing', 'admin-1')).rejects.toThrow(NotFoundError);
    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  test('reactivateUser throws ConflictError when the user is already active', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.NURSE,
      isActive: true,
    } as never);

    await expect(service.reactivateUser('t1', 'u1', 'admin-1')).rejects.toThrow(ConflictError);
    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  test('reactivateUser does not change role or department data', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.DOCTOR,
      departmentIds: ['dept-1'],
      isActive: false,
    } as never);
    mockRepo.setActive.mockResolvedValue(undefined);

    await service.reactivateUser('t1', 'u1', 'admin-1');

    expect(mockRepo.updateRole).not.toHaveBeenCalled();
    expect(mockRepo.setActive).toHaveBeenCalledWith('t1', 'u1', true);
  });

  // ── updateUserRole ────────────────────────────────────────────────────────────
  test('updateUserRole throws NotFoundError when user does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(
      service.updateUserRole('t1', 'missing', UserRole.NURSE, 'admin-1'),
    ).rejects.toThrow(NotFoundError);
  });

  test('updateUserRole throws ConflictError when demoting the last Hospital Admin', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.HOSPITAL_ADMIN,
    } as never);
    mockRepo.countActiveAdmins.mockResolvedValue(1);

    await expect(
      service.updateUserRole('t1', 'u1', UserRole.NURSE, 'admin-1'),
    ).rejects.toThrow(ConflictError);

    expect(mockRepo.updateRole).not.toHaveBeenCalled();
  });

  test('updateUserRole succeeds for non-admin role change', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.DOCTOR,
    } as never);
    mockRepo.updateRole.mockResolvedValue(undefined);

    await service.updateUserRole('t1', 'u1', UserRole.NURSE, 'admin-1');

    expect(mockRepo.updateRole).toHaveBeenCalledWith('t1', 'u1', UserRole.NURSE);
  });

  test('updateUserRole succeeds when demoting admin but another admin exists', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.HOSPITAL_ADMIN,
    } as never);
    mockRepo.countActiveAdmins.mockResolvedValue(2);
    mockRepo.updateRole.mockResolvedValue(undefined);

    await expect(
      service.updateUserRole('t1', 'u1', UserRole.NURSE, 'admin-1'),
    ).resolves.toBeUndefined();
  });

  // ── listUsers ──────────────────────────────────────────────────────────────
  test('listUsers delegates to repository with tenant isolation', async () => {
    const result = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    mockRepo.findAll.mockResolvedValue(result);

    const out = await service.listUsers('t1', {}, 1, 20);

    expect(mockRepo.findAll).toHaveBeenCalledWith('t1', {}, 1, 20);
    expect(out).toEqual(result);
  });

  test('listUsers passes role filter to repository', async () => {
    const result = { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    mockRepo.findAll.mockResolvedValue(result);

    await service.listUsers('t1', { role: UserRole.NURSE }, 1, 20);

    expect(mockRepo.findAll).toHaveBeenCalledWith('t1', { role: UserRole.NURSE }, 1, 20);
  });

  // ── getUserById ────────────────────────────────────────────────────────────
  test('getUserById returns user when found', async () => {
    const user = { _id: 'u1', email: 'dr@h.com', role: UserRole.DOCTOR, tenantId: 't1' };
    mockRepo.findById.mockResolvedValue(user as never);

    const result = await service.getUserById('t1', 'u1');

    expect(result.email).toBe('dr@h.com');
  });

  test('getUserById throws NotFoundError for unknown user', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.getUserById('t1', 'u1')).rejects.toThrow(NotFoundError);
  });

  test('getUserById enforces tenant isolation — wrong tenantId returns NotFoundError', async () => {
    // Repository receives tenantId and will return null if tenant doesn't match
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.getUserById('wrong-tenant', 'u1')).rejects.toThrow(NotFoundError);
    expect(mockRepo.findById).toHaveBeenCalledWith('wrong-tenant', 'u1');
  });

  // ── updateUserRole — doctor role-change restriction ─────────────────────────
  describe('doctor role-change restriction', () => {
    const DOCTOR_ID = 'doc-001';

    function doctorUser(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        _id: { toString: () => DOCTOR_ID },
        name: 'Dr Asha',
        role: UserRole.DOCTOR,
        isActive: true,
        ...overrides,
      } as never;
    }

    test('blocks role change when active OPD patients exist (409 + details)', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p1', 'p2']);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).rejects.toThrow(ConflictError);

      // DB untouched on the blocked path.
      expect(mockRepo.updateRole).not.toHaveBeenCalled();
    });

    test('blocks role change when active IPD patients exist', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p1']);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.RECEPTIONIST, 'admin-1'),
      ).rejects.toThrow(ConflictError);
      expect(mockRepo.updateRole).not.toHaveBeenCalled();
    });

    test('ConflictError carries the structured details contract', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p1', 'p2', 'p3']);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p3', 'p9']);

      const err = await service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1').then(
        () => { throw new Error('expected updateUserRole to reject'); },
        (e: unknown) => e as ConflictError,
      );

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details).toMatchObject({
        code:           'DOCTOR_ACTIVE_PATIENTS',
        // p1, p2, p3, p9 — p3 is active via BOTH OPD and IPD → counted once.
        activePatients: 4,
        breakdown:      { opd: 3, ipd: 2 },
        userId:         DOCTOR_ID,
        currentRole:    UserRole.DOCTOR,
        requestedRole:  UserRole.NURSE,
      });
    });

    test('deduplicates a patient active via both OPD and IPD', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue(['shared-1']);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue(['shared-1']);

      const err = await service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1').then(
        () => { throw new Error('expected updateUserRole to reject'); },
        (e: unknown) => e as ConflictError,
      );

      expect(err.details?.['activePatients']).toBe(1);
      expect(err.details?.['breakdown']).toEqual({ opd: 1, ipd: 1 });
    });

    test('allows the role change when the doctor has zero active encounters', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).resolves.toBeUndefined();
      expect(mockRepo.updateRole).toHaveBeenCalledWith('t1', DOCTOR_ID, UserRole.NURSE);
    });

    test('does not block (and does not query encounters) for non-doctors', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser({ role: UserRole.RECEPTIONIST }));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockOpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
      expect(mockIpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
      expect(mockRepo.updateRole).toHaveBeenCalled();
    });

    test('changing INTO DOCTOR is never blocked', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser({ role: UserRole.RECEPTIONIST }));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.DOCTOR, 'admin-1'),
      ).resolves.toBeUndefined();

      expect(mockOpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
      expect(mockIpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
      expect(mockRepo.updateRole).toHaveBeenCalledWith('t1', DOCTOR_ID, UserRole.DOCTOR);
    });

    test('inactive doctors with active assignments are still blocked (fail-closed)', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser({ isActive: false }));
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p1']);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).rejects.toThrow(ConflictError);
      expect(mockRepo.updateRole).not.toHaveBeenCalled();
    });

    test('existing guards fire BEFORE the new check (no encounter queries on guard rejection)', async () => {
      // Last-admin guard fires first for an active HOSPITAL_ADMIN.
      mockRepo.findById.mockResolvedValue(doctorUser({ role: UserRole.HOSPITAL_ADMIN }));
      mockRepo.countActiveAdmins.mockResolvedValue(1);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).rejects.toThrow(ConflictError);

      expect(mockOpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
      expect(mockIpdRepo.countActivePatientsByDoctor).not.toHaveBeenCalled();
    });

    test('completed/cancelled/no-show visits and discharged admissions are the repos\' job to exclude — service only sees their results', async () => {
      // The repositories filter terminal statuses; from the service's view, an
      // empty result set means "nothing active" and the change proceeds.
      mockRepo.findById.mockResolvedValue(doctorUser());
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(
        service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1'),
      ).resolves.toBeUndefined();
      expect(mockRepo.updateRole).toHaveBeenCalled();
    });
  });
});
