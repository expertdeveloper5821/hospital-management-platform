import { AttendanceStatus } from './attendance.model';

export interface UpdateAttendanceRequest {
  checkIn?:  string | null;
  checkOut?: string | null;
}

export interface AttendanceRecordResponse {
  attendanceId:   string | null;
  userId:         string;
  employeeName?:  string; // present only on tenant-wide (all-employees) responses
  attendanceDate: string; // YYYY-MM-DD
  checkIn:        Date | null;
  checkOut:       Date | null;
  totalHours:     number | null;
  status:         AttendanceStatus;
}

export interface AttendanceSummary {
  totalWorkingDays:  number;
  daysWorked:        number;
  presentDays:       number;
  totalWorkingHours: number;
}

export interface AttendanceMonthResponse {
  summary: AttendanceSummary;
  records: AttendanceRecordResponse[];
}

// Active-employee roster entry for the attendance "Employee" filter — same
// shape/ordering as userRepository.findActiveRoster (tenant + isActive scoped,
// sorted alphabetically by name).
export interface EmployeeRosterEntry {
  userId: string;
  name:   string;
  email:  string;
}
