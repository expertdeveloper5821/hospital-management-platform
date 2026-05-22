import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { notificationService } from './notification.service';

const notificationIdSchema = z.string().uuid('notificationId must be a valid UUID');
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);

export async function getNotifications(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const limit = limitSchema.safeParse(req.query['limit']);
    const data = await notificationService.getNotifications(
      req.user!.tenantId as string,
      req.user!.userId,
      limit.success ? limit.data : 20,
    );
    res.status(200).json({ status: 'success', data });
  } catch (err) { next(err); }
}

export async function getUnreadCount(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const count = await notificationService.countUnread(
      req.user!.tenantId as string,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: { count } });
  } catch (err) { next(err); }
}

export async function markRead(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = notificationIdSchema.safeParse(req.params['notificationId']);
    if (!id.success) {
      res.status(400).json({ status: 'error', message: 'Invalid notificationId format' });
      return;
    }
    const result = await notificationService.markRead(
      req.user!.tenantId as string,
      req.user!.userId,
      id.data,
    );
    if (!result) {
      res.status(404).json({ status: 'error', message: 'Notification not found' });
      return;
    }
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
