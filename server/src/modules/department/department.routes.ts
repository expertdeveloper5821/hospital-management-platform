import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  createDepartment,
  listDepartments,
  getDepartment,
  updateDepartment,
  updateDepartmentDoctors,
  deleteDepartment,
} from './department.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

const MANAGE_ROLES = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER];
const READ_ROLES   = [
  UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER,
  UserRole.DOCTOR, UserRole.NURSE, UserRole.RECEPTIONIST,
  UserRole.PATHOLOGIST, UserRole.RADIOLOGIST,
];

router.post('/',   ...protect, requireRole(...MANAGE_ROLES), createDepartment);
router.get('/',    ...protect, requireRole(...READ_ROLES),   listDepartments);
router.get('/:departmentId',  ...protect, requireRole(...READ_ROLES),   getDepartment);
router.patch('/:departmentId',         ...protect, requireRole(...MANAGE_ROLES), updateDepartment);
router.patch('/:departmentId/doctors', ...protect, requireRole(...MANAGE_ROLES), updateDepartmentDoctors);
router.delete('/:departmentId',        ...protect, requireRole(...MANAGE_ROLES), deleteDepartment);

export default router;
