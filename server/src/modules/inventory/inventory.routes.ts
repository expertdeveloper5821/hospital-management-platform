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
  updateInventoryItem,
  deleteInventoryItem,
  getStockHistory,
} from './inventory.controller';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

router.post(
  '/',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  createInventoryItem,
);

router.get(
  '/',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST),
  listInventoryItems,
);

router.get(
  '/:itemId',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST),
  getInventoryItem,
);

router.patch(
  '/:itemId/stock',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  updateStock,
);

router.patch(
  '/:itemId/threshold',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  updateThreshold,
);

router.get(
  '/:itemId/stock-history',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  getStockHistory,
);

router.patch(
  '/:itemId',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  updateInventoryItem,
);

router.delete(
  '/:itemId',
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  deleteInventoryItem,
);

export default router;
