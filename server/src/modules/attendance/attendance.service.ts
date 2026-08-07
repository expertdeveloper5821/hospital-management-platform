import { v4 as uuidv4 } from 'uuid';
import { attendanceRepository } from './attendance.repository';
import { userRepository } from '../user/user.repository';
import { IAttendance, AttendanceStatus } from './attendance.model';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import { ConflictError, NotFoundError, AppError } from '../../shared/middleware/error-handler';
import { UpdateAttendanceRequest, AttendanceMonthResponse, AttendanceRecordResponse, AttendanceSummary, EmployeeRosterEntry } from './attendance.types';
import { getIstDateParts, istMidnightFor, toIstMidnight, toIstDateKey } from './attendance.timezone';

function roundHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function emptySummary(): AttendanceSummary {
  return { totalWorkingDays: 0, daysWorked: 0, presentDays: 0, totalWorkingHours: 0 };
}

// Resolves a requested (month, year) to the day range that has actually
// elapsed: the full month for past months, up through today for the current
// month, and nothing at all for a month entirely in the future. "Today" and
// "current month" are both resolved in hospital-local (IST) calendar terms.
function monthRange(month: number, year: number): { firstDay: Date; rangeEnd: Date; isFuture: boolean } {
  const now      = new Date();
  const istNow   = getIstDateParts(now);
  const today    = toIstMidnight(now);
  const firstDay = istMidnightFor(year, month, 1);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last calendar day of the month
  const lastDay  = istMidnightFor(year, month, daysInMonth);

  const requestedKey = year * 12 + month;
  const currentKey   = istNow.year * 12 + istNow.month;

  if (requestedKey > currentKey) return { firstDay, rangeEnd: lastDay, isFuture: true };

  const rangeEnd = requestedKey === currentKey ? today : lastDay;
  return { firstDay, rangeEnd, isFuture: false };
}

// Builds one row per day in [firstDay, rangeEnd] for a single user, filling
// gaps with an ABSENT row so every date in the range is represented.
function buildDayGrid(
  userId:    string,
  stored:    IAttendance[],
  firstDay:  Date,
  rangeEnd:  Date,
): { records: AttendanceRecordResponse[]; summary: AttendanceSummary } {
  const byDateKey = new Map(stored.map((r) => [toIstDateKey(r.attendanceDate), r]));

  const records: AttendanceRecordResponse[] = [];
  const summary = emptySummary();

  for (let d = new Date(firstDay); d.getTime() <= rangeEnd.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const dateKey = toIstDateKey(d);
    const record  = byDateKey.get(dateKey);

    let status: AttendanceStatus;
    if (record?.checkIn && record?.checkOut) {
      status = 'PRESENT';
    } else if (record?.checkIn) {
      status = 'IN_PROGRESS';
    } else {
      status = 'ABSENT';
    }

    summary.totalWorkingDays += 1;
    if (status === 'PRESENT') {
      summary.daysWorked += 1;
      summary.presentDays += 1;
      summary.totalWorkingHours += record?.totalHours ?? 0;
    }

    records.push({
      attendanceId:   record?.attendanceId ?? null,
      userId,
      attendanceDate: dateKey,
      checkIn:        record?.checkIn ?? null,
      checkOut:       record?.checkOut ?? null,
      totalHours:     record?.totalHours ?? null,
      status,
    });
  }

  summary.totalWorkingHours = Math.round(summary.totalWorkingHours * 100) / 100;
  return { records, summary };
}

export class AttendanceService {
  async checkIn(tenantId: string, userId: string): Promise<IAttendance> {
    const today = toIstMidnight(new Date());
    const existing = await attendanceRepository.findByUserAndDate(tenantId, userId, today);
    if (existing && existing.checkIn) throw new ConflictError('Already checked in today.');

    const now = new Date();
    const record = await attendanceRepository.save({
      attendanceId:   `ATT-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
      tenantId,
      userId,
      attendanceDate: today,
      checkIn:        now,
      checkOut:       null,
      totalHours:     null,
      status:         'IN_PROGRESS',
    });

    await auditService.log({
      entityType: AuditEntityType.ATTENDANCE,
      entityId:   record.attendanceId,
      action:     'CREATE',
      userId,
      tenantId,
      newValue:   { checkIn: now },
    });

    return record;
  }

  async checkOut(tenantId: string, userId: string): Promise<IAttendance> {
    const today = toIstMidnight(new Date());
    const existing = await attendanceRepository.findByUserAndDate(tenantId, userId, today);
    if (!existing || !existing.checkIn) throw new AppError('You must check in before checking out.', 400);
    if (existing.checkOut) throw new ConflictError('Already checked out today.');

    const now = new Date();
    const totalHours = roundHours(now.getTime() - existing.checkIn.getTime());

    const updated = await attendanceRepository.update(tenantId, existing.attendanceId, {
      checkOut: now,
      totalHours,
      status:   'PRESENT',
    });
    if (!updated) throw new NotFoundError('Attendance record not found');

    await auditService.log({
      entityType: AuditEntityType.ATTENDANCE,
      entityId:   existing.attendanceId,
      action:     'UPDATE',
      userId,
      tenantId,
      previousValue: { checkOut: null },
      newValue:      { checkOut: now, totalHours },
    });

    return updated;
  }

  async getMonthlyAttendance(
    tenantId: string,
    userId:   string,
    month:    number, // 1-12
    year:     number,
  ): Promise<AttendanceMonthResponse> {
    const { firstDay, rangeEnd, isFuture } = monthRange(month, year);
    if (isFuture) return { summary: emptySummary(), records: [] };

    const stored = await attendanceRepository.findRangeByUser(tenantId, userId, firstDay, rangeEnd);
    return buildDayGrid(userId, stored, firstDay, rangeEnd);
  }

  // Every active employee in the tenant × every day of the month (up to today
  // for the current month). Absent employees with zero attendance rows still
  // get a full ABSENT row per day — nobody is silently dropped from the grid.
  async getMonthlyAttendanceForTenant(
    tenantId: string,
    month:    number,
    year:     number,
  ): Promise<AttendanceMonthResponse> {
    const { firstDay, rangeEnd, isFuture } = monthRange(month, year);
    if (isFuture) return { summary: emptySummary(), records: [] };

    const employees = await userRepository.findActiveRoster(tenantId);
    if (employees.length === 0) return { summary: emptySummary(), records: [] };

    const userIds = employees.map((e) => e.userId);
    const stored   = await attendanceRepository.findRangeByUsers(tenantId, userIds, firstDay, rangeEnd);

    const storedByUser = new Map<string, IAttendance[]>();
    for (const rec of stored) {
      const list = storedByUser.get(rec.userId) ?? [];
      list.push(rec);
      storedByUser.set(rec.userId, list);
    }

    const records: AttendanceRecordResponse[] = [];
    const summary: AttendanceSummary = emptySummary();

    for (const employee of employees) {
      const grid = buildDayGrid(employee.userId, storedByUser.get(employee.userId) ?? [], firstDay, rangeEnd);
      for (const record of grid.records) {
        records.push({ ...record, employeeName: employee.name });
      }
      summary.totalWorkingDays = grid.summary.totalWorkingDays; // same for every employee (same date range)
      summary.daysWorked        += grid.summary.daysWorked;
      summary.presentDays       += grid.summary.presentDays;
      summary.totalWorkingHours += grid.summary.totalWorkingHours;
    }

    records.sort((a, b) => (
      a.attendanceDate === b.attendanceDate
        ? (a.employeeName ?? '').localeCompare(b.employeeName ?? '')
        : a.attendanceDate.localeCompare(b.attendanceDate)
    ));

    summary.totalWorkingHours = Math.round(summary.totalWorkingHours * 100) / 100;

    return { summary, records };
  }

  // Active-employee roster for the "Employee" filter dropdown — every active
  // user of the current tenant, alphabetical. Deliberately unpaginated (unlike
  // the generic /api/users list) since the dropdown needs the *complete* roster.
  async getEmployeeRoster(tenantId: string): Promise<EmployeeRosterEntry[]> {
    return userRepository.findActiveRoster(tenantId);
  }

  async updateAttendance(
    tenantId:     string,
    attendanceId: string,
    data:         UpdateAttendanceRequest,
    updatedBy:    string,
  ): Promise<IAttendance> {
    const existing = await attendanceRepository.findById(tenantId, attendanceId);
    if (!existing) throw new NotFoundError('Attendance record not found');

    const nextCheckIn  = data.checkIn  !== undefined ? (data.checkIn  ? new Date(data.checkIn)  : null) : existing.checkIn;
    const nextCheckOut = data.checkOut !== undefined ? (data.checkOut ? new Date(data.checkOut) : null) : existing.checkOut;

    if (nextCheckOut && !nextCheckIn) {
      throw new AppError('Cannot set a check-out time without a check-in time.', 400);
    }
    if (nextCheckIn && nextCheckOut && nextCheckOut.getTime() <= nextCheckIn.getTime()) {
      throw new AppError('Check-out time must be after check-in time.', 400);
    }

    let status: AttendanceStatus;
    let totalHours: number | null;
    if (nextCheckIn && nextCheckOut) {
      status = 'PRESENT';
      totalHours = roundHours(nextCheckOut.getTime() - nextCheckIn.getTime());
    } else if (nextCheckIn) {
      status = 'IN_PROGRESS';
      totalHours = null;
    } else {
      status = 'ABSENT';
      totalHours = null;
    }

    const previousValue = { checkIn: existing.checkIn, checkOut: existing.checkOut };
    const updated = await attendanceRepository.update(tenantId, attendanceId, {
      checkIn:  nextCheckIn,
      checkOut: nextCheckOut,
      totalHours,
      status,
    });
    if (!updated) throw new NotFoundError('Attendance record not found');

    await auditService.log({
      entityType: AuditEntityType.ATTENDANCE,
      entityId:   attendanceId,
      action:     'UPDATE',
      userId:     updatedBy,
      tenantId,
      previousValue,
      newValue: { checkIn: nextCheckIn, checkOut: nextCheckOut },
    });

    return updated;
  }
}

export const attendanceService = new AttendanceService();
