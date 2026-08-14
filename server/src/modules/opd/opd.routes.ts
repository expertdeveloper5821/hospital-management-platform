import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  createVisit,
  getQueue,
  getVisit,
  updateVisit,
  startConsultation,
  completeVisit,
  cancelVisit,
  getPatientHistory,
  getPaymentValidity,
} from './opd.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

const CLINICAL_ROLES = [
  UserRole.RECEPTIONIST,
  UserRole.NURSE,
  UserRole.HOSPITAL_ADMIN,
  UserRole.MANAGER,
  UserRole.DOCTOR,
];

// DOCTOR is deliberately excluded — doctors may view and act on visits assigned
// to them, but must not be able to create new OPD visits (UI, direct URL, or API).
// NURSE is also excluded — nurses have view-only access to Doctor Visits and must
// not be able to create, edit, complete, or cancel them.
router.post('/visits',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER),
  createVisit,
);

router.get('/visits',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getQueue,
);

// /start, /complete and /cancel must come before /:visitId so Express does not
// treat them as the visitId param.
router.patch('/visits/:visitId/start',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.NURSE, UserRole.HOSPITAL_ADMIN),
  startConsultation,
);

router.patch('/visits/:visitId/complete',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN),
  completeVisit,
);

router.patch('/visits/:visitId/cancel',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN),
  cancelVisit,
);

router.get('/visits/:visitId',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getVisit,
);

router.patch('/visits/:visitId',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN),
  updateVisit,
);

router.get('/patients/:patientId/history',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getPatientHistory,
);

// Consulted by the New OPD Visit form right after a patient is selected —
// same role set as visit creation (RECEPTIONIST, NURSE, HOSPITAL_ADMIN, MANAGER).
router.get('/patients/:patientId/payment-validity',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER),
  getPaymentValidity,
);

export default router;
