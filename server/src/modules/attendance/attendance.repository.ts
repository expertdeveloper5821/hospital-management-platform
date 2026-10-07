import { AttendanceModel, IAttendance } from './attendance.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class AttendanceRepository {
  async findByUserAndDate(tenantId: string, userId: string, attendanceDate: Date): Promise<IAttendance | null> {
    assertDbConnected();
    return AttendanceModel.findOne({ tenantId, userId, attendanceDate });
  }

  async findRangeByUser(
    tenantId: string,
    userId:   string,
    startDate: Date,
    endDate:   Date,
  ): Promise<IAttendance[]> {
    assertDbConnected();
    return AttendanceModel.find({
      tenantId,
      userId,
      attendanceDate: { $gte: startDate, $lte: endDate },
    }).sort({ attendanceDate: 1 });
  }

  async findRangeByUsers(
    tenantId:  string,
    userIds:   string[],
    startDate: Date,
    endDate:   Date,
  ): Promise<IAttendance[]> {
    assertDbConnected();
    if (userIds.length === 0) return [];
    return AttendanceModel.find({
      tenantId,
      userId: { $in: userIds },
      attendanceDate: { $gte: startDate, $lte: endDate },
    }).sort({ attendanceDate: 1 });
  }

  // The user's open (checked-in, not yet checked-out) attendance session, if
  // any — the STAFF role-change restriction's active-session check (see
  // UserService.updateUserRole): an unfinalized shift must be closed (check-out
  // or admin correction) before the role can move. Any day's dangling check-in
  // counts, not just today's — a forgotten check-out is exactly the session
  // that must be finalized first.
  async findOpenSession(tenantId: string, userId: string): Promise<IAttendance | null> {
    assertDbConnected();
    return AttendanceModel.findOne({
      tenantId,
      userId,
      checkIn:  { $ne: null },
      checkOut: null,
    }).sort({ attendanceDate: -1 });
  }

  async findById(tenantId: string, attendanceId: string): Promise<IAttendance | null> {
    assertDbConnected();
    return AttendanceModel.findOne({ tenantId, attendanceId });
  }

  async save(data: Partial<IAttendance>): Promise<IAttendance> {
    assertDbConnected();
    return AttendanceModel.create(data);
  }

  async update(
    tenantId:     string,
    attendanceId: string,
    data:         Partial<IAttendance>,
  ): Promise<IAttendance | null> {
    assertDbConnected();
    return AttendanceModel.findOneAndUpdate(
      { tenantId, attendanceId },
      { $set: data },
      { new: true },
    );
  }
}

export const attendanceRepository = new AttendanceRepository();
