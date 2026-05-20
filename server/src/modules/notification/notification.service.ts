import { v4 as uuidv4 } from 'uuid';
import { notificationRepository } from './notification.repository';
import { userRepository } from '../user/user.repository';
import { INotification } from './notification.model';
import { UserRole } from '../../shared/types/common.types';

export class NotificationService {
  async sendNotification(
    userId:     string,
    tenantId:   string,
    title:      string,
    message:    string,
    entityType: string | null = null,
    entityId:   string | null = null,
  ): Promise<INotification> {
    return notificationRepository.save({
      notificationId: uuidv4(),
      userId,
      tenantId,
      title,
      message,
      entityType,
      entityId,
      isRead: false,
    });
  }

  // Fans out to all active users in the given role (up to 200 per page).
  // Uses Promise.allSettled so one failed save does not block the others.
  async sendToRole(
    role:       UserRole,
    tenantId:   string,
    title:      string,
    message:    string,
    entityType: string | null = null,
    entityId:   string | null = null,
  ): Promise<void> {
    const result = await userRepository.findAll(tenantId, { role }, 1, 200);
    await Promise.allSettled(
      result.data.map((user) =>
        this.sendNotification(
          (user._id as { toString(): string }).toString(),
          tenantId,
          title,
          message,
          entityType,
          entityId,
        ),
      ),
    );
  }

  async getNotifications(tenantId: string, userId: string, limit = 20): Promise<INotification[]> {
    return notificationRepository.findByUser(tenantId, userId, limit);
  }

  async markRead(tenantId: string, userId: string, notificationId: string): Promise<INotification | null> {
    return notificationRepository.markRead(tenantId, userId, notificationId);
  }

  async countUnread(tenantId: string, userId: string): Promise<number> {
    return notificationRepository.countUnread(tenantId, userId);
  }
}

export const notificationService = new NotificationService();
