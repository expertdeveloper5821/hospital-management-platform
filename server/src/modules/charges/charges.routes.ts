import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import { addCharge, cancelCharge, markChargePaid, listCharges } from './charges.controller';

const router = Router();

// Canonical order: authenticateJWT → scopeTenant → requireRole, with no
// middleware between tenant-scoping and role-authorization. requireFirstPasswordChange
// runs after authorization.
const authAndScope = [authenticateJWT, scopeTenant];

router.post('/',
  ...authAndScope,
  requireRole(
    UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.DOCTOR,
    UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST, UserRole.RECEPTIONIST,
    UserRole.FINANCE_MANAGER,
  ),
  requireFirstPasswordChange,
  addCharge,
);

router.get('/',
  ...authAndScope,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE_MANAGER),
  requireFirstPasswordChange,
  listCharges,
);

router.patch('/:chargeId/cancel',
  ...authAndScope,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER),
  requireFirstPasswordChange,
  cancelCharge,
);

router.patch('/:chargeId/pay',
  ...authAndScope,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER),
  requireFirstPasswordChange,
  markChargePaid,
);

export default router;
