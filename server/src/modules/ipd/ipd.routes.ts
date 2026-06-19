import { Router } from 'express';
import { authenticateJWT }            from '../../shared/middleware/authenticate-jwt';
import { scopeTenant }                from '../../shared/middleware/scope-tenant';
import { requireRole }                from '../../shared/middleware/require-role';
import { requireFirstPasswordChange } from '../../shared/middleware/require-first-password-change';
import { UserRole }                   from '../../shared/types/common.types';
import {
  createAdmission,
  listAdmissions,
  getAdmissionById,
  updateAdmission,
  addProgressNote,
  dischargePatient,
  getPatientIPDHistory,
  getBedOccupancySummary,
  createWard,
  listWards,
  addBeds,
  listBeds,
  getOccupancySummary,
  assignNurses,
} from './ipd.controller';

const router  = Router();
const protect = [authenticateJWT, scopeTenant, requireFirstPasswordChange];
const ADMIN_ROLES = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN];

// POST /api/ipd/admissions — Receptionist creates admission + assigns bed
router.post(
  '/admissions',
  ...protect,
  requireRole(
    UserRole.RECEPTIONIST,
    UserRole.ADMIN,
    UserRole.HOSPITAL_ADMIN,
    UserRole.NURSE,
     ...ADMIN_ROLES),
  createAdmission,
);



// GET /api/ipd/admissions — List admissions (filterable by ward and status)
router.get(
  '/admissions',
  ...protect,
  requireRole(
    UserRole.RECEPTIONIST,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MANAGER,
    ...ADMIN_ROLES,
  ),
  listAdmissions,
);

// GET /api/ipd/admissions/:admissionId — Get single admission by ID
router.get(
  '/admissions/:admissionId',
  ...protect,
  requireRole(
    UserRole.RECEPTIONIST,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.MANAGER,
    ...ADMIN_ROLES,
  ),
  getAdmissionById,
);

// PATCH /api/ipd/admissions/:admissionId — Update assigned doctor (Admin/Receptionist/Doctor/Nurse)
router.patch(
  '/admissions/:admissionId',
  ...protect,
  requireRole(
    UserRole.RECEPTIONIST,
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.ADMIN,
    UserRole.HOSPITAL_ADMIN,
  ),
  updateAdmission,
);

// POST /api/ipd/admissions/:admissionId/progress-notes — Doctor/Nurse records daily note
router.post(
  '/admissions/:admissionId/progress-notes',
  ...protect,
  requireRole(UserRole.DOCTOR, UserRole.NURSE),
  addProgressNote,
);

// PATCH /api/ipd/admissions/:admissionId/discharge — Doctor/Nurse/Admin/Receptionist discharges patient
router.patch(
  '/admissions/:admissionId/discharge',
  ...protect,
  requireRole(
    UserRole.DOCTOR,
    UserRole.NURSE,
    UserRole.HOSPITAL_ADMIN,
    UserRole.ADMIN,
    UserRole.RECEPTIONIST,
  ),
  dischargePatient,
);

// GET /api/ipd/bed-occupancy — Ward occupancy summary
router.get(
  '/bed-occupancy',
  ...protect,
  requireRole(
    UserRole.MANAGER,
    UserRole.DOCTOR,
    UserRole.NURSE,
    ...ADMIN_ROLES,
    UserRole.RECEPTIONIST,
  ),
  getBedOccupancySummary,
);

// All clinical roles need ward/bed visibility to select beds during admission
const WARD_READERS = [
  ...ADMIN_ROLES,
  UserRole.MANAGER,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
];

// Admission readers — AC6: Nurse/Doctor; + Manager/Admin/Receptionist for lookup (U3-B)
const ADMISSION_READERS = [
  ...ADMIN_ROLES,
  UserRole.MANAGER,
  UserRole.DOCTOR,
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
];

// GET /api/ipd/patients/:patientId/history — IPD admission history for a patient
router.get(
  '/patients/:patientId/history',
  ...protect,
  requireRole(...ADMISSION_READERS),
  getPatientIPDHistory,
);

// ─── Ward routes ──────────────────────────────────────────────────────────────
router.post('/wards',
  ...protect,
  requireRole(...ADMIN_ROLES,
  UserRole.RECEPTIONIST,
  UserRole.MANAGER,
  ),
  createWard,
);

router.get('/wards',
  ...protect,
  requireRole(...WARD_READERS),
  listWards,
);

// PATCH /api/ipd/wards/:wardId/nurses — HOSPITAL_ADMIN and DOCTOR assign nurses
router.patch('/wards/:wardId/nurses',
  ...protect,
  requireRole(UserRole.HOSPITAL_ADMIN, UserRole.DOCTOR),
  assignNurses,
);

// ─── Bed routes ───────────────────────────────────────────────────────────────
router.post('/wards/:wardId/beds',
  ...protect,
  requireRole(...ADMIN_ROLES,
    UserRole.RECEPTIONIST,
    UserRole.MANAGER,
  ),
  addBeds,
);

router.get('/wards/:wardId/beds',
  ...protect,
  requireRole(...WARD_READERS),
  listBeds,
);

// ─── Occupancy summary — Manager + Hospital Admin + Nurse (FR-08.8) ──────────
router.get('/occupancy',
  ...protect,
  requireRole(...ADMIN_ROLES, UserRole.MANAGER, UserRole.NURSE),
  getOccupancySummary,
);

export { ADMISSION_READERS };   // U3-B admission routes will import this
export default router;
