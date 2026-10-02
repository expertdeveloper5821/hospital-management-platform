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

const mockToastError = jest.fn();
jest.mock('@/lib/toast', () => ({
  toastError: (...args: unknown[]) => mockToastError(...args),
}));

const NOW = new Date('2026-09-30T10:00:00.000Z').getTime();
const COORDS = { latitude: 19.076, longitude: 72.8777 };

const mockGetCurrentPosition = jest.fn();
Object.defineProperty(global.navigator, 'geolocation', {
  configurable: true,
  value: { getCurrentPosition: mockGetCurrentPosition },
});

function grantLocation() {
  mockGetCurrentPosition.mockImplementation((success: PositionCallback) =>
    success({ coords: COORDS } as GeolocationPosition));
}

function failLocation(code: number) {
  mockGetCurrentPosition.mockImplementation((_s: PositionCallback, error: PositionErrorCallback) =>
    error({ code } as GeolocationPositionError));
}

// Location capture resolves asynchronously after the confirm click.
async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe('AttendanceQuickBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockCheckIn.mockClear();
    mockCheckOut.mockClear();
    mockToastError.mockClear();
    mockGetCurrentPosition.mockReset();
    grantLocation();
    mockRecord = undefined;
  });
  afterEach(() => jest.useRealTimers());

  it('before check-in shows "Not Checked In" (never "Today") and a Check In action', async () => {
    mockRecord = { checkIn: null, checkOut: null };
    render(<AttendanceQuickBar />);
    expect(screen.getByText('Not Checked In')).toBeInTheDocument();
    expect(screen.queryByText(/Not Checked In Today/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check in/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check In' }));
    await flush();
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
    expect(mockCheckIn).toHaveBeenCalledWith(COORDS);
  });

  it('while checked in counts from the saved check-in time and keeps ticking', async () => {
    mockRecord = { checkIn: new Date(NOW - (4 * 60 + 25) * 60_000).toISOString(), checkOut: null };
    render(<AttendanceQuickBar />);
    expect(screen.getByText('04h 25m 00s')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(1000); });
    expect(screen.getByText('04h 25m 01s')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(60_000); });
    expect(screen.getByText('04h 26m 01s')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /check out/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check Out' }));
    await flush();
    expect(mockCheckOut).toHaveBeenCalledTimes(1);
    expect(mockCheckOut).toHaveBeenCalledWith(COORDS);
  });

  it.each([
    [1, /Location access is blocked/],
    [2, /could not be determined/],
    [3, /took too long/],
  ])('does not check in when location capture fails (error code %i) and explains why', async (code, message) => {
    failLocation(code);
    mockRecord = { checkIn: null, checkOut: null };
    render(<AttendanceQuickBar />);

    fireEvent.click(screen.getByRole('button', { name: /check in/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check In' }));
    await flush();

    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Could not check in', expect.stringMatching(message));
    expect(screen.getByRole('button', { name: /check in/i })).toBeEnabled();
  });

  it('does not check out when location permission is denied', async () => {
    failLocation(1);
    mockRecord = { checkIn: new Date(NOW - 60 * 60_000).toISOString(), checkOut: null };
    render(<AttendanceQuickBar />);

    fireEvent.click(screen.getByRole('button', { name: /check out/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check Out' }));
    await flush();

    expect(mockCheckOut).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith('Could not check out', expect.stringMatching(/Location access is blocked/));
  });

  it('shows a "Getting location…" busy state while waiting for a GPS fix', async () => {
    mockGetCurrentPosition.mockImplementation(() => { /* never resolves */ });
    mockRecord = { checkIn: null, checkOut: null };
    render(<AttendanceQuickBar />);

    fireEvent.click(screen.getByRole('button', { name: /check in/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Check In' }));
    await flush();

    expect(screen.getByRole('button', { name: /Getting location/ })).toBeDisabled();
    expect(mockCheckIn).not.toHaveBeenCalled();
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
