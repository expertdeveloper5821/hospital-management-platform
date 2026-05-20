import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { labService } from './lab.service';
import {
  CreatePathologyRequestSchema,
  CreateRadiologyRequestSchema,
  ListLabRequestsQuerySchema,
} from './lab.types';

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
    const result = await labService.createPathologyRequest(
      parsed.data, req.user!.tenantId as string, req.user!.userId,
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
    const result = await labService.listPathologyRequests(req.user!.tenantId as string, parsed.data);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getPathologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const result = await labService.getPathologyRequest(id.data, req.user!.tenantId as string);
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
    const result = await labService.createRadiologyRequest(
      parsed.data, req.user!.tenantId as string, req.user!.userId,
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
    const result = await labService.listRadiologyRequests(req.user!.tenantId as string, parsed.data);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getRadiologyRequest(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = requestIdSchema.safeParse(req.params['requestId']);
    if (!id.success) { res.status(400).json({ status: 'error', message: 'Invalid requestId format' }); return; }
    const result = await labService.getRadiologyRequest(id.data, req.user!.tenantId as string);
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
