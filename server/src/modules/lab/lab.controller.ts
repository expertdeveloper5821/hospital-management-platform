import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { labService } from './lab.service';
import {
  CreatePathologyRequestSchema,
  CreateRadiologyRequestSchema,
  EditPathologyRequestSchema,
  EditRadiologyRequestSchema,
  ListLabRequestsQuerySchema,
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
    const result = await labService.listPathologyRequests(tenantId, parsed.data, doctorPatientIds);
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
    const result = await labService.getPathologyRequest(id.data, tenantId, allowedPatientIds);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// multipart/form-data upload — multer populates req.file from the "report" field.
// Buffer is uploaded directly to S3/LocalStack; reportUrl is returned in the response.
export async function uploadPathologyReport(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }

    if (!req.file) {
      res.status(400).json({ status: 'error', message: 'No file uploaded — send the file in the "report" field' });
      return;
    }

    const result = await labService.uploadPathologyReport(
      id.data,
      req.user!.tenantId as string,
      req.user!.userId,
      req.file.buffer,
      req.file.mimetype,
    );
    res.status(200).json({ status: 'success', data: result });
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
    const result = await labService.listRadiologyRequests(tenantId, parsed.data, doctorPatientIds);
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
    const result = await labService.getRadiologyRequest(id.data, tenantId, allowedPatientIds);
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
      id.data, tenantId, req.user!.userId, parsed.data, allowedPatientIds,
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
      id.data, tenantId, req.user!.userId, parsed.data, allowedPatientIds,
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

// ─── Test types ────────────────────────────────────────────────────────────────

export async function listTestTypes(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const result = await labService.listTestTypes(req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
