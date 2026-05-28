import { Router } from 'express';
import multer from 'multer';
import { authenticateJWT } from '../../shared/middleware/authenticate-jwt';
import { scopeTenant } from '../../shared/middleware/scope-tenant';
import { requireRole } from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole } from '../../shared/types/common.types';
import {
  createUser, listUsers, getUserById, updateUserRole, deactivateUser, updateUserProfile,
  getMyProfile, updateMyProfile, uploadProfileImage, changeMyPassword,
} from './user.controller';

const router = Router();

// All user routes require authentication + tenant scope + first-password-change
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];

// 2 MB limit; memory storage so the buffer can be forwarded directly to S3
const profileImageUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 2 * 1024 * 1024 },
});

// /me routes — no requireRole; any authenticated user can read/update their own profile
router.get('/me',                         ...protect, getMyProfile);
router.patch('/me/profile',               ...protect, updateMyProfile);
router.post('/me/profile-image',          ...protect, profileImageUpload.single('image'), uploadProfileImage);
router.patch('/me/password',              ...protect, changeMyPassword);

router.post('/',                          ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR), createUser);
router.get('/',                           ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.DOCTOR, UserRole.HR, UserRole.MANAGER), listUsers);
router.get('/:userId',                    ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR, UserRole.MANAGER), getUserById);
router.patch('/:userId',                  ...protect, requireRole(UserRole.HOSPITAL_ADMIN, UserRole.HR), updateUserProfile);
router.patch('/:userId/role',             ...protect, requireRole(UserRole.HOSPITAL_ADMIN), updateUserRole);
router.patch('/:userId/deactivate',       ...protect, requireRole(UserRole.HOSPITAL_ADMIN), deactivateUser);

export default router;
