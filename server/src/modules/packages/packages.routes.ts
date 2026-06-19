import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  createPackage,
  listPackages,
  getPackage,
  updatePackage,
  assignPackage,
  cancelAssignment,
} from './packages.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

const ADMIN_ROLES   = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN];
const READER_ROLES  = [
  UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER,
  UserRole.FINANCE_MANAGER, UserRole.RECEPTIONIST, UserRole.DOCTOR,
];
const ASSIGN_ROLES  = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.DOCTOR];
const CANCEL_ROLES  = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST];

router.post('/',
  ...protect,
  requireRole(...ADMIN_ROLES),
  createPackage,
);

router.get('/',
  ...protect,
  requireRole(...READER_ROLES),
  listPackages,
);

router.get('/:packageId',
  ...protect,
  requireRole(...READER_ROLES),
  getPackage,
);

router.patch('/:packageId',
  ...protect,
  requireRole(...ADMIN_ROLES),
  updatePackage,
);

router.post('/:packageId/assignments',
  ...protect,
  requireRole(...ASSIGN_ROLES),
  assignPackage,
);

router.patch('/:packageId/assignments/:assignmentId/cancel',
  ...protect,
  requireRole(...CANCEL_ROLES),
  cancelAssignment,
);

export default router;
