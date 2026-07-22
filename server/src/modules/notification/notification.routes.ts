import express from 'express';
import { authenticateJWT, scopeTenant } from '../../shared/middleware';
import { getNotifications, getUnreadCount, markRead, markAllRead } from './notification.controller';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

// GET /api/notifications?limit=20
router.get('/', getNotifications);

// GET /api/notifications/unread-count  — must be declared before /:notificationId
router.get('/unread-count', getUnreadCount);

// PATCH /api/notifications/mark-all-read  — must be declared before /:notificationId/read
router.patch('/mark-all-read', markAllRead);

// PATCH /api/notifications/:notificationId/read
router.patch('/:notificationId/read', markRead);

export default router;
