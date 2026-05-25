import express from 'express';
import multer from 'multer';
import {
  authenticateJWT,
  scopeTenant,
  requireRole,
} from '../../shared/middleware';
import { UserRole } from '../../shared/types/common.types';
import { PATHOLOGY_REPORT_MAX_BYTES, RADIOLOGY_REPORT_MAX_BYTES } from './lab.types';
import {
  createPathologyRequest,
  listPathologyRequests,
  getPathologyRequest,
  uploadPathologyReport,
  createRadiologyRequest,
  listRadiologyRequests,
  getRadiologyRequest,
  uploadRadiologyReport,
} from './lab.controller';

const router = express.Router();

router.use(authenticateJWT, scopeTenant);

// Multer with memory storage — file lands in req.file.buffer, ready to pipe to S3.
// Separate instances enforce different size caps per report type.
const pathologyUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: PATHOLOGY_REPORT_MAX_BYTES },   // 10 MB
});

const radiologyUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: RADIOLOGY_REPORT_MAX_BYTES },   // 20 MB
});

// ─── Pathology ────────────────────────────────────────────────────────────────

router.post(
  '/pathology',
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.NURSE),
  createPathologyRequest,
);

router.get(
  '/pathology',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.NURSE, UserRole.MANAGER),
  listPathologyRequests,
);

router.get(
  '/pathology/:requestId',
  requireRole(UserRole.DOCTOR, UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST, UserRole.NURSE),
  getPathologyRequest,
);

// multipart/form-data — field name: "report"
// Multer rejects files > 10 MB with a MulterError (LIMIT_FILE_SIZE → 413).
router.patch(
  '/pathology/:requestId/report',
  requireRole(UserRole.PATHOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.NURSE),
  pathologyUpload.single('report'),
  uploadPathologyReport,
);

// ─── Radiology ────────────────────────────────────────────────────────────────

router.post(
  '/radiology',
  requireRole(UserRole.DOCTOR, UserRole.HOSPITAL_ADMIN, UserRole.RADIOLOGIST, UserRole.RECEPTIONIST, UserRole.NURSE),
  createRadiologyRequest,
);

router.get(
  '/radiology',
  requireRole(UserRole.DOCTOR, UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST, UserRole.NURSE),
  listRadiologyRequests,
);

router.get(
  '/radiology/:requestId',
  requireRole(UserRole.DOCTOR, UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.MANAGER, UserRole.RECEPTIONIST, UserRole.NURSE),
  getRadiologyRequest,
);

// multipart/form-data — field name: "report"
// Multer rejects files > 20 MB with a MulterError (LIMIT_FILE_SIZE → 413).
router.patch(
  '/radiology/:requestId/report',
  requireRole(UserRole.RADIOLOGIST, UserRole.HOSPITAL_ADMIN, UserRole.RECEPTIONIST, UserRole.NURSE),
  radiologyUpload.single('report'),
  uploadRadiologyReport,
);

export default router;
