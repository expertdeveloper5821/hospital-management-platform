import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLogin = jest.fn();
const mockUseLoginMutation = jest.fn(() => [mockLogin, { isLoading: false, error: null }]);

jest.mock('@/store/api/auth.api', () => ({
  useLoginMutation: (...args: unknown[]) => mockUseLoginMutation(...args),
}));

jest.mock('@/store/api/platformSettings.api', () => ({
  useGetPlatformSettingsQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: null } }),
  useAppDispatch: () => jest.fn(),
}));

import LoginPage from '@/app/(auth)/login/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LoginPage — field rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: false, error: null }]);
  });

  test('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  test('does not render a Hospital ID / tenantId field', () => {
    render(<LoginPage />);
    expect(screen.queryByLabelText(/hospital id/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/tenant/i)).not.toBeInTheDocument();
  });

  test('renders platform logo and sign-in heading', () => {
    render(<LoginPage />);
    expect(screen.getByText('MediCore')).toBeInTheDocument();
    expect(screen.getByText(/sign in to your account/i)).toBeInTheDocument();
  });

  test('renders Forgot Password link', () => {
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
  });

  test('Sign In button is present', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('LoginPage — inline validation on blur', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: false, error: null }]);
  });

  test('shows email format error after blur with invalid email', async () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.blur(emailInput);
    await waitFor(() => {
      expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    });
  });

  test('shows password required error after blur on empty field', async () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText(/^password$/i);
    fireEvent.blur(passwordInput);
    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  test('does not show errors before user interacts with fields', () => {
    render(<LoginPage />);
    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/password is required/i)).not.toBeInTheDocument();
  });
});

// ─── Password show/hide toggle ────────────────────────────────────────────────

describe('LoginPage — password show/hide toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: false, error: null }]);
  });

  test('password input starts as type=password', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
  });

  test('clicking Show password toggles input to type=text', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(passwordInput.type).toBe('text');
  });

  test('clicking Hide password toggles input back to type=password', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(passwordInput.type).toBe('password');
  });
});

// ─── Form submission ──────────────────────────────────────────────────────────

describe('LoginPage — form submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: false, error: null }]);
  });

  test('calls login with only email and password (no tenantId)', async () => {
    mockLogin.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'doc@hospital.com' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({ email: 'doc@hospital.com', password: 'secret123' });
      expect(mockLogin).not.toHaveBeenCalledWith(expect.objectContaining({ tenantId: expect.anything() }));
    });
  });

  test('does not call login when email is invalid', async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bad-email' } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => {
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });
});

// ─── Loading state ────────────────────────────────────────────────────────────

describe('LoginPage — loading state', () => {
  test('shows loading spinner and disables button when isLoading=true', () => {
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: true, error: null }]);
    render(<LoginPage />);
    expect(screen.getByText(/signing in/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });
});

// ─── Error banner ─────────────────────────────────────────────────────────────

describe('LoginPage — API error banner', () => {
  beforeEach(() => jest.clearAllMocks());

  test('shows "Invalid email or password." banner for 401 error', () => {
    mockUseLoginMutation.mockReturnValue([
      mockLogin,
      { isLoading: false, error: { status: 401, data: {} } },
    ]);
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  test('shows "Account locked." banner for 403 error', () => {
    mockUseLoginMutation.mockReturnValue([
      mockLogin,
      { isLoading: false, error: { status: 403, data: {} } },
    ]);
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/account locked/i);
  });

  test('shows server message for other API errors', () => {
    mockUseLoginMutation.mockReturnValue([
      mockLogin,
      { isLoading: false, error: { status: 500, data: { message: 'Internal server error.' } } },
    ]);
    render(<LoginPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('Internal server error.');
  });

  test('no error banner when there is no error', () => {
    mockUseLoginMutation.mockReturnValue([mockLogin, { isLoading: false, error: null }]);
    render(<LoginPage />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
