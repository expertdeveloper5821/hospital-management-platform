import mongoose, { Schema, Document } from 'mongoose';

export type AttendanceStatus = 'PRESENT' | 'IN_PROGRESS' | 'ABSENT';

// GPS fix captured by the employee's device at the moment of self check-in /
// check-out (WGS-84 decimal degrees). Null on legacy rows and on rows created
// or corrected through the admin edit endpoint.
export interface IAttendanceLocation {
  latitude:  number;
  longitude: number;
}

export interface IAttendance extends Document {
  attendanceId:   string;
  tenantId:       string;
  userId:         string;
  attendanceDate: Date; // 00:00 IST (hospital-local midnight) of the calendar day
  checkIn:        Date | null;
  checkOut:       Date | null;
  checkInLocation:  IAttendanceLocation | null;
  checkOutLocation: IAttendanceLocation | null;
  totalHours:     number | null;
  status:         AttendanceStatus;
  createdAt:      Date;
  updatedAt:      Date;
}

const AttendanceLocationSchema = new Schema<IAttendanceLocation>(
  {
    latitude:  { type: Number, required: true, min: -90,  max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false },
);

const AttendanceSchema = new Schema<IAttendance>(
  {
    attendanceId:   { type: String, required: true, unique: true },
    tenantId:       { type: String, required: true, index: true },
    userId:         { type: String, required: true },
    attendanceDate: { type: Date,   required: true },
    checkIn:        { type: Date,   default: null },
    checkOut:       { type: Date,   default: null },
    checkInLocation:  { type: AttendanceLocationSchema, default: null },
    checkOutLocation: { type: AttendanceLocationSchema, default: null },
    totalHours:     { type: Number, default: null },
    status:         { type: String, enum: ['PRESENT', 'IN_PROGRESS', 'ABSENT'], required: true },
  },
  { timestamps: true, collection: 'attendances' },
);

// tenantId first (NFR-01)
AttendanceSchema.index({ tenantId: 1, userId: 1, attendanceDate: 1 }, { unique: true });

export const AttendanceModel = mongoose.model<IAttendance>('Attendance', AttendanceSchema);
