import React from 'react';
import { render, screen } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/link', () => {
  return ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  );
});

jest.mock('@/store/api/packages.api', () => ({
  useListPackagesQuery: () => ({ data: { data: [], totalPages: 1 }, isLoading: false, isError: false }),
}));

let mockRole = 'HOSPITAL_ADMIN';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import PackagesPage from '@/app/(dashboard)/packages/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PackagesPage — New Package role gating', () => {
  test('HOSPITAL_ADMIN sees the New Package button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<PackagesPage />);
    expect(screen.getByRole('link', { name: /new package/i })).toBeInTheDocument();
  });

  test('ADMIN sees the New Package button', () => {
    mockRole = 'ADMIN';
    render(<PackagesPage />);
    expect(screen.getByRole('link', { name: /new package/i })).toBeInTheDocument();
  });

  test('RECEPTIONIST sees the New Package button', () => {
    mockRole = 'RECEPTIONIST';
    render(<PackagesPage />);
    expect(screen.getByRole('link', { name: /new package/i })).toBeInTheDocument();
  });

  test('DOCTOR does not see the New Package button', () => {
    mockRole = 'DOCTOR';
    render(<PackagesPage />);
    expect(screen.queryByRole('link', { name: /new package/i })).not.toBeInTheDocument();
  });

  test('NURSE does not see the New Package button', () => {
    mockRole = 'NURSE';
    render(<PackagesPage />);
    expect(screen.queryByRole('link', { name: /new package/i })).not.toBeInTheDocument();
  });

  test('MANAGER does not see the New Package button', () => {
    mockRole = 'MANAGER';
    render(<PackagesPage />);
    expect(screen.queryByRole('link', { name: /new package/i })).not.toBeInTheDocument();
  });
});
