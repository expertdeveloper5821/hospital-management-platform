import { render, screen, fireEvent, act } from '@testing-library/react';
import { AttendanceQuickBar } from '@/components/dashboard/AttendanceQuickBar';

const mockCheckIn  = jest.fn();
const mockCheckOut = jest.fn();
let mockRecord: { checkIn: string | null; checkOut: string | null } | undefined;

jest.mock('@/store/api/attendance.api', () => ({
  useGetMyAttendanceQuery: () => ({
    data: { summary: {}, records: mockRecord ? [mockRecord] : [] },
    isLoading: false,
  }),
  useCheckInMutation:  () => [mockCheckIn,  { isLoading: false }],
  useCheckOutMutation: () => [mockCheckOut, { isLoading: false }],
}));

const NOW = new Date('2026-09-30T10:00:00.000Z').getTime();

describe('AttendanceQuickBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockCheckIn.mockClear();
    mockCheckOut.mockClear();
    mockRecord = undefined;
  });
  afterEach(() => jest.useRealTimers());

  it('before check-in shows "Not Checked In" (never "Today") and a Check In action', () => {
    mockRecord = { checkIn: null, checkOut: null };
    render(<AttendanceQuickBar />);
    expect(screen.getByText('Not Checked In')).toBeInTheDocument();
    expect(screen.queryByText(/Not Checked In Today/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check in/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check In' }));
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
  });

  it('while checked in counts from the saved check-in time and keeps ticking', () => {
    mockRecord = { checkIn: new Date(NOW - (4 * 60 + 25) * 60_000).toISOString(), checkOut: null };
    render(<AttendanceQuickBar />);
    expect(screen.getByText('04h 25m 00s')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('04h 25m 01s')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(60_000); });
    expect(screen.getByText('04h 26m 01s')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check out/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check Out' }));
    expect(mockCheckOut).toHaveBeenCalledTimes(1);
  });

  it('after check-out shows the final total and check-out time, frozen, with no action', () => {
    const checkOut = new Date(NOW - 30 * 60_000);
    mockRecord = { checkIn: new Date(checkOut.getTime() - (7 * 60 + 50) * 60_000).toISOString(), checkOut: checkOut.toISOString() };
    render(<AttendanceQuickBar />);
    expect(screen.getByText('07h 50m 00s')).toBeInTheDocument();
    expect(screen.getByText(/Checked out at/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(5 * 60_000); });
    expect(screen.getByText('07h 50m 00s')).toBeInTheDocument();
  });
});
