import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import { addCharge, voidCharge, listCharges } from './charges.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

router.post('/',
  ...protect,
  requireRole(
    UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.DOCTOR,
    UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST, UserRole.RECEPTIONIST,
  ),
  addCharge,
);

router.get('/',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE_MANAGER),
  listCharges,
);

router.patch('/:chargeId/void',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST),
  voidCharge,
);

export default router;
