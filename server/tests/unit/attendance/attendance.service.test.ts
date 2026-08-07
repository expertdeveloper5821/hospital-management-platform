jest.mock('../../../src/modules/attendance/attendance.repository');
jest.mock('../../../src/modules/user/user.repository');
jest.mock('../../../src/shared/services/audit.service');

import { attendanceRepository } from '../../../src/modules/attendance/attendance.repository';
import { userRepository }       from '../../../src/modules/user/user.repository';
import { AttendanceService }    from '../../../src/modules/attendance/attendance.service';
import { IAttendance }          from '../../../src/modules/attendance/attendance.model';
import { ConflictError, AppError, NotFoundError } from '../../../src/shared/middleware/error-handler';

const mockRepo     = attendanceRepository as jest.Mocked<typeof attendanceRepository>;
const mockUserRepo = userRepository as jest.Mocked<typeof userRepository>;

const NOW = new Date('2026-08-15T10:00:00.000Z'); // Saturday, Aug 15 2026
const TODAY_MIDNIGHT = new Date('2026-08-15T00:00:00.000Z');

function makeRecord(overrides: Partial<IAttendance> = {}): IAttendance {
  return {
    attendanceId:   'ATT-TEST0001',
    tenantId:       't1',
    userId:         'user-1',
    attendanceDate: TODAY_MIDNIGHT,
    checkIn:        null,
    checkOut:       null,
    totalHours:     null,
    status:         'ABSENT',
    createdAt:      NOW,
    updatedAt:      NOW,
    ...overrides,
  } as IAttendance;
}

describe('AttendanceService', () => {
  let service: AttendanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
    service = new AttendanceService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── checkIn ───────────────────────────────────────────────────────────────
  describe('checkIn', () => {
    test('creates a record with IN_PROGRESS status when none exists for today', async () => {
      mockRepo.findByUserAndDate.mockResolvedValue(null);
      mockRepo.save.mockResolvedValue(makeRecord({ checkIn: NOW, status: 'IN_PROGRESS' }));

      const result = await service.checkIn('t1', 'user-1');

      expect(result.status).toBe('IN_PROGRESS');
      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't1', userId: 'user-1', checkIn: NOW, checkOut: null, status: 'IN_PROGRESS',
        }),
      );
    });

    test('attendanceId has ATT- prefix with 8 uppercase hex chars', async () => {
      mockRepo.findByUserAndDate.mockResolvedValue(null);
      let savedId = '';
      mockRepo.save.mockImplementation(async (data) => {
        savedId = (data as { attendanceId: string }).attendanceId;
        return makeRecord({ attendanceId: savedId });
      });

      await service.checkIn('t1', 'user-1');

      expect(savedId).toMatch(/^ATT-[A-F0-9]{8}$/);
    });

    test('throws ConflictError when already checked in today', async () => {
      mockRepo.findByUserAndDate.mockResolvedValue(makeRecord({ checkIn: NOW, status: 'IN_PROGRESS' }));

      await expect(service.checkIn('t1', 'user-1')).rejects.toThrow(ConflictError);
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── checkOut ──────────────────────────────────────────────────────────────
  describe('checkOut', () => {
    test('sets checkOut, computes totalHours, and marks PRESENT', async () => {
      const checkInTime = new Date('2026-08-15T01:00:00.000Z'); // 9 hours before NOW
      const existing = makeRecord({ checkIn: checkInTime, status: 'IN_PROGRESS' });
      mockRepo.findByUserAndDate.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(makeRecord({ checkIn: checkInTime, checkOut: NOW, totalHours: 9, status: 'PRESENT' }));

      const result = await service.checkOut('t1', 'user-1');

      expect(result.status).toBe('PRESENT');
      expect(mockRepo.update).toHaveBeenCalledWith('t1', existing.attendanceId, {
        checkOut: NOW, totalHours: 9, status: 'PRESENT',
      });
    });

    test('throws AppError(400) when there is no check-in today', async () => {
      mockRepo.findByUserAndDate.mockResolvedValue(null);

      await expect(service.checkOut('t1', 'user-1')).rejects.toThrow(AppError);
      await expect(service.checkOut('t1', 'user-1')).rejects.toMatchObject({ statusCode: 400 });
    });

    test('throws ConflictError when already checked out today', async () => {
      mockRepo.findByUserAndDate.mockResolvedValue(
        makeRecord({ checkIn: NOW, checkOut: NOW, status: 'PRESENT' }),
      );

      await expect(service.checkOut('t1', 'user-1')).rejects.toThrow(ConflictError);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── getMonthlyAttendance ──────────────────────────────────────────────────
  describe('getMonthlyAttendance', () => {
    test('builds a day grid up to today for the current month, classifying each day', async () => {
      // Aug 1 = PRESENT (full day), Aug 15 (today) = IN_PROGRESS, all other elapsed days = ABSENT
      mockRepo.findRangeByUser.mockResolvedValue([
        makeRecord({
          attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
          checkIn:  new Date('2026-08-01T01:00:00.000Z'),
          checkOut: new Date('2026-08-01T09:00:00.000Z'),
          totalHours: 8,
          status: 'PRESENT',
        }),
        makeRecord({
          attendanceDate: TODAY_MIDNIGHT,
          checkIn: NOW,
          checkOut: null,
          totalHours: null,
          status: 'IN_PROGRESS',
        }),
      ]);

      const result = await service.getMonthlyAttendance('t1', 'user-1', 8, 2026);

      expect(result.records).toHaveLength(15); // Aug 1 through Aug 15
      expect(result.records[0]).toMatchObject({ attendanceDate: '2026-08-01', status: 'PRESENT', totalHours: 8 });
      expect(result.records[14]).toMatchObject({ attendanceDate: '2026-08-15', status: 'IN_PROGRESS' });
      // Every day in between has no record -> ABSENT
      expect(result.records.slice(1, 14).every((r) => r.status === 'ABSENT')).toBe(true);

      expect(result.summary).toEqual({
        totalWorkingDays: 15,
        daysWorked: 1,
        presentDays: 1,
        totalWorkingHours: 8,
      });
    });

    test('a past day with check-in but no check-out counts as IN_PROGRESS (missed check-out), not ABSENT', async () => {
      mockRepo.findRangeByUser.mockResolvedValue([
        makeRecord({
          attendanceDate: new Date('2026-08-10T00:00:00.000Z'),
          checkIn: new Date('2026-08-10T01:00:00.000Z'),
          checkOut: null,
          status: 'IN_PROGRESS',
        }),
      ]);

      const result = await service.getMonthlyAttendance('t1', 'user-1', 8, 2026);

      const aug10 = result.records.find((r) => r.attendanceDate === '2026-08-10');
      expect(aug10?.status).toBe('IN_PROGRESS');
      expect(aug10?.checkIn).toEqual(new Date('2026-08-10T01:00:00.000Z'));
      expect(aug10?.checkOut).toBeNull();
      expect(result.summary.presentDays).toBe(0);
    });

    test('a day with no attendance record at all counts as ABSENT', async () => {
      mockRepo.findRangeByUser.mockResolvedValue([]);

      const result = await service.getMonthlyAttendance('t1', 'user-1', 8, 2026);

      expect(result.records.every((r) => r.status === 'ABSENT')).toBe(true);
      expect(result.records).toHaveLength(15);
    });

    test('returns an empty grid for a month entirely in the future', async () => {
      const result = await service.getMonthlyAttendance('t1', 'user-1', 12, 2026);

      expect(result.records).toHaveLength(0);
      expect(result.summary).toEqual({ totalWorkingDays: 0, daysWorked: 0, presentDays: 0, totalWorkingHours: 0 });
      expect(mockRepo.findRangeByUser).not.toHaveBeenCalled();
    });

    test('returns the full month grid for a past month', async () => {
      mockRepo.findRangeByUser.mockResolvedValue([]);

      const result = await service.getMonthlyAttendance('t1', 'user-1', 6, 2026); // June has 30 days

      expect(result.records).toHaveLength(30);
    });
  });

  // ── getMonthlyAttendanceForTenant ─────────────────────────────────────────
  describe('getMonthlyAttendanceForTenant', () => {
    test('builds a day grid for every active employee, tagging each row with employeeName', async () => {
      mockUserRepo.findActiveRoster.mockResolvedValue([
        { userId: 'user-1', name: 'Alice', email: 'alice@test.com' },
        { userId: 'user-2', name: 'Bob',   email: 'bob@test.com' },
      ]);
      mockRepo.findRangeByUsers.mockResolvedValue([
        makeRecord({
          userId: 'user-1',
          attendanceDate: new Date('2026-08-01T00:00:00.000Z'),
          checkIn:  new Date('2026-08-01T01:00:00.000Z'),
          checkOut: new Date('2026-08-01T09:00:00.000Z'),
          totalHours: 8,
          status: 'PRESENT',
        }),
        // user-2 has no attendance rows at all for the range.
      ]);

      const result = await service.getMonthlyAttendanceForTenant('t1', 8, 2026);

      // 15 days (Aug 1-15) x 2 employees.
      expect(result.records).toHaveLength(30);
      expect(mockRepo.findRangeByUsers).toHaveBeenCalledWith('t1', ['user-1', 'user-2'], expect.any(Date), expect.any(Date));

      const bobRecords = result.records.filter((r) => r.userId === 'user-2');
      expect(bobRecords).toHaveLength(15);
      expect(bobRecords.every((r) => r.status === 'ABSENT')).toBe(true);
      expect(bobRecords.every((r) => r.employeeName === 'Bob')).toBe(true);

      const aliceAug1 = result.records.find((r) => r.userId === 'user-1' && r.attendanceDate === '2026-08-01');
      expect(aliceAug1).toMatchObject({ status: 'PRESENT', totalHours: 8, employeeName: 'Alice' });

      expect(result.summary).toEqual({
        totalWorkingDays: 15, daysWorked: 1, presentDays: 1, totalWorkingHours: 8,
      });
    });

    test('returns an empty grid when the tenant has no active employees', async () => {
      mockUserRepo.findActiveRoster.mockResolvedValue([]);

      const result = await service.getMonthlyAttendanceForTenant('t1', 8, 2026);

      expect(result.records).toHaveLength(0);
      expect(mockRepo.findRangeByUsers).not.toHaveBeenCalled();
    });

    test('returns an empty grid for a month entirely in the future without querying employees', async () => {
      const result = await service.getMonthlyAttendanceForTenant('t1', 12, 2026);

      expect(result.records).toHaveLength(0);
      expect(mockUserRepo.findActiveRoster).not.toHaveBeenCalled();
    });
  });

  // ── getEmployeeRoster ─────────────────────────────────────────────────────
  describe('getEmployeeRoster', () => {
    test('delegates to userRepository.findActiveRoster, scoped to the tenant', async () => {
      mockUserRepo.findActiveRoster.mockResolvedValue([
        { userId: 'user-1', name: 'Alice', email: 'alice@test.com' },
        { userId: 'user-2', name: 'Bob',   email: 'bob@test.com' },
      ]);

      const result = await service.getEmployeeRoster('t1');

      expect(mockUserRepo.findActiveRoster).toHaveBeenCalledWith('t1');
      expect(result).toEqual([
        { userId: 'user-1', name: 'Alice', email: 'alice@test.com' },
        { userId: 'user-2', name: 'Bob',   email: 'bob@test.com' },
      ]);
    });
  });

  // ── updateAttendance ──────────────────────────────────────────────────────
  describe('updateAttendance', () => {
    test('recomputes totalHours and status to PRESENT when both times are set', async () => {
      const existing = makeRecord({ checkIn: new Date('2026-08-15T01:00:00.000Z'), checkOut: null, status: 'IN_PROGRESS' });
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(makeRecord({ status: 'PRESENT', totalHours: 8 }));

      const newCheckOut = '2026-08-15T09:00:00.000Z';
      const result = await service.updateAttendance('t1', existing.attendanceId, { checkOut: newCheckOut }, 'admin-1');

      expect(result.status).toBe('PRESENT');
      expect(mockRepo.update).toHaveBeenCalledWith('t1', existing.attendanceId, {
        checkIn: existing.checkIn, checkOut: new Date(newCheckOut), totalHours: 8, status: 'PRESENT',
      });
    });

    test('throws AppError(400) when checkOut is not after checkIn', async () => {
      const existing = makeRecord({ checkIn: new Date('2026-08-15T09:00:00.000Z') });
      mockRepo.findById.mockResolvedValue(existing);

      await expect(
        service.updateAttendance('t1', existing.attendanceId, { checkOut: '2026-08-15T01:00:00.000Z' }, 'admin-1'),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('throws AppError(400) when clearing checkIn while checkOut remains set', async () => {
      const existing = makeRecord({
        checkIn: new Date('2026-08-15T01:00:00.000Z'),
        checkOut: new Date('2026-08-15T09:00:00.000Z'),
        status: 'PRESENT',
      });
      mockRepo.findById.mockResolvedValue(existing);

      await expect(
        service.updateAttendance('t1', existing.attendanceId, { checkIn: null }, 'admin-1'),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    test('throws NotFoundError when the record does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(
        service.updateAttendance('t1', 'ATT-MISSING', { checkOut: '2026-08-15T09:00:00.000Z' }, 'admin-1'),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
