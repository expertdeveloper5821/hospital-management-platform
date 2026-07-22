import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import { addCharge, cancelCharge, markChargePaid, listCharges } from './charges.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

router.post('/',
  ...protect,
  requireRole(
    UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.DOCTOR,
    UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST, UserRole.RECEPTIONIST,
    UserRole.FINANCE_MANAGER,
  ),
  addCharge,
);

router.get('/',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE_MANAGER),
  listCharges,
);

router.patch('/:chargeId/cancel',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER),
  cancelCharge,
);

router.patch('/:chargeId/pay',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER),
  markChargePaid,
);

export default router;
