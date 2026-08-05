import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { attendanceService } from './attendance.service';
import { IAttendance } from './attendance.model';
import { ValidationError } from '../../shared/middleware/error-handler';

const currentYear = new Date().getUTCFullYear();

const monthYearQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year:  z.coerce.number().int().min(2000).max(2100).optional(),
});

const listAttendanceQuerySchema = monthYearQuerySchema.extend({
  // Omitted -> tenant-wide report (every active employee, every day of the month).
  userId: z.string().min(1).optional(),
});

const attendanceIdParamSchema = z.object({
  attendanceId: z.string().min(1),
});

const updateAttendanceSchema = z.object({
  checkIn:  z.string().datetime().nullable().optional(),
  checkOut: z.string().datetime().nullable().optional(),
}).refine((d) => d.checkIn !== undefined || d.checkOut !== undefined, {
  message: 'Provide at least one of checkIn or checkOut',
});

function defaultedMonthYear(parsed: { month?: number; year?: number }) {
  const now = new Date();
  return {
    month: parsed.month ?? now.getUTCMonth() + 1,
    year:  parsed.year  ?? now.getUTCFullYear(),
  };
}

function toResponse(a: IAttendance) {
  return {
    attendanceId:   a.attendanceId,
    userId:         a.userId,
    attendanceDate: a.attendanceDate,
    checkIn:        a.checkIn,
    checkOut:       a.checkOut,
    totalHours:     a.totalHours,
    status:         a.status,
  };
}

export async function checkIn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const record = await attendanceService.checkIn(req.user!.tenantId!, req.user!.userId);
    res.status(201).json({ status: 'success', data: toResponse(record) });
  } catch (err) { next(err); }
}

export async function checkOut(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const record = await attendanceService.checkOut(req.user!.tenantId!, req.user!.userId);
    res.status(200).json({ status: 'success', data: toResponse(record) });
  } catch (err) { next(err); }
}

export async function getMyAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = monthYearQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Invalid query', { errors: parsed.error.flatten() });
    const { month, year } = defaultedMonthYear(parsed.data);

    const result = await attendanceService.getMonthlyAttendance(
      req.user!.tenantId!,
      req.user!.userId,
      month,
      year,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function listEmployeeRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const roster = await attendanceService.getEmployeeRoster(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: roster });
  } catch (err) { next(err); }
}

export async function listAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listAttendanceQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new ValidationError('Invalid query', { errors: parsed.error.flatten() });
    const { userId } = parsed.data;
    const { month, year } = defaultedMonthYear(parsed.data);

    const result = userId
      ? await attendanceService.getMonthlyAttendance(req.user!.tenantId!, userId, month, year)
      : await attendanceService.getMonthlyAttendanceForTenant(req.user!.tenantId!, month, year);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function updateAttendance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { attendanceId } = attendanceIdParamSchema.parse(req.params);
    const body = updateAttendanceSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const record = await attendanceService.updateAttendance(
      req.user!.tenantId!,
      attendanceId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(record) });
  } catch (err) { next(err); }
}
