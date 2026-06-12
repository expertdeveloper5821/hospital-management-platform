import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { departmentService } from './department.service';
import { IDepartment } from './department.model';
import { ValidationError } from '../../shared/middleware/error-handler';

const createDepartmentSchema = z.object({
  name:         z.string().min(1).max(200).trim(),
  description:  z.string().min(1).max(1000).trim().optional(),
  headDoctorId: z.string().min(1).optional(),
});

const updateDepartmentSchema = z.object({
  name:         z.string().min(1).max(200).trim().optional(),
  description:  z.string().min(1).max(1000).trim().nullable().optional(),
  headDoctorId: z.string().min(1).nullable().optional(),
});

const departmentIdParamSchema = z.object({
  departmentId: z.string().min(1),
});

const updateDoctorAssignmentsSchema = z.object({
  add:    z.array(z.string().min(1)).optional().default([]),
  remove: z.array(z.string().min(1)).optional().default([]),
}).refine((d) => d.add.length + d.remove.length > 0, {
  message: 'Provide at least one userId in add or remove',
});

function toResponse(d: IDepartment) {
  return {
    departmentId:  d.departmentId,
    name:          d.name,
    description:   d.description ?? null,
    headDoctorId:  d.headDoctorId ?? null,
    tenantId:      d.tenantId,
    createdAt:     d.createdAt,
    updatedAt:     d.updatedAt,
  };
}

export async function createDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createDepartmentSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const department = await departmentService.createDepartment(
      req.user!.tenantId!,
      body.data,
      req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: toResponse(department) });
  } catch (err) { next(err); }
}

export async function listDepartments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const departments = await departmentService.listDepartments(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: departments.map(toResponse) });
  } catch (err) { next(err); }
}

export async function getDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { departmentId } = departmentIdParamSchema.parse(req.params);
    const department = await departmentService.getDepartmentById(req.user!.tenantId!, departmentId);
    res.status(200).json({ status: 'success', data: toResponse(department) });
  } catch (err) { next(err); }
}

export async function updateDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { departmentId } = departmentIdParamSchema.parse(req.params);
    const body = updateDepartmentSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const department = await departmentService.updateDepartment(
      req.user!.tenantId!,
      departmentId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(department) });
  } catch (err) { next(err); }
}

export async function updateDepartmentDoctors(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { departmentId } = departmentIdParamSchema.parse(req.params);
    const body = updateDoctorAssignmentsSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    await departmentService.updateDoctorAssignments(
      req.user!.tenantId!,
      departmentId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', message: 'Doctor assignments updated.' });
  } catch (err) { next(err); }
}

export async function deleteDepartment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { departmentId } = departmentIdParamSchema.parse(req.params);
    await departmentService.deleteDepartment(req.user!.tenantId!, departmentId, req.user!.userId);
    res.status(200).json({ status: 'success', message: 'Department deleted.' });
  } catch (err) { next(err); }
}
