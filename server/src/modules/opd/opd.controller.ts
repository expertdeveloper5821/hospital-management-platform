import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { opdService } from './opd.service';
import { IOPDVisit } from './opd.model';
import { ValidationError, NotFoundError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';
import { stripRichTextTags } from '../../shared/utils/validation';

// Notes are stored as rich-text HTML (Tiptap) — the 2000-character limit
// applies to the visible text a user typed, not the wrapping markup, so the
// raw string is allowed a generous multiple of that for formatting overhead.
const notesSchema = z.string()
  .max(12000, 'Notes content is too large.')
  .trim()
  .refine((v) => stripRichTextTags(v).length <= 2000, 'Notes cannot exceed 2000 characters.')
  .optional();

const createVisitSchema = z.object({
  patientId:      z.string().min(1),
  doctorIds:      z.array(z.string().min(1)).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes:          notesSchema,
});

const updateVisitSchema = z.object({
  doctorIds:      z.array(z.string().min(1)).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  diagnosis:      z.string().min(1, 'Diagnosis is required.').max(2000, 'Diagnosis cannot exceed 2000 characters.').trim().optional(),
  prescription:   z.string().max(5000, 'Prescription cannot exceed 5000 characters.').optional(),
  notes:          notesSchema,
});

const completeVisitSchema = z.object({
  diagnosis:    z.string().min(1, 'Diagnosis is required.').max(2000, 'Diagnosis cannot exceed 2000 characters.').trim(),
  prescription: z.string().max(5000, 'Prescription cannot exceed 5000 characters.').optional(),
  notes:        notesSchema,
});

const queueQuerySchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  doctorId: z.string().optional(),
  search:   z.string().max(200).trim().optional(),
});

const OPD_STATUS_VALUES = ['OPEN', 'COMPLETED'] as const;

const historyQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(10),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:    z.enum(OPD_STATUS_VALUES).optional(),
  search:    z.string().max(200).optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) return data.startDate <= data.endDate;
    return true;
  },
  { message: 'startDate must not be after endDate', path: ['startDate'] },
);

function toResponse(v: IOPDVisit) {
  return {
    visitId:        v.visitId,
    tenantId:       v.tenantId,
    patientId:      v.patientId,
    fullName:       v.fullName,
    doctorIds:      v.doctorIds,
    departmentId:   v.departmentId ?? null,
    visitDate:      v.visitDate,
    queueNumber:    v.queueNumber,
    status:         v.status,
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

    const visit = await opdService.createVisit(req.user!.tenantId!, body.data, req.user!.userId, req.user!.role);
    res.status(201).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = queueQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');

    const tenantId = req.user!.tenantId!;
    // Doctors always see only their own visits
    const doctorId = req.user!.role === UserRole.DOCTOR
      ? req.user!.userId
      : query.data.doctorId;
    const nursePatientIds = await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role);

    const visits = await opdService.getQueue(tenantId, query.data.date, doctorId, query.data.search, nursePatientIds);
    res.status(200).json({
      status: 'success',
      data: visits.map((v) => toResponse(v)),
    });
  } catch (err) { next(err); }
}

export async function getVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const visit = await opdService.getVisitById(tenantId, req.params.visitId);

    if (req.user!.role === UserRole.NURSE || req.user!.role === UserRole.DOCTOR) {
      const scopedIds = req.user!.role === UserRole.NURSE
        ? await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role)
        : await opdService.resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);
      if (!scopedIds?.includes(visit.patientId)) throw new NotFoundError('OPD visit not found');
    }

    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function updateVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.updateVisit(
      tenantId,
      req.params.visitId,
      body.data,
      req.user!.userId,
      req.user!.role,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function completeVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = completeVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.completeVisit(
      tenantId,
      req.params.visitId,
      body.data,
      req.user!.userId,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function cancelVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.cancelVisit(
      tenantId,
      req.params.visitId,
      req.user!.userId,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function getPatientHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params', { errors: query.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const { page, limit, startDate, endDate, status, search } = query.data;
    const scopedPatientIds = (await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role))
      ?? (await opdService.resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role));
    const result = await opdService.getPatientHistory(
      tenantId,
      req.params.patientId,
      { page, limit, startDate, endDate, status, search },
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
