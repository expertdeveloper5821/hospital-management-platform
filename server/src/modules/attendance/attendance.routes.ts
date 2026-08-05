import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import { checkIn, checkOut, getMyAttendance, listAttendance, listEmployeeRoster, updateAttendance } from './attendance.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

const ALL_STAFF_ROLES = Object.values(UserRole).filter((role) => role !== UserRole.SUPER_ADMIN);
const MANAGE_ROLES    = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.HR];

router.post('/check-in',       ...protect, requireRole(...ALL_STAFF_ROLES), checkIn);
router.post('/check-out',      ...protect, requireRole(...ALL_STAFF_ROLES), checkOut);
router.get('/my-attendance',   ...protect, requireRole(...ALL_STAFF_ROLES), getMyAttendance);
router.get('/employees',       ...protect, requireRole(...MANAGE_ROLES),    listEmployeeRoster);
router.get('/',                ...protect, requireRole(...MANAGE_ROLES),    listAttendance);
router.patch('/:attendanceId', ...protect, requireRole(...MANAGE_ROLES),    updateAttendance);

export default router;
