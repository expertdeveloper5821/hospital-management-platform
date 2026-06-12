import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ipdService } from './ipd.service';
import { ValidationError } from '../../shared/middleware/error-handler';
import {
  CreateAdmissionSchema,
  AddProgressNoteSchema,
  ListAdmissionsQuerySchema,
} from './ipd.types';
import { IWard } from './ward.model';
import { IBed  } from './bed.model';
import mongoose from 'mongoose';
import { UserRole } from '../../shared/types/common.types';

const admissionIdSchema = z.string().uuid('admissionId must be a valid UUID');

const createWardSchema = z.object({
  name:  z.string().min(1).max(100).trim(),
  floor: z.string().min(1).max(50).trim().optional(),
});

const addBedsSchema = z.object({
  bedNumbers: z
    .array(z.string().min(1).max(20).trim())
    .min(1, 'Provide at least one bed number')
    .max(50, 'Cannot add more than 50 beds at once'),
});

// ─── Response shapers ─────────────────────────────────────────────────────────

function toWardResponse(w: IWard) {
  return {
    wardId:    (w._id as mongoose.Types.ObjectId).toString(),
    name:      w.name,
    floor:     w.floor ?? null,
    tenantId:  w.tenantId,
    createdAt: w.createdAt,
  };
}

function toBedResponse(b: IBed) {
  return {
    bedId:              (b._id as mongoose.Types.ObjectId).toString(),
    wardId:             b.wardId,
    bedNumber:          b.bedNumber,
    isOccupied:         b.isOccupied,
    currentAdmissionId: b.currentAdmissionId ?? null,
    tenantId:           b.tenantId,
    createdAt:          b.createdAt,
  };
}

// ─── U3-B: Admission controllers ─────────────────────────────────────────────

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

export async function getAdmissionById(
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

    const tenantId  = req.user!.tenantId as string;
    const admission = await ipdService.getAdmissionById(idResult.data, tenantId);
    res.status(200).json({ status: 'success', data: admission });
  } catch (err) { next(err); }
}

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

    const assignedDoctorId = req.user!.role === UserRole.DOCTOR ? req.user!.userId : undefined;
    const result = await ipdService.listAdmissions(tenantId, parsed.data, assignedDoctorId);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) {
    next(err);
  }
}

const updateAdmissionSchema = z.object({
  assignedDoctorId: z.string().min(1).optional(),
  wardId:           z.string().min(1).optional(),
  bedId:            z.string().min(1).optional(),
}).refine((d) => d.assignedDoctorId || d.wardId || d.bedId, {
  message: 'Provide at least one field to update',
});

export async function updateAdmission(
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

    const body = updateAdmissionSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const tenantId = req.user!.tenantId as string;
    const result   = await ipdService.updateAdmission(
      idResult.data,
      tenantId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

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

export async function getPatientIPDHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { patientId } = req.params;
    const page   = Math.max(1, parseInt(String(req.query['page']  ?? '1'),  10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(String(req.query['limit'] ?? '10'), 10) || 10));
    const status = req.query['status'] as 'ADMITTED' | 'DISCHARGED' | undefined;

    const tenantId = req.user!.tenantId as string;
    const result   = await ipdService.getPatientHistory(tenantId, patientId, page, limit, status);

    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

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

// ─── U3-A: Ward controllers ───────────────────────────────────────────────────

export async function createWard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createWardSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const ward = await ipdService.createWard(
      req.user!.tenantId!,
      body.data,
      req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: toWardResponse(ward) });
  } catch (err) { next(err); }
}

export async function listWards(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const wards = await ipdService.listWards(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: wards.map(toWardResponse) });
  } catch (err) { next(err); }
}

// ─── U3-A: Bed controllers ────────────────────────────────────────────────────

export async function addBeds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = addBedsSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const beds = await ipdService.addBedsToWard(
      req.user!.tenantId!,
      req.params.wardId,
      body.data,
      req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: beds.map(toBedResponse) });
  } catch (err) { next(err); }
}

export async function listBeds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const beds = await ipdService.listBedsInWard(req.user!.tenantId!, req.params.wardId);
    res.status(200).json({ status: 'success', data: beds.map(toBedResponse) });
  } catch (err) { next(err); }
}

// ─── U3-A: Occupancy summary ──────────────────────────────────────────────────

export async function getOccupancySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await ipdService.getOccupancySummary(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: summary });
  } catch (err) { next(err); }
}
