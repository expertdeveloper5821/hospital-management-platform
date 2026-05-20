import { UserRole } from '../../shared/types/common.types';

export interface SendNotificationInput {
  userId:     string;
  tenantId:   string;
  title:      string;
  message:    string;
  entityType: string | null;
  entityId:   string | null;
}

export interface NotificationResponse {
  notificationId: string;
  userId:         string;
  tenantId:       string;
  title:          string;
  message:        string;
  entityType:     string | null;
  entityId:       string | null;
  isRead:         boolean;
  createdAt:      string;
}
