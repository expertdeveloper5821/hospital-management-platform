import { baseApi } from './base.api';
import type { ApiSuccess, AttendanceMonthResponse, AttendanceRecord, EmployeeRosterEntry } from '../types';

export const attendanceApi = baseApi.injectEndpoints({
  endpoints: (build) => ({

    // Active employees of the current tenant, for the "Employee" filter dropdown.
    // Deliberately unpaginated — the generic /api/users list caps `limit` at 100,
    // which silently fails validation (and blanks the dropdown) for larger rosters.
    listEmployeeRoster: build.query<EmployeeRosterEntry[], void>({
      query: () => '/api/attendance/employees',
      transformResponse: (raw: ApiSuccess<EmployeeRosterEntry[]>) => raw.data,
      providesTags: ['Attendance'],
    }),

    checkIn: build.mutation<AttendanceRecord, void>({
      query: () => ({ url: '/api/attendance/check-in', method: 'POST' }),
      transformResponse: (raw: ApiSuccess<AttendanceRecord>) => raw.data,
      invalidatesTags: ['Attendance'],
    }),

    checkOut: build.mutation<AttendanceRecord, void>({
      query: () => ({ url: '/api/attendance/check-out', method: 'POST' }),
      transformResponse: (raw: ApiSuccess<AttendanceRecord>) => raw.data,
      invalidatesTags: ['Attendance'],
    }),

    getMyAttendance: build.query<AttendanceMonthResponse, { month: number; year: number }>({
      query: ({ month, year }) => `/api/attendance/my-attendance?month=${month}&year=${year}`,
      transformResponse: (raw: ApiSuccess<AttendanceMonthResponse>) => raw.data,
      providesTags: ['Attendance'],
    }),

    listAttendance: build.query<AttendanceMonthResponse, { userId: string; month: number; year: number }>({
      query: ({ userId, month, year }) => `/api/attendance?userId=${userId}&month=${month}&year=${year}`,
      transformResponse: (raw: ApiSuccess<AttendanceMonthResponse>) => raw.data,
      providesTags: ['Attendance'],
    }),

    // Tenant-wide report: every active employee × every day of the month.
    listAllAttendance: build.query<AttendanceMonthResponse, { month: number; year: number }>({
      query: ({ month, year }) => `/api/attendance?month=${month}&year=${year}`,
      transformResponse: (raw: ApiSuccess<AttendanceMonthResponse>) => raw.data,
      providesTags: ['Attendance'],
    }),

    updateAttendance: build.mutation<AttendanceRecord, { attendanceId: string; checkIn?: string | null; checkOut?: string | null }>({
      query: ({ attendanceId, ...body }) => ({ url: `/api/attendance/${attendanceId}`, method: 'PATCH', body }),
      transformResponse: (raw: ApiSuccess<AttendanceRecord>) => raw.data,
      invalidatesTags: ['Attendance'],
    }),
  }),
});

export const {
  useListEmployeeRosterQuery,
  useCheckInMutation,
  useCheckOutMutation,
  useGetMyAttendanceQuery,
  useListAttendanceQuery,
  useListAllAttendanceQuery,
  useUpdateAttendanceMutation,
} = attendanceApi;
