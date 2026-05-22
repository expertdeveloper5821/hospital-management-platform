import express from 'express';
import {
  authenticateJWT,
  scopeTenant,
  requireRole,
} from '../../shared/middleware';
import { UserRole } from '../../shared/types/common.types';
import {
  createInventoryItem,
  listInventoryItems,
  getInventoryItem,
  updateStock,
  updateThreshold,
} from './inventory.controller';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

router.post(
  '/',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  createInventoryItem,
);

router.get(
  '/',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST),
  listInventoryItems,
);

router.get(
  '/:itemId',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST),
  getInventoryItem,
);

router.patch(
  '/:itemId/stock',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  updateStock,
);

router.patch(
  '/:itemId/threshold',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  updateThreshold,
);

export default router;
