import express from 'express';
import { authenticateJWT, scopeTenant, requireRole } from '../../shared/middleware';
import { getNotifications, getUnreadCount, markRead, markAllRead } from './notification.controller';
import { UserRole } from '../../shared/types/common.types';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

// All tenant roles receive notifications — mirrors the "all authenticated
// tenant roles" list used by dashboard.routes.ts (SUPER_ADMIN is out of tenant scope).
const ALL_TENANT_ROLES = [
  UserRole.HOSPITAL_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.FINANCE_MANAGER,
  UserRole.PATHOLOGIST,
  UserRole.RADIOLOGIST,
  UserRole.HR,
  UserRole.STAFF,
] as const;

// GET /api/notifications?limit=20
router.get('/', requireRole(...ALL_TENANT_ROLES), getNotifications);

// GET /api/notifications/unread-count  — must be declared before /:notificationId
router.get('/unread-count', requireRole(...ALL_TENANT_ROLES), getUnreadCount);

// PATCH /api/notifications/mark-all-read  — must be declared before /:notificationId/read
router.patch('/mark-all-read', requireRole(...ALL_TENANT_ROLES), markAllRead);

// PATCH /api/notifications/:notificationId/read
router.patch('/:notificationId/read', requireRole(...ALL_TENANT_ROLES), markRead);

export default router;
