import { render, screen, waitFor } from '@testing-library/react';
import { StaffVerificationView } from '@/components/public/StaffVerificationView';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok:     status >= 200 && status < 300,
    status,
    json:   async () => body,
  });
  (globalThis as { fetch: unknown }).fetch = fn;
  return fn;
}

beforeEach(() => {
  window.history.replaceState(null, '', `/verify-staff#${TOKEN}`);
});

describe('StaffVerificationView', () => {
  test('valid card shows the allowed details', async () => {
    mockFetch(200, {
      status: 'success',
      data: {
        valid: true, status: 'ACTIVE', name: 'Asha Verma', employeeId: '••••439011',
        role: 'HOSPITAL_ADMIN', hospitalName: 'City Hospital', issuedAt: '2026-01-01', expiresAt: '2027-01-01',
      },
    });
    render(<StaffVerificationView />);

    expect(await screen.findByText(/Verified — Active staff member/)).toBeInTheDocument();
    expect(screen.getByText('Asha Verma')).toBeInTheDocument();
    expect(screen.getByText('••••439011')).toBeInTheDocument();
    expect(screen.getByText('Hospital Admin')).toBeInTheDocument();
    expect(screen.getByText('City Hospital')).toBeInTheDocument();
    expect(screen.getByText('2027-01-01')).toBeInTheDocument();
  });

  test('invalid card shows only "Not valid"', async () => {
    mockFetch(200, { status: 'success', data: { valid: false, status: 'INACTIVE' } });
    render(<StaffVerificationView />);
    expect(await screen.findByText('Not valid')).toBeInTheDocument();
    expect(screen.queryByText(/Verified/)).not.toBeInTheDocument();
  });

  test('calls the public API with the fragment token, no credentials, no referrer, no cache', async () => {
    const fetchFn = mockFetch(200, { status: 'success', data: { valid: false, status: 'INACTIVE' } });
    render(<StaffVerificationView />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toMatch(new RegExp(`/api/public/staff-verification/${TOKEN}$`));
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(init.headers).toBeUndefined(); // no Authorization header
  });

  test('scrubs the token from the address bar immediately', async () => {
    mockFetch(200, { status: 'success', data: { valid: false, status: 'INACTIVE' } });
    render(<StaffVerificationView />);
    await screen.findByText('Not valid');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
  });

  test('no token → asks to rescan without calling the API', async () => {
    window.history.replaceState(null, '', '/verify-staff');
    const fetchFn = mockFetch(200, {});
    render(<StaffVerificationView />);
    expect(await screen.findByText(/No verification code found/)).toBeInTheDocument();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test('429 shows a rate-limit message', async () => {
    mockFetch(429, { status: 'error' });
    render(<StaffVerificationView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many verification attempts/);
  });

  test('network failure shows a generic error, never staff details', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    render(<StaffVerificationView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach/);
  });
});
