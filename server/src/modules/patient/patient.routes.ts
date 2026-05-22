import { Router } from 'express';
import { authenticateJWT }             from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                 from '../../shared/middleware/scope-tenant';
import { requireRole }                 from '../../shared/middleware/require-role';
import { requireFirstPasswordChange }  from '../../shared/middleware/require-first-password-change';
import { UserRole }                    from '../../shared/types/common.types';
import {
  createPatient,
  searchPatients,
  getPatient,
  updatePatient,
  getMedicalCard,
} from './patient.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];
const ADMIN_ROLES = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN];

// Clinical roles that can read patient data
const READERS = [
  UserRole.RECEPTIONIST,
  UserRole.NURSE,
  ...ADMIN_ROLES,
  UserRole.MANAGER,
  UserRole.DOCTOR,
];

router.post('/',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.NURSE, ...ADMIN_ROLES),
  createPatient,
);

router.get('/',
  ...protect,
  requireRole(...READERS),
  searchPatients,
);

// /medical-card must be registered before /:patientId so Express matches the
// literal segment first, not the parameter.
router.get('/:patientId/medical-card',
  ...protect,
  requireRole(...READERS),
  getMedicalCard,
);

router.get('/:patientId',
  ...protect,
  requireRole(...READERS),
  getPatient,
);

router.patch('/:patientId',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, ...ADMIN_ROLES),
  updatePatient,
);

export default router;
