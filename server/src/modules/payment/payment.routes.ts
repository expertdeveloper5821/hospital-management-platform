import express, { Router } from 'express';
import {
  authenticateJWT,
  scopeTenant,
  requireRole,
} from '../../shared/middleware';
import { UserRole } from '../../shared/types/common.types';
import {
  createManualPayment,
  createRazorpayOrder,
  listPayments,
  getReceiptUrl,
  getPaymentSummary,
} from './payment.controller';

const router: Router = express.Router();

router.use(authenticateJWT, scopeTenant);

// POST /api/payments/manual — record a Cash/Cheque payment (U5-B-05)
router.post(
  '/manual',
  requireRole(UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN),
  createManualPayment,
);

// POST /api/payments/razorpay-order — initiate a UPI/Card order (U5-C)
router.post(
  '/razorpay-order',
  requireRole(UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN),
  createRazorpayOrder,
);

// GET /api/payments — list with optional filters (U5-B-04)
router.get(
  '/',
  requireRole(
    UserRole.MANAGER, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN,
    UserRole.RECEPTIONIST,
  ),
  listPayments,
);

// GET /api/payments/summary — totals by method (U5-B-04)
router.get(
  '/summary',
  requireRole(UserRole.MANAGER, UserRole.FINANCE_MANAGER, UserRole.HOSPITAL_ADMIN),
  getPaymentSummary,
);

// GET /api/payments/:paymentId/receipt — pre-signed download URL (U5-B-04)
router.get(
  '/:paymentId/receipt',
  requireRole(
    UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER,
    UserRole.MANAGER,      UserRole.HOSPITAL_ADMIN,
  ),
  getReceiptUrl,
);

export default router;
