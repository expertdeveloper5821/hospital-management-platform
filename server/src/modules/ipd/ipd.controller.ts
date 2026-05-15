import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ipdService, BedOccupiedError } from './ipd.service';
import { ValidationError } from '../../shared/middleware/error-handler';
import { IWard } from './ward.model';
import { IBed  } from './bed.model';
import mongoose from 'mongoose';

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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

// ─── Controllers ──────────────────────────────────────────────────────────────

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

export async function getOccupancySummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await ipdService.getOccupancySummary(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: summary });
  } catch (err) { next(err); }
}
