import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  createAdmission,
  listAdmissions,
  addProgressNote,
  dischargePatient,
  getBedOccupancySummary,
} from './ipd.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

// POST /api/ipd/admissions — Receptionist creates admission + assigns bed
router.post(
  '/admissions',
  ...protect,
  requireRole(UserRole.RECEPTIONIST),
  createAdmission,
);

// GET /api/ipd/admissions — List admissions (filterable by ward and status)
router.get(
  '/admissions',
  ...protect,
  requireRole(
    UserRole.RECEPTIONIST,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MANAGER,
    UserRole.ADMIN,
  ),
  listAdmissions,
);

// POST /api/ipd/admissions/:admissionId/progress-notes — Doctor records daily note
router.post(
  '/admissions/:admissionId/progress-notes',
  ...protect,
  requireRole(UserRole.DOCTOR),
  addProgressNote,
);

// PATCH /api/ipd/admissions/:admissionId/discharge — Doctor discharges patient
router.patch(
  '/admissions/:admissionId/discharge',
  ...protect,
  requireRole(UserRole.DOCTOR),
  dischargePatient,
);

// GET /api/ipd/bed-occupancy — Ward occupancy summary
router.get(
  '/bed-occupancy',
  ...protect,
  requireRole(
    UserRole.MANAGER,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.ADMIN,
    UserRole.RECEPTIONIST,
  ),
  getBedOccupancySummary,
);

export default router;
