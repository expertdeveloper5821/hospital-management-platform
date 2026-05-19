jest.mock('../../../src/modules/notification/notification.repository');
jest.mock('../../../src/modules/user/user.repository');

import { notificationRepository } from '../../../src/modules/notification/notification.repository';
import { userRepository }         from '../../../src/modules/user/user.repository';
import { NotificationService }    from '../../../src/modules/notification/notification.service';
import { INotification }          from '../../../src/modules/notification/notification.model';
import { UserRole }               from '../../../src/shared/types/common.types';

const mockNotifRepo = notificationRepository as jest.Mocked<typeof notificationRepository>;
const mockUserRepo  = userRepository         as jest.Mocked<typeof userRepository>;

const TENANT = 'tenant-001';
const USER   = 'user-001';

function makeNotification(overrides: Partial<INotification> = {}): INotification {
  return {
    notificationId: 'notif-001',
    userId:         USER,
    tenantId:       TENANT,
    title:          'Test Title',
    message:        'Test message body',
    entityType:     null,
    entityId:       null,
    isRead:         false,
    createdAt:      new Date(),
    updatedAt:      new Date(),
    ...overrides,
  } as unknown as INotification;
}

let service: NotificationService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new NotificationService();
});

// ─── sendNotification ─────────────────────────────────────────────────────────

describe('sendNotification', () => {
  test('saves and returns the notification', async () => {
    const notif = makeNotification();
    mockNotifRepo.save.mockResolvedValue(notif);

    const result = await service.sendNotification(USER, TENANT, 'Test Title', 'Test message body');

    expect(mockNotifRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, tenantId: TENANT, title: 'Test Title', isRead: false }),
    );
    expect(result.notificationId).toBe('notif-001');
  });

  test('passes entityType and entityId through when provided', async () => {
    const notif = makeNotification({ entityType: 'LAB_REQUEST', entityId: 'req-001' });
    mockNotifRepo.save.mockResolvedValue(notif);

    await service.sendNotification(USER, TENANT, 'T', 'M', 'LAB_REQUEST', 'req-001');

    expect(mockNotifRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'LAB_REQUEST', entityId: 'req-001' }),
    );
  });

  test('defaults entityType and entityId to null when omitted', async () => {
    mockNotifRepo.save.mockResolvedValue(makeNotification());

    await service.sendNotification(USER, TENANT, 'T', 'M');

    expect(mockNotifRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: null, entityId: null }),
    );
  });
});

// ─── sendToRole ───────────────────────────────────────────────────────────────

describe('sendToRole', () => {
  test('fans out a notification to every user with the given role', async () => {
    const users = [
      { _id: { toString: () => 'u1' } },
      { _id: { toString: () => 'u2' } },
      { _id: { toString: () => 'u3' } },
    ];
    mockUserRepo.findAll.mockResolvedValue({ data: users as any, total: 3, page: 1, limit: 200, totalPages: 1 });
    mockNotifRepo.save.mockResolvedValue(makeNotification());

    await service.sendToRole(UserRole.PATHOLOGIST, TENANT, 'New Request', 'A test was ordered');

    expect(mockUserRepo.findAll).toHaveBeenCalledWith(TENANT, { role: UserRole.PATHOLOGIST }, 1, 200);
    expect(mockNotifRepo.save).toHaveBeenCalledTimes(3);
  });

  test('does nothing when no users have the role', async () => {
    mockUserRepo.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 200, totalPages: 0 });

    await service.sendToRole(UserRole.RADIOLOGIST, TENANT, 'T', 'M');

    expect(mockNotifRepo.save).not.toHaveBeenCalled();
  });

  test('continues fan-out even when one save fails (Promise.allSettled)', async () => {
    const users = [
      { _id: { toString: () => 'u1' } },
      { _id: { toString: () => 'u2' } },
    ];
    mockUserRepo.findAll.mockResolvedValue({ data: users as any, total: 2, page: 1, limit: 200, totalPages: 1 });
    mockNotifRepo.save
      .mockRejectedValueOnce(new Error('DB write failed'))
      .mockResolvedValueOnce(makeNotification({ userId: 'u2' }));

    await expect(service.sendToRole(UserRole.MANAGER, TENANT, 'T', 'M')).resolves.toBeUndefined();
    expect(mockNotifRepo.save).toHaveBeenCalledTimes(2);
  });
});

// ─── getNotifications ─────────────────────────────────────────────────────────

describe('getNotifications', () => {
  test('returns notifications for the user in descending order', async () => {
    const notifications = [
      makeNotification({ notificationId: 'n2', createdAt: new Date('2026-01-02') }),
      makeNotification({ notificationId: 'n1', createdAt: new Date('2026-01-01') }),
    ];
    mockNotifRepo.findByUser.mockResolvedValue(notifications);

    const result = await service.getNotifications(TENANT, USER, 20);

    expect(mockNotifRepo.findByUser).toHaveBeenCalledWith(TENANT, USER, 20);
    expect(result).toHaveLength(2);
    expect(result[0].notificationId).toBe('n2');
  });

  test('uses default limit of 20 when not specified', async () => {
    mockNotifRepo.findByUser.mockResolvedValue([]);

    await service.getNotifications(TENANT, USER);

    expect(mockNotifRepo.findByUser).toHaveBeenCalledWith(TENANT, USER, 20);
  });
});

// ─── markRead ─────────────────────────────────────────────────────────────────

describe('markRead', () => {
  test('marks the notification as read and returns the updated document', async () => {
    const updated = makeNotification({ isRead: true });
    mockNotifRepo.markRead.mockResolvedValue(updated);

    const result = await service.markRead(TENANT, USER, 'notif-001');

    expect(mockNotifRepo.markRead).toHaveBeenCalledWith(TENANT, USER, 'notif-001');
    expect(result?.isRead).toBe(true);
  });

  test('returns null when notification is not found', async () => {
    mockNotifRepo.markRead.mockResolvedValue(null);

    const result = await service.markRead(TENANT, USER, 'missing-notif');

    expect(result).toBeNull();
  });
});

// ─── countUnread ──────────────────────────────────────────────────────────────

describe('countUnread', () => {
  test('returns the count of unread notifications', async () => {
    mockNotifRepo.countUnread.mockResolvedValue(5);

    const count = await service.countUnread(TENANT, USER);

    expect(mockNotifRepo.countUnread).toHaveBeenCalledWith(TENANT, USER);
    expect(count).toBe(5);
  });

  test('returns 0 when all are read', async () => {
    mockNotifRepo.countUnread.mockResolvedValue(0);

    expect(await service.countUnread(TENANT, USER)).toBe(0);
  });
});
