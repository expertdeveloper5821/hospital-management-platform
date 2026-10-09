import express from 'express';
import multer from 'multer';
import {
  authenticateJWT,
  scopeTenant,
  requireRole,
  idempotencyGuard,
} from '../../shared/middleware';
import { UserRole } from '../../shared/types/common.types';
import { RADIOLOGY_REPORT_MAX_BYTES } from './lab.types';
import {
  createPathologyRequest,
  listPathologyRequests,
  getPathologyRequest,
  editPathologyRequest,
  deletePathologyRequest,
  createRadiologyRequest,
  listRadiologyRequests,
  getRadiologyRequest,
  uploadRadiologyReport,
  editRadiologyRequest,
  deleteRadiologyRequest,
  listTestTypes,
  collectPathologyPayment,
  collectRadiologyPayment,
  submitPathologyTestReport,
  getPathologyTestReportPdf,
  getAllPathologyTestReportsPdf,
  listPathologyTestMaster,
  updatePathologyTestMaster,
  listDisabledPathologyTests,
} from './lab.controller';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

// Multer with memory storage — file lands in req.file.buffer, ready to pipe to S3.
// Radiology only: Pathology has no file upload.
const radiologyUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: RADIOLOGY_REPORT_MAX_BYTES },   // 20 MB
});

// Pathology routes exclude RADIOLOGIST and Radiology routes exclude PATHOLOGIST
// entirely — each lab role only ever sees its own request type.

// ─── Pathology ────────────────────────────────────────────────────────────────

// Pathology Test Master — per-test Clinical Note / Comment / Please Correlate
// Clinically printed on every report. Registered before /pathology/:requestId
// so "test-master" is never parsed as a requestId. Lab staff only (same roles
// as structured report entry).
router.get(
  '/pathology/test-master',
  requireRole(UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN),
  listPathologyTestMaster,
);

router.patch(
  '/pathology/test-master/:templateKey',
  requireRole(UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN),
  updatePathologyTestMaster,
);

// Tests disabled in the Test Master — read by every role that creates or
// edits a pathology request (POST/PATCH /pathology), to hide them from the
// Test Type dropdown. Also registered before /pathology/:requestId.
router.get(
  '/pathology/disabled-tests',
  requireRole(
    UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.NURSE, UserRole.PATHOLOGIST,
    UserRole.RECEPTIONIST, UserRole.MANAGER,
  ),
  listDisabledPathologyTests,
);

router.post(
  '/pathology',
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RECEPTIONIST),
  idempotencyGuard('lab.pathology.create'),
  createPathologyRequest,
);

router.get(
  '/pathology',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.NURSE, UserRole.MANAGER, UserRole.RECEPTIONIST),
  listPathologyRequests,
);

router.get(
  '/pathology/:requestId',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  getPathologyRequest,
);

router.patch(
  '/pathology/:requestId',
  requireRole(UserRole.PATHOLOGIST, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST),
  idempotencyGuard('lab.pathology.update'),
  editPathologyRequest,
);

router.delete(
  '/pathology/:requestId',
  requireRole(UserRole.PATHOLOGIST, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST),
  deletePathologyRequest,
);

// No Pathology report file upload for any role — Pathology reports are created
// only through the structured per-test report form below.

// Structured per-test report entry — lab staff only (no Doctor/Nurse/
// Receptionist). Re-submitting the same test amends its report.
router.put(
  '/pathology/:requestId/reports/:testIndex',
  requireRole(UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN),
  submitPathologyTestReport,
);

// One test's report PDF — same readers as GET /pathology/:requestId.
router.get(
  '/pathology/:requestId/reports/:testIndex/pdf',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  getPathologyTestReportPdf,
);

// Every submitted test report of the request as one PDF (bulk Download / Print)
// — same readers as the per-test PDF.
router.get(
  '/pathology/:requestId/reports/pdf',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  getAllPathologyTestReportsPdf,
);

// ─── Radiology ────────────────────────────────────────────────────────────────

router.post(
  '/radiology',
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.RADIOLOGIST, UserRole.NURSE, UserRole.RECEPTIONIST),
  idempotencyGuard('lab.radiology.create'),
  createRadiologyRequest,
);

router.get(
  '/radiology',
  requireRole(UserRole.DOCTOR, UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  listRadiologyRequests,
);

router.get(
  '/radiology/:requestId',
  requireRole(UserRole.DOCTOR, UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.NURSE, UserRole.RECEPTIONIST),
  getRadiologyRequest,
);

router.patch(
  '/radiology/:requestId',
  requireRole(UserRole.RADIOLOGIST, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST),
  idempotencyGuard('lab.radiology.update'),
  editRadiologyRequest,
);

router.delete(
  '/radiology/:requestId',
  requireRole(UserRole.RADIOLOGIST, UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST),
  deleteRadiologyRequest,
);

// multipart/form-data — field name: "report"
// Multer rejects files > 20 MB with a MulterError (LIMIT_FILE_SIZE → 413).
router.patch(
  '/radiology/:requestId/report',
  requireRole(UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.NURSE),
  radiologyUpload.single('report'),
  uploadRadiologyReport,
);

// ─── Payment collection (Lab section) ─────────────────────────────────────────
// Online-only (deliberately no idempotencyGuard / offline outbox policy):
// duplicate and concurrent collects are rejected with 409 by the payments
// collection's partial unique index. Receipt download reuses
// GET /api/payments/:paymentId/receipt.
router.post(
  '/pathology/:requestId/payment',
  requireRole(UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN),
  collectPathologyPayment,
);

router.post(
  '/radiology/:requestId/payment',
  requireRole(UserRole.RECEPTIONIST, UserRole.HOSPITAL_ADMIN),
  collectRadiologyPayment,
);

// ─── Test types (Billing → Add Charge, category LAB_TEST) ─────────────────────
// Same role set as POST /api/charges, since this feeds that form's Test Type dropdown.
router.get(
  '/test-types',
  requireRole(
    UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.DOCTOR, UserRole.NURSE,
    UserRole.PATHOLOGIST, UserRole.RADIOLOGIST, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER,
  ),
  listTestTypes,
);

export default router;
