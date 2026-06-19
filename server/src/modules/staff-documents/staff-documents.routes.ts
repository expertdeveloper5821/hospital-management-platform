import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  uploadMiddleware,
  uploadDocument,
  listDocuments,
  getOnboardingChecklist,
  softDeleteDocument,
} from './staff-documents.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];
const HR_ADMIN = [UserRole.HOSPITAL_ADMIN, UserRole.HR];

// Literal routes before param routes
router.get('/users/:userId/checklist',
  ...protect,
  requireRole(...HR_ADMIN),
  getOnboardingChecklist,
);

router.post('/users/:userId',
  ...protect,
  requireRole(...HR_ADMIN),
  uploadMiddleware,
  uploadDocument,
);

router.get('/users/:userId',
  ...protect,
  requireRole(...HR_ADMIN),
  listDocuments,
);

router.delete('/:documentId',
  ...protect,
  requireRole(...HR_ADMIN),
  softDeleteDocument,
);

export default router;
