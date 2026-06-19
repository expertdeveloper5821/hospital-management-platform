import { Router } from 'express';
import { authenticateJWT }             from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                 from '../../shared/middleware/scope-tenant';
import { requireRole }                 from '../../shared/middleware/require-role';
import { requireFirstPasswordChange }  from '../../shared/middleware/require-first-password-change';
import { UserRole }                    from '../../shared/types/common.types';
import {
  createPatient,
  searchPatients,
  getPatient,
  updatePatient,
  deletePatient,
  getMedicalCard,
} from './patient.controller';
import { getPatientBill }   from '../charges/charges.controller';
import { packageService }   from '../packages/packages.service';

import type { Request, Response, NextFunction } from 'express';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];
const ADMIN_ROLES = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN];

// Clinical roles that can read patient data
const READERS = [
  UserRole.RECEPTIONIST,
  UserRole.NURSE,
  ...ADMIN_ROLES,
  UserRole.MANAGER,
  UserRole.DOCTOR,
  UserRole.FINANCE_MANAGER,
];

router.post('/',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, UserRole.NURSE, ...ADMIN_ROLES),
  createPatient,
);

router.get('/',
  ...protect,
  requireRole(...READERS),
  searchPatients,
);

// Roles that can download patient medical cards.
const MEDICAL_CARD_ROLES = [
  UserRole.RECEPTIONIST,
  UserRole.HOSPITAL_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.DOCTOR,
];

// Literal sub-routes must be before /:patientId to avoid Express treating them as params
router.get('/:patientId/medical-card',
  ...protect,
  requireRole(...MEDICAL_CARD_ROLES),
  getMedicalCard,
);

const BILL_READERS = [
  UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE_MANAGER,
  UserRole.DOCTOR, UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST,
  UserRole.RECEPTIONIST,
];

router.get('/:patientId/bill',
  ...protect,
  requireRole(...BILL_READERS),
  getPatientBill,
);

const ASSIGNMENT_READERS = [
  UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER,
  UserRole.FINANCE_MANAGER, UserRole.RECEPTIONIST, UserRole.DOCTOR,
];

router.get('/:patientId/assignments',
  ...protect,
  requireRole(...ASSIGNMENT_READERS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const assignments = await packageService.listAssignmentsByPatient(
        req.user!.tenantId!,
        req.params.patientId,
      );
      res.status(200).json({ status: 'success', data: assignments });
    } catch (err) { next(err); }
  },
);

router.get('/:patientId',
  ...protect,
  requireRole(...READERS),
  getPatient,
);

router.patch('/:patientId',
  ...protect,
  requireRole(UserRole.RECEPTIONIST, ...ADMIN_ROLES),
  updatePatient,
);

router.delete('/:patientId',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.MANAGER),
  deletePatient,
);

export default router;
