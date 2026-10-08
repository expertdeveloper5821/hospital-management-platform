jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/modules/opd/opd.repository');
jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/modules/lab/lab.repository');
jest.mock('../../../src/modules/payment/payment.repository');
jest.mock('../../../src/modules/attendance/attendance.repository');
jest.mock('../../../src/modules/notification/notification.service');
jest.mock('../../../src/shared/services/websocket.service');
jest.mock('../../../src/shared/services/email.service');
jest.mock('../../../src/shared/services/audit.service');

import { userRepository }        from '../../../src/modules/user/user.repository';
import { opdRepository }         from '../../../src/modules/opd/opd.repository';
import { ipdRepository }         from '../../../src/modules/ipd/ipd.repository';
import { labRepository }         from '../../../src/modules/lab/lab.repository';
import { paymentRepository }     from '../../../src/modules/payment/payment.repository';
import { attendanceRepository }  from '../../../src/modules/attendance/attendance.repository';
import { notificationService }   from '../../../src/modules/notification/notification.service';
import { pushToUser }            from '../../../src/shared/services/websocket.service';
import { auditService }          from '../../../src/shared/services/audit.service';
import { emailService }          from '../../../src/shared/services/email.service';
import { UserService }           from '../../../src/modules/user/user.service';
import { UserRole }              from '../../../src/shared/types/common.types';
import { PaymentReferenceType }  from '../../../src/modules/payment/payment.types';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../src/shared/middleware/error-handler';

const mockRepo         = userRepository        as jest.Mocked<typeof userRepository>;
const mockOpdRepo      = opdRepository         as jest.Mocked<typeof opdRepository>;
const mockIpdRepo      = ipdRepository         as jest.Mocked<typeof ipdRepository>;
const mockLabRepo      = labRepository         as jest.Mocked<typeof labRepository>;
const mockPaymentRepo  = paymentRepository     as jest.Mocked<typeof paymentRepository>;
const mockAttendRepo   = attendanceRepository  as jest.Mocked<typeof attendanceRepository>;
const mockNotifSvc     = notificationService   as jest.Mocked<typeof notificationService>;
const mockAuditSvc     = auditService          as jest.Mocked<typeof auditService>;
const mockEmailSvc     = emailService          as jest.Mocked<typeof emailService>;

describe('UserService — example-based', () => {
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no active work anywhere — individual tests override.
    mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);
    mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);
    mockOpdRepo.countActiveVisitsByNurse.mockResolvedValue(0);
    mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);
    mockIpdRepo.countActiveAdmissionsByWards.mockResolvedValue(0);
    mockLabRepo.findActivePathologyIdsByRequester.mockResolvedValue([]);
    mockLabRepo.findActiveRadiologyIdsByRequester.mockResolvedValue([]);
    mockPaymentRepo.countOpenPaymentsByCreator.mockResolvedValue(0);
    mockPaymentRepo.findCompletedByReferences.mockResolvedValue([]);
    mockAttendRepo.findOpenSession.mockResolvedValue(null);
    mockNotifSvc.sendNotification.mockResolvedValue({} as never);
    mockAuditSvc.log.mockResolvedValue(undefined);
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
      isActive: true,
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
      isActive: true,
    } as never);
    mockRepo.updateRole.mockResolvedValue(undefined);

    await service.updateUserRole('t1', 'u1', UserRole.NURSE, 'admin-1');

    expect(mockRepo.updateRole).toHaveBeenCalledWith('t1', 'u1', UserRole.NURSE);
  });

  test('updateUserRole succeeds when demoting admin but another admin exists', async () => {
    mockRepo.findById.mockResolvedValue({
      _id: { toString: () => 'u1' },
      role: UserRole.HOSPITAL_ADMIN,
      isActive: true,
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

    test('inactive users are rejected with USER_INACTIVE before any workload check (§4.1 #6 fail-closed)', async () => {
      mockRepo.findById.mockResolvedValue(doctorUser({ isActive: false }));
      mockOpdRepo.countActivePatientsByDoctor.mockResolvedValue(['p1']);
      mockIpdRepo.countActivePatientsByDoctor.mockResolvedValue([]);

      const err = await service.updateUserRole('t1', DOCTOR_ID, UserRole.NURSE, 'admin-1').then(
        () => { throw new Error('expected updateUserRole to reject'); },
        (e: unknown) => e as ConflictError,
      );

      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details).toMatchObject({ code: 'USER_INACTIVE' });
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

  // ── updateUserRole — role-specific active-work guards (§4.2) ────────────────
  // Each blocked transition must be a 409 ConflictError carrying the stable
  // code + data-driven payload (ids and counts only), must write the
  // ROLE_CHANGE_BLOCKED audit entry, and must leave the role untouched.
  describe('role-specific active-work guards (§4.2)', () => {
    function userWith(role: UserRole, overrides: Record<string, unknown> = {}) {
      return {
        _id: { toString: () => 'u-1' },
        name: 'Test User',
        role,
        isActive: true,
        ...overrides,
      } as never;
    }

    async function expectBlockedWith(
      promise:   Promise<unknown>,
      expected:  Record<string, unknown>,
    ): Promise<ConflictError> {
      const err = await promise.then(
        () => { throw new Error('expected updateUserRole to reject'); },
        (e: unknown) => e as ConflictError,
      );
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details).toMatchObject(expected);
      expect(mockRepo.updateRole).not.toHaveBeenCalled();
      // §4.4: every rejection is audited with the stable conflict code.
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ROLE_CHANGE_BLOCKED', newValue: expect.objectContaining({ conflictCode: expected.code }) }),
      );
      return err;
    }

    test('NURSE_ACTIVE_ENTRIES — blocks on active OPD queue rows, with breakdown', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.NURSE));
      mockOpdRepo.countActiveVisitsByNurse.mockResolvedValue(2);
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);
      mockIpdRepo.countActiveAdmissionsByWards.mockResolvedValue(0);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1'),
        { code: 'NURSE_ACTIVE_ENTRIES', activeEntries: 2, breakdown: { opd: 2, ipd: 0 }, currentRole: UserRole.NURSE, requestedRole: UserRole.RECEPTIONIST },
      );
    });

    test('NURSE_ACTIVE_ENTRIES — blocks on ward-roster admissions (OPD quiet)', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.NURSE));
      mockOpdRepo.countActiveVisitsByNurse.mockResolvedValue(0);
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue(['w1', 'w2']);
      mockIpdRepo.countActiveAdmissionsByWards.mockResolvedValue(3);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.STAFF, 'admin-1'),
        { code: 'NURSE_ACTIVE_ENTRIES', activeEntries: 3, breakdown: { opd: 0, ipd: 3 } },
      );
      expect(mockIpdRepo.countActiveAdmissionsByWards).toHaveBeenCalledWith('t1', ['w1', 'w2']);
    });

    test('NURSE with no active duty passes through to updateRole', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.NURSE));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1')).resolves.toBeUndefined();
      expect(mockRepo.updateRole).toHaveBeenCalledWith('t1', 'u-1', UserRole.RECEPTIONIST);
    });

    test('PATHOLOGY_ACTIVE_REQUEST — blocks on active authored pathology requests, unpaid flag true', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.PATHOLOGIST));
      mockLabRepo.findActivePathologyIdsByRequester.mockResolvedValue(['pr-1', 'pr-2']);
      mockPaymentRepo.findCompletedByReferences.mockResolvedValue([]);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.NURSE, 'admin-1'),
        { code: 'PATHOLOGY_ACTIVE_REQUEST', activeRequests: 2, unpaidPayment: true, currentRole: UserRole.PATHOLOGIST },
      );
      expect(mockLabRepo.findActiveRadiologyIdsByRequester).not.toHaveBeenCalled();
      expect(mockPaymentRepo.findCompletedByReferences).toHaveBeenCalledWith(
        't1',
        PaymentReferenceType.PATHOLOGY_REQUEST,
        ['pr-1', 'pr-2'],
      );
    });

    test('PATHOLOGY_ACTIVE_REQUEST — unpaidPayment false when every active request is paid', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.PATHOLOGIST));
      mockLabRepo.findActivePathologyIdsByRequester.mockResolvedValue(['pr-1']);
      mockPaymentRepo.findCompletedByReferences.mockResolvedValue([
        { referenceId: 'pr-1' },
      ] as never);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.NURSE, 'admin-1'),
        { code: 'PATHOLOGY_ACTIVE_REQUEST', activeRequests: 1, unpaidPayment: false },
      );
    });

    test('RADIOLOGY_ACTIVE_REQUEST — blocks on active authored radiology requests', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.RADIOLOGIST));
      mockLabRepo.findActiveRadiologyIdsByRequester.mockResolvedValue(['rr-1']);
      mockPaymentRepo.findCompletedByReferences.mockResolvedValue([]);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1'),
        { code: 'RADIOLOGY_ACTIVE_REQUEST', activeRequests: 1, unpaidPayment: true },
      );
      expect(mockLabRepo.findActivePathologyIdsByRequester).not.toHaveBeenCalled();
      expect(mockPaymentRepo.findCompletedByReferences).toHaveBeenCalledWith(
        't1',
        PaymentReferenceType.RADIOLOGY_REQUEST,
        ['rr-1'],
      );
    });

    test('FINANCE_UNRECONCILED — blocks a MANAGER with open (PENDING) payments', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.MANAGER));
      mockPaymentRepo.countOpenPaymentsByCreator.mockResolvedValue(4);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1'),
        { code: 'FINANCE_UNRECONCILED', openPayments: 4, currentRole: UserRole.MANAGER },
      );
    });

    test('OPEN_PAYMENT_LEASE — blocks a FINANCE_MANAGER with open (PENDING) payments', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.FINANCE_MANAGER));
      mockPaymentRepo.countOpenPaymentsByCreator.mockResolvedValue(1);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.MANAGER, 'admin-1'),
        { code: 'OPEN_PAYMENT_LEASE', openPayments: 1, currentRole: UserRole.FINANCE_MANAGER },
      );
    });

    test('finance roles with zero open payments pass through (PENDING is the only blocking state)', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.MANAGER));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1')).resolves.toBeUndefined();
      expect(mockRepo.updateRole).toHaveBeenCalled();
    });

    test('STAFF_ACTIVE_SESSION — blocks on a dangling check-in, carrying the attendanceId', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.STAFF));
      mockAttendRepo.findOpenSession.mockResolvedValue({ attendanceId: 'att-9' } as never);

      await expectBlockedWith(
        service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1'),
        { code: 'STAFF_ACTIVE_SESSION', attendanceId: 'att-9', currentRole: UserRole.STAFF },
      );
    });

    test('STAFF with a closed session passes through', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.STAFF));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(service.updateUserRole('t1', 'u-1', UserRole.RECEPTIONIST, 'admin-1')).resolves.toBeUndefined();
      expect(mockRepo.updateRole).toHaveBeenCalled();
    });

    test('guards fire on CURRENT role only — changing into NURSE/STAFF etc. never queries their guards', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.RECEPTIONIST));
      mockRepo.updateRole.mockResolvedValue(undefined);

      await expect(service.updateUserRole('t1', 'u-1', UserRole.NURSE, 'admin-1')).resolves.toBeUndefined();

      expect(mockOpdRepo.countActiveVisitsByNurse).not.toHaveBeenCalled();
      expect(mockLabRepo.findActivePathologyIdsByRequester).not.toHaveBeenCalled();
      expect(mockLabRepo.findActiveRadiologyIdsByRequester).not.toHaveBeenCalled();
      expect(mockPaymentRepo.countOpenPaymentsByCreator).not.toHaveBeenCalled();
      expect(mockAttendRepo.findOpenSession).not.toHaveBeenCalled();
    });
  });

  // ── deactivateUser — conflict guards ─────────────────────────────────────────
  describe('deactivation conflict guards', () => {
    function userWith(role: UserRole, overrides: Record<string, unknown> = {}) {
      return {
        _id: { toString: () => 'u-1' },
        name: 'Test User',
        role,
        isActive: true,
        ...overrides,
      } as never;
    }

    test('LAST_ADMIN_CONFLICT — cannot deactivate the last active Hospital Admin', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.HOSPITAL_ADMIN));
      mockRepo.countActiveAdmins.mockResolvedValue(1);

      const err = await service.deactivateUser('t1', 'u-1', 'admin-1').then(
        () => { throw new Error('expected deactivateUser to reject'); },
        (e: unknown) => e as ConflictError,
      );
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details).toMatchObject({ code: 'LAST_ADMIN_CONFLICT', userId: 'u-1' });
      expect(mockRepo.setActive).not.toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ROLE_CHANGE_BLOCKED', newValue: expect.objectContaining({ conflictCode: 'LAST_ADMIN_CONFLICT' }) }),
      );
    });

    test('WARD_ROSTER_CONFLICT — cannot deactivate a nurse still rostered on an active ward', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.NURSE));
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue(['w1']);

      const err = await service.deactivateUser('t1', 'u-1', 'admin-1').then(
        () => { throw new Error('expected deactivateUser to reject'); },
        (e: unknown) => e as ConflictError,
      );
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.details).toMatchObject({ code: 'WARD_ROSTER_CONFLICT', activeWards: 1, userId: 'u-1' });
      expect(mockRepo.setActive).not.toHaveBeenCalled();
      expect(mockAuditSvc.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ROLE_CHANGE_BLOCKED', newValue: expect.objectContaining({ conflictCode: 'WARD_ROSTER_CONFLICT' }) }),
      );
    });

    test('WARD_ROSTER_CONFLICT only counts active (non-deleted) wards — findWardIdsByNurse activeOnly', async () => {
      mockRepo.findById.mockResolvedValue(userWith(UserRole.NURSE));
      mockIpdRepo.findWardIdsByNurse.mockResolvedValue([]);

      await expect(service.deactivateUser('t1', 'u-1', 'admin-1')).resolves.toBeUndefined();
      expect(mockIpdRepo.findWardIdsByNurse).toHaveBeenCalledWith('t1', 'u-1', { activeOnly: true });
      expect(mockRepo.setActive).toHaveBeenCalledWith('t1', 'u-1', false);
    });
  });
});
