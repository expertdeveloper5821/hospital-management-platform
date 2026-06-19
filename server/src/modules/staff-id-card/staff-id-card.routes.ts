import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import { generateStaffIdCard }        from './staff-id-card.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

router.post(
  '/:userId/generate',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR),
  generateStaffIdCard,
);

export default router;
