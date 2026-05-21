import { Router } from 'express';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { scopeTenant } from '../../shared/middleware/scope-tenant';
import { requireRole } from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole } from '../../shared/types/common.types';
import { createUser, listUsers, getUserById, updateUserRole, deactivateUser } from './user.controller';

const router = Router();

// All user routes require authentication + tenant scope + first-password-change
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

router.post('/',                          ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR), createUser);
router.get('/',                           ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.HR, UserRole.MANAGER), listUsers);
router.get('/:userId',                    ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR, UserRole.MANAGER), getUserById);
router.patch('/:userId/role',             ...protect, requireRole(UserRole.HOSPITAL_ADMIN), updateUserRole);
router.patch('/:userId/deactivate',       ...protect, requireRole(UserRole.HOSPITAL_ADMIN), deactivateUser);

export default router;
