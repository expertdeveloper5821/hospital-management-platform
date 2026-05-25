jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/audit.service');

import { userRepository } from '../../../src/modules/user/user.repository';
import { emailService }   from '../../../src/shared/services/email.service';
import { UserService }    from '../../../src/modules/user/user.service';
import { UserRole }       from '../../../src/shared/types/common.types';
import {
  ConflictError,
  NotFoundError,
} from '../../../src/shared/middleware/error-handler';

const mockRepo     = userRepository as jest.Mocked<typeof userRepository>;
const mockEmailSvc = emailService   as jest.Mocked<typeof emailService>;

describe('UserService — example-based', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
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
});
