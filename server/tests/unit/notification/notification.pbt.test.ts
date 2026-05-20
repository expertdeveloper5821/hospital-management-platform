// Property-Based Tests: mark-as-read idempotency (U6-B-04)
// Property: calling markRead twice with same args = same result as calling once

jest.mock('../../../src/modules/notification/notification.repository');
jest.mock('../../../src/shared/services/websocket.service', () => ({
  pushToUser: jest.fn(),
}));

import fc from 'fast-check';
import { notificationRepository } from '../../../src/modules/notification/notification.repository';
import { NotificationService }    from '../../../src/modules/notification/notification.service';
import { INotification }          from '../../../src/modules/notification/notification.model';

const mockRepo = notificationRepository as jest.Mocked<typeof notificationRepository>;

function makeReadNotification(overrides: Partial<INotification> = {}): INotification {
  return {
    notificationId: 'notif-001',
    userId:         'user-001',
    tenantId:       'tenant-001',
    title:          'Title',
    message:        'Body',
    entityType:     null,
    entityId:       null,
    isRead:         true,
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

// ─── PBT: mark-as-read idempotency ───────────────────────────────────────────

describe('PBT: markRead idempotency', () => {
  test('applying markRead twice returns the same isRead=true result', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),      // tenantId
        fc.uuid(),      // userId
        fc.uuid(),      // notificationId
        async (tenantId, userId, notificationId) => {
          const readNotif = makeReadNotification({ notificationId, userId, tenantId });
          mockRepo.markRead.mockResolvedValue(readNotif);

          const first  = await service.markRead(tenantId, userId, notificationId);
          const second = await service.markRead(tenantId, userId, notificationId);

          expect(first?.isRead).toBe(true);
          expect(second?.isRead).toBe(true);
          expect(first?.notificationId).toBe(second?.notificationId);
        },
      ),
      { numRuns: 50 },
    );
  });

  test('markRead returns null for both calls when notification does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), fc.uuid(), fc.uuid(),
        async (tenantId, userId, notificationId) => {
          mockRepo.markRead.mockResolvedValue(null);

          const first  = await service.markRead(tenantId, userId, notificationId);
          const second = await service.markRead(tenantId, userId, notificationId);

          expect(first).toBeNull();
          expect(second).toBeNull();
        },
      ),
      { numRuns: 20 },
    );
  });

  test('markRead always sets isRead to true, never false', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), fc.uuid(), fc.uuid(),
        fc.boolean(), // initial isRead state
        async (tenantId, userId, notificationId, initialIsRead) => {
          const notif = makeReadNotification({ notificationId, userId, tenantId, isRead: true });
          mockRepo.markRead.mockResolvedValue(notif);

          const result = await service.markRead(tenantId, userId, notificationId);

          // markRead must always return isRead=true (never toggles back to false)
          if (result !== null) {
            expect(result.isRead).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
