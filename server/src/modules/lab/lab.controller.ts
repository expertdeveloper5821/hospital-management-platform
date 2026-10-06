import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { labService } from './lab.service';
import {
  CreatePathologyRequestSchema,
  CreateRadiologyRequestSchema,
  EditPathologyRequestSchema,
  EditRadiologyRequestSchema,
  ListLabRequestsQuerySchema,
  CollectLabPaymentSchema,
  SubmitPathologyTestReportSchema,
  UpdatePathologyTestMasterSchema,
} from './lab.types';
import { UserRole } from '../../shared/types/common.types';
import { opdRepository } from '../opd/opd.repository';
import { ipdRepository } from '../ipd/ipd.repository';

// A Doctor may only create/view lab requests for patients they've been
// assigned to — via an OPD visit (doctorIds) or an IPD admission
// (assignedDoctorIds), current or past. Returns undefined for any other role
// (no restriction applied).
async function resolveDoctorPatientIds(tenantId: string, userId: string, role: string): Promise<string[] | undefined> {
  if (role !== UserRole.DOCTOR) return undefined;
  const [opdIds, ipdIds] = await Promise.all([
    opdRepository.findPatientIdsByDoctor(tenantId, userId),
    ipdRepository.findPatientIdsByAssignedDoctor(tenantId, userId),
  ]);
  return [...new Set([...opdIds, ...ipdIds])];
}

// Read access (list/get) additionally covers requests where the Doctor was
// selected as "Referred By". Undefined for any other role.
function referredByDoctorId(userId: string, role: string): string | undefined {
  return role === UserRole.DOCTOR ? userId : undefined;
}

const requestIdSchema = z.string().uuid('requestId must be a valid UUID');

// ─── Pathology ────────────────────────────────────────────────────────────────

export async function createPathologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreatePathologyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.createPathologyRequest(
      parsed.data, tenantId, req.user!.userId, allowedPatientIds,
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function listPathologyRequests(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListLabRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const tenantId = req.user!.tenantId as string;
    const doctorPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.listPathologyRequests(
      tenantId, parsed.data, doctorPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getPathologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.getPathologyRequest(
      id.data, tenantId, allowedPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── Structured Pathology test reports ────────────────────────────────────────
// :testIndex is the test's position in the request's testType (0-based).
const testIndexSchema = z.coerce.number().int().min(0).max(99);

// ─── Pathology Test Master ────────────────────────────────────────────────────

const templateKeySchema = z.string().regex(/^[A-Z0-9_]{1,64}$/, 'Invalid test key');

// GET /api/lab/pathology/test-master — every test's clinical content
// (Clinical Note, Comment, Please Correlate Clinically), in catalog order.
export async function listPathologyTestMaster(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const result = await labService.listPathologyTestMaster(req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// PATCH /api/lab/pathology/test-master/:templateKey — edit one test's content.
// Audit logging happens in PathologyTestMasterService.
export async function updatePathologyTestMaster(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const key = templateKeySchema.safeParse(req.params['templateKey']);
    if (!key.success) { res.status(400).json({ status: 'error', message: 'Invalid test key' }); return; }

    const parsed = UpdatePathologyTestMasterSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      res.status(400).json({
        status: 'error',
        message: flat.formErrors[0] ?? 'Validation failed',
        details: flat.fieldErrors,
      });
      return;
    }

    const result = await labService.updatePathologyTestMaster(
      req.user!.tenantId as string, key.data, req.user!.userId, parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// PUT /api/lab/pathology/:requestId/reports/:testIndex — submit / amend one
// test's structured report. Audit logging happens in LabService (values redacted).
export async function submitPathologyTestReport(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const index = testIndexSchema.safeParse(req.params['testIndex']);
    if (!index.success) { res.status(400).json({ status: 'error', message: 'Invalid testIndex' }); return; }

    const parsed = SubmitPathologyTestReportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const result = await labService.submitPathologyTestReport(
      id.data, index.data, req.user!.tenantId as string, req.user!.userId, parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// GET /api/lab/pathology/:requestId/reports/:testIndex/pdf — one test's report
// PDF. Same readers (and Doctor scoping) as GET /pathology/:requestId.
// `?letterhead=true` (downloaded copy) adds the hospital letterhead.
export async function getPathologyTestReportPdf(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const index = testIndexSchema.safeParse(req.params['testIndex']);
    if (!index.success) { res.status(400).json({ status: 'error', message: 'Invalid testIndex' }); return; }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const { buffer, fileName } = await labService.getPathologyTestReportPdf(
      id.data, index.data, tenantId, allowedPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
      req.query['letterhead'] === 'true',
    );
    res.status(200)
      .set({
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Content-Length':      buffer.length.toString(),
        'Cache-Control':       'no-store',
      })
      .send(buffer);
  } catch (err) { next(err); }
}

// GET /api/lab/pathology/:requestId/reports/pdf — every submitted test report
// of the request combined into one PDF (bulk Download / Print). Same readers
// (and Doctor scoping) as the per-test PDF; `?letterhead=true` likewise.
export async function getAllPathologyTestReportsPdf(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const { buffer, fileName } = await labService.getAllPathologyTestReportsPdf(
      id.data, tenantId, allowedPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
      req.query['letterhead'] === 'true',
    );
    res.status(200)
      .set({
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${fileName}"`,
        'Content-Length':      buffer.length.toString(),
        'Cache-Control':       'no-store',
      })
      .send(buffer);
  } catch (err) { next(err); }
}

// ─── Radiology ────────────────────────────────────────────────────────────────

export async function createRadiologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateRadiologyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.createRadiologyRequest(
      parsed.data, tenantId, req.user!.userId, allowedPatientIds,
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function listRadiologyRequests(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListLabRequestsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const tenantId = req.user!.tenantId as string;
    const doctorPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.listRadiologyRequests(
      tenantId, parsed.data, doctorPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getRadiologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.getRadiologyRequest(
      id.data, tenantId, allowedPatientIds, referredByDoctorId(req.user!.userId, req.user!.role),
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// multipart/form-data upload — multer populates req.file from the "report" field.
export async function uploadRadiologyReport(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    if (!req.file) {
      res.status(400).json({ status: 'error', message: 'No file uploaded — send the file in the "report" field' });
      return;
    }

    const result = await labService.uploadRadiologyReport(
      id.data,
      req.user!.tenantId as string,
      req.user!.userId,
      req.file.buffer,
      req.file.mimetype,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── Edit & Delete — Pathology ────────────────────────────────────────────────

export async function editPathologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    const parsed = EditPathologyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.editPathologyRequest(
      id.data, tenantId, req.user!.userId, parsed.data, allowedPatientIds, req.user!.role as UserRole,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function deletePathologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    await labService.deletePathologyRequest(
      id.data, tenantId, req.user!.userId, req.user!.role as UserRole, allowedPatientIds,
    );
    res.status(200).json({ status: 'success', message: 'Pathology request deleted.' });
  } catch (err) { next(err); }
}

// ─── Edit & Delete — Radiology ────────────────────────────────────────────────

export async function editRadiologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    const parsed = EditRadiologyRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    const result = await labService.editRadiologyRequest(
      id.data, tenantId, req.user!.userId, parsed.data, allowedPatientIds, req.user!.role as UserRole,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function deleteRadiologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    const tenantId = req.user!.tenantId as string;
    const allowedPatientIds = await resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
    await labService.deleteRadiologyRequest(
      id.data, tenantId, req.user!.userId, req.user!.role as UserRole, allowedPatientIds,
    );
    res.status(200).json({ status: 'success', message: 'Radiology request deleted.' });
  } catch (err) { next(err); }
}

// ─── Payment collection ───────────────────────────────────────────────────────
// Audit logging happens in PaymentService.createManualPayment (PAYMENT_RECORD).

function collectPaymentHandler(kind: 'pathology' | 'radiology') {
  return async function collectPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = requestIdSchema.safeParse(req.params['requestId']);
      if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

      const parsed = CollectLabPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
        return;
      }

      const result = await labService.collectPayment(
        kind, id.data, req.user!.tenantId as string, req.user!.userId, parsed.data,
      );
      res.status(201).json({ status: 'success', data: result });
    } catch (err) { next(err); }
  };
}

export const collectPathologyPayment = collectPaymentHandler('pathology');
export const collectRadiologyPayment = collectPaymentHandler('radiology');

// ─── Test types ────────────────────────────────────────────────────────────────

export async function listTestTypes(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const result = await labService.listTestTypes(req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
