import mongoose, { Schema, Document } from 'mongoose';

export interface INotification extends Document {
  notificationId: string;
  userId:         string;
  tenantId:       string;
  title:          string;
  message:        string;
  entityType:     string | null;
  entityId:       string | null;
  isRead:         boolean;
  createdAt:      Date;
  updatedAt:      Date;
}

const notificationSchema = new Schema<INotification>(
  {
    notificationId: { type: String, required: true, unique: true },
    userId:         { type: String, required: true },
    tenantId:       { type: String, required: true },
    title:          { type: String, required: true, trim: true, maxlength: 200 },
    message:        { type: String, required: true, trim: true, maxlength: 1000 },
    entityType:     { type: String, default: null },
    entityId:       { type: String, default: null },
    isRead:         { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'notifications',
  },
);

// tenantId first on all compound indexes (NFR-01)
notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1 });
notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

export const NotificationModel = mongoose.model<INotification>('Notification', notificationSchema);
