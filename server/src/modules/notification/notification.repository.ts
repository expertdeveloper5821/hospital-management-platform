import { NotificationModel, INotification } from './notification.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

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
      .find({ tenantId, userId })
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

  async countUnread(tenantId: string, userId: string): Promise<number> {
    assertDbConnected();
    return NotificationModel.countDocuments({ tenantId, userId, isRead: false });
  }
}

export const notificationRepository = new NotificationRepository();
