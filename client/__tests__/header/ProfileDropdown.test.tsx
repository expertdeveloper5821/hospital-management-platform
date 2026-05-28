import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPush    = jest.fn();
const mockLogout  = jest.fn().mockResolvedValue({});

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/store/api/auth.api', () => ({
  useLogoutMutation: () => [mockLogout],
}));

// Mock auth store selector
const mockProfile = {
  userId:      'user-001',
  email:       'john.doe@hospital.com',
  role:        'DOCTOR',
  tenantId:    'tenant-001',
  isFirstLogin: false,
};

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: mockProfile, token: 'tok', isAuthenticated: true, branding: null } }),
  useAppDispatch: () => jest.fn(),
}));

import { ProfileDropdown } from '@/components/header/ProfileDropdown';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProfileDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders initials avatar from email', () => {
    render(<ProfileDropdown />);
    // john.doe@hospital.com → JD
    expect(screen.getByRole('button', { name: /profile menu/i })).toHaveTextContent('JD');
  });

  test('dropdown is not visible initially', () => {
    render(<ProfileDropdown />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('opens dropdown when avatar is clicked', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  test('shows email and formatted role in dropdown header', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));

    expect(screen.getByText('john.doe@hospital.com')).toBeInTheDocument();
    expect(screen.getByText('DOCTOR')).toBeInTheDocument();
  });

  test('renders My Profile, Change Password, and Logout items', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));

    expect(screen.getByRole('menuitem', { name: /my profile/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /logout/i })).toBeInTheDocument();
  });

  test('navigates to /profile when My Profile is clicked', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /my profile/i }));

    expect(mockPush).toHaveBeenCalledWith('/profile');
  });

  test('navigates to /profile/change-password when Change Password is clicked', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /change password/i }));

    expect(mockPush).toHaveBeenCalledWith('/profile/change-password');
  });

  test('calls logout when Logout is clicked', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /logout/i }));

    expect(mockLogout).toHaveBeenCalled();
  });

  test('closes dropdown after navigation', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /my profile/i }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  test('closes dropdown on outside click', () => {
    render(<ProfileDropdown />);
    fireEvent.click(screen.getByLabelText('Open profile menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
