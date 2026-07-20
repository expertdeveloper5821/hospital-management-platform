import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockLogout = jest.fn().mockResolvedValue({});
let mockIsLoggingOut = false;

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

jest.mock('@/lib/rbac-nav', () => ({
  getNavItems: () => [],
}));

jest.mock('@/store/api/auth.api', () => ({
  useLogoutMutation: () => [mockLogout, { isLoading: mockIsLoggingOut }],
}));

jest.mock('@/store/api/platformSettings.api', () => ({
  useGetPlatformSettingsQuery: () => ({ data: undefined }),
}));

const mockProfile = {
  userId: 'user-001',
  email: 'jane.doe@hospital.com',
  role: 'RECEPTIONIST',
};

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: mockProfile, branding: null } }),
  useAppDispatch: () => jest.fn(),
}));

import { Sidebar } from '@/components/shared/Sidebar';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Sidebar — Sign out loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLoggingOut = false;
  });

  test('calls logout when Sign out is clicked', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(mockLogout).toHaveBeenCalled();
  });

  test('shows a loader and disables the button while logout is in progress', () => {
    mockIsLoggingOut = true;
    render(<Sidebar />);
    const button = screen.getByRole('button', { name: /signing out/i });
    expect(button).toBeDisabled();
  });

  test('does not call logout again when already logging out', () => {
    mockIsLoggingOut = true;
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /signing out/i }));
    expect(mockLogout).not.toHaveBeenCalled();
  });
});
