import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { opdService } from './opd.service';
import { IOPDVisit } from './opd.model';
import { ValidationError } from '../../shared/middleware/error-handler';

const createVisitSchema = z.object({
  patientId:      z.string().min(1),
  chiefComplaint: z.string().min(1).max(1000).trim(),
  doctorId:       z.string().min(1).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes:          z.string().max(2000).optional(),
});

const updateVisitSchema = z.object({
  chiefComplaint: z.string().min(1).max(1000).trim().optional(),
  doctorId:       z.string().min(1).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  diagnosis:      z.string().min(1).max(2000).trim().optional(),
  prescription:   z.string().max(5000).optional(),
  notes:          z.string().max(2000).optional(),
});

const completeVisitSchema = z.object({
  diagnosis:    z.string().min(1).max(2000).trim(),
  prescription: z.string().max(5000).optional(),
  notes:        z.string().max(2000).optional(),
});

const queueQuerySchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  doctorId: z.string().optional(),
});

const historyQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function toResponse(v: IOPDVisit) {
  return {
    visitId:        v.visitId,
    tenantId:       v.tenantId,
    patientId:      v.patientId,
    fullName:       v.fullName,
    doctorId:       v.doctorId,
    visitDate:      v.visitDate,
    queueNumber:    v.queueNumber,
    status:         v.status,
    chiefComplaint: v.chiefComplaint,
    diagnosis:      v.diagnosis,
    prescription:   v.prescription,
    notes:          v.notes,
    createdAt:      v.createdAt,
    updatedAt:      v.updatedAt,
  };
}

export async function createVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const visit = await opdService.createVisit(req.user!.tenantId!, body.data, req.user!.userId);
    res.status(201).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = queueQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');

    const visits = await opdService.getQueue(req.user!.tenantId!, query.data.date, query.data.doctorId);
    res.status(200).json({
      status: 'success',
      data: visits.map((v) => toResponse(v)),
    });
  } catch (err) { next(err); }
}

export async function getVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const visit = await opdService.getVisitById(req.user!.tenantId!, req.params.visitId);
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function updateVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const visit = await opdService.updateVisit(
      req.user!.tenantId!,
      req.params.visitId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function completeVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = completeVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const visit = await opdService.completeVisit(
      req.user!.tenantId!,
      req.params.visitId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function cancelVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const visit = await opdService.cancelVisit(
      req.user!.tenantId!,
      req.params.visitId,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function getPatientHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');

    const result = await opdService.getPatientHistory(
      req.user!.tenantId!,
      req.params.patientId,
      query.data.page,
      query.data.limit,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
