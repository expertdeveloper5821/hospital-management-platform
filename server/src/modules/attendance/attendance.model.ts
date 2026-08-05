import mongoose, { Schema, Document } from 'mongoose';

export type AttendanceStatus = 'PRESENT' | 'IN_PROGRESS' | 'ABSENT';

export interface IAttendance extends Document {
  attendanceId:   string;
  tenantId:       string;
  userId:         string;
  attendanceDate: Date; // UTC midnight of the calendar day
  checkIn:        Date | null;
  checkOut:       Date | null;
  totalHours:     number | null;
  status:         AttendanceStatus;
  createdAt:      Date;
  updatedAt:      Date;
}

const AttendanceSchema = new Schema<IAttendance>(
  {
    attendanceId:   { type: String, required: true, unique: true },
    tenantId:       { type: String, required: true, index: true },
    userId:         { type: String, required: true },
    attendanceDate: { type: Date,   required: true },
    checkIn:        { type: Date,   default: null },
    checkOut:       { type: Date,   default: null },
    totalHours:     { type: Number, default: null },
    status:         { type: String, enum: ['PRESENT', 'IN_PROGRESS', 'ABSENT'], required: true },
  },
  { timestamps: true, collection: 'attendances' },
);

// tenantId first (NFR-01)
AttendanceSchema.index({ tenantId: 1, userId: 1, attendanceDate: 1 }, { unique: true });

export const AttendanceModel = mongoose.model<IAttendance>('Attendance', AttendanceSchema);
