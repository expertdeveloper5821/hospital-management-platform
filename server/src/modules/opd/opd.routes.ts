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
  completeVisit,
  cancelVisit,
  getPatientHistory,
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

router.post('/visits',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.HOSPITAL_ADMIN, UserRole.DOCTOR),
  createVisit,
);

router.get('/visits',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getQueue,
);

// /complete and /cancel must come before /:visitId so Express does not treat
// them as the visitId param.
router.patch('/visits/:visitId/complete',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.NURSE, UserRole.HOSPITAL_ADMIN),
  completeVisit,
);

router.patch('/visits/:visitId/cancel',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN),
  cancelVisit,
);

router.get('/visits/:visitId',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getVisit,
);

router.patch('/visits/:visitId',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.NURSE, UserRole.HOSPITAL_ADMIN),
  updateVisit,
);

router.get('/patients/:patientId/history',
  ...protect,
  requireRole(...CLINICAL_ROLES),
  getPatientHistory,
);

export default router;
