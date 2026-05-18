import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ipdService } from './ipd.service';
import {
  CreateAdmissionSchema,
  AddProgressNoteSchema,
  ListAdmissionsQuerySchema,
} from './ipd.types';

const admissionIdSchema = z.string().uuid('admissionId must be a valid UUID');

// ─── POST /api/ipd/admissions ─────────────────────────────────────────────────
export async function createAdmission(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateAdmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const userId   = req.user!.userId;
    const result   = await ipdService.createAdmission(parsed.data, tenantId, userId);

    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/ipd/admissions ──────────────────────────────────────────────────
export async function listAdmissions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListAdmissionsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Invalid query parameters',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const result   = await ipdService.listAdmissions(tenantId, parsed.data);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/ipd/admissions/:admissionId/progress-notes ────────────────────
export async function addProgressNote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idResult = admissionIdSchema.safeParse(req.params['admissionId']);
    if (!idResult.success) {
      res.status(400).json({ status: 'error', message: 'Invalid admission ID format' });
      return;
    }

    const parsed = AddProgressNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const userId   = req.user!.userId;
    const result   = await ipdService.addProgressNote(
      idResult.data,
      parsed.data,
      tenantId,
      userId,
    );

    res.status(201).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /api/ipd/admissions/:admissionId/discharge ────────────────────────
export async function dischargePatient(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const idResult = admissionIdSchema.safeParse(req.params['admissionId']);
    if (!idResult.success) {
      res.status(400).json({ status: 'error', message: 'Invalid admission ID format' });
      return;
    }

    const tenantId = req.user!.tenantId as string;
    const userId   = req.user!.userId;
    const result   = await ipdService.dischargePatient(idResult.data, tenantId, userId);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/ipd/bed-occupancy ───────────────────────────────────────────────
export async function getBedOccupancySummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tenantId = req.user!.tenantId as string;
    const result   = await ipdService.getBedOccupancySummary(tenantId);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}
