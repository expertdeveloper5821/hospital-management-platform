import express, { Router } from 'express';
import { authenticateJWT, requireRole } from '../../shared/middleware';
import { getAuditLogs } from './audit.controller';

const router: Router = express.Router();

// Audit log is accessible by HOSPITAL_ADMIN and SUPER_ADMIN only
router.use(authenticateJWT);

// GET /api/audit
router.get('/', requireRole('HOSPITAL_ADMIN', 'SUPER_ADMIN'), getAuditLogs);

export default router;
