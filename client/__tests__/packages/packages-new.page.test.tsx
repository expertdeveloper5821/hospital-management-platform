import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockReplace = jest.fn();
const mockPush     = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

const mockCreate = jest.fn().mockReturnValue({ unwrap: () => Promise.resolve({ packageId: 'PKG-1' }) });

jest.mock('@/store/api/packages.api', () => ({
  useCreatePackageMutation: () => [mockCreate, { isLoading: false, error: undefined }],
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import NewPackagePage from '@/app/(dashboard)/packages/new/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NewPackagePage — role gating', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    mockCreate.mockClear();
  });

  test('RECEPTIONIST can access the New Package form (not redirected)', () => {
    mockRole = 'RECEPTIONIST';
    render(<NewPackagePage />);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /new package/i })).toBeInTheDocument();
    expect(screen.getByText(/included services/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Service 1')).toBeInTheDocument();
  });

  test('RECEPTIONIST can fill the form, select included services, and submit', async () => {
    mockRole = 'RECEPTIONIST';
    const user = userEvent.setup();
    render(<NewPackagePage />);

    await user.type(screen.getByLabelText(/^name/i), 'Basic Health Checkup');
    await user.type(screen.getByLabelText(/^price/i), '999');
    await user.type(screen.getByPlaceholderText('Service 1'), 'CBC');

    await user.click(screen.getByRole('button', { name: /add service/i }));
    await user.type(screen.getByPlaceholderText('Service 2'), 'Lipid Profile');

    await user.click(screen.getByRole('button', { name: /^create package$/i }));

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name:             'Basic Health Checkup',
        price:            999,
        includedServices: ['CBC', 'Lipid Profile'],
      }),
    );
  });

  test('HOSPITAL_ADMIN can still access the New Package form (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<NewPackagePage />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('ADMIN can still access the New Package form (unchanged)', () => {
    mockRole = 'ADMIN';
    render(<NewPackagePage />);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('NURSE is redirected away from the New Package form (unchanged)', () => {
    mockRole = 'NURSE';
    render(<NewPackagePage />);
    expect(mockReplace).toHaveBeenCalledWith('/packages');
  });

  test('DOCTOR is redirected away from the New Package form (unchanged)', () => {
    mockRole = 'DOCTOR';
    render(<NewPackagePage />);
    expect(mockReplace).toHaveBeenCalledWith('/packages');
  });
});
