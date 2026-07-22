import { NotificationModel, INotification } from './notification.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

// U6-B-01: history capped at last 30 days (FR-N-04) — shared by every query that
// determines what's currently "visible" to the user, so the unread count can
// never include notifications the user has no way to see or mark as read.
function historyWindowStart(): Date {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export class NotificationRepository {
  async save(data: Partial<INotification>): Promise<INotification> {
    assertDbConnected();
    return NotificationModel.create(data);
  }

  async findByUser(
    tenantId: string,
    userId:   string,
    limit     = 20,
  ): Promise<INotification[]> {
    assertDbConnected();
    return NotificationModel
      .find({ tenantId, userId, createdAt: { $gte: historyWindowStart() } })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async markRead(
    tenantId:       string,
    userId:         string,
    notificationId: string,
  ): Promise<INotification | null> {
    assertDbConnected();
    return NotificationModel.findOneAndUpdate(
      { tenantId, userId, notificationId },
      { $set: { isRead: true } },
      { new: true },
    );
  }

  // Matches the same 30-day window as findByUser, so the badge can never get
  // stuck above what "Mark all as read" is able to reach.
  async countUnread(tenantId: string, userId: string): Promise<number> {
    assertDbConnected();
    return NotificationModel.countDocuments({
      tenantId, userId, isRead: false, createdAt: { $gte: historyWindowStart() },
    });
  }

  // Marks every unread notification for the user as read in one atomic write,
  // regardless of the 30-day history window — "mark all" should never leave a
  // stray unread record behind that could resurface unread-count drift later.
  async markAllRead(tenantId: string, userId: string): Promise<number> {
    assertDbConnected();
    const result = await NotificationModel.updateMany(
      { tenantId, userId, isRead: false },
      { $set: { isRead: true } },
    );
    return result.modifiedCount;
  }
}

export const notificationRepository = new NotificationRepository();
