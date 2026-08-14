import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock('@/store/api/lab.api', () => ({
  useListPathologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useListRadiologyRequestsQuery:  () => ({ data: undefined, isFetching: false, refetch: jest.fn() }),
  useCreatePathologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useCreateRadiologyRequestMutation: () => [jest.fn(), { isLoading: false }],
  useUploadPathologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useUploadRadiologyReportMutation:   () => [jest.fn(), { isLoading: false }],
  useEditPathologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

let mockRole = 'DOCTOR';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole } } }),
  useAppDispatch: () => jest.fn(),
}));

import LabPage from '@/app/(dashboard)/lab/page';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LabPage — New Request role gating', () => {
  test('DOCTOR sees the New Request button', () => {
    mockRole = 'DOCTOR';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN sees the New Request button', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('NURSE sees the New Request button', () => {
    mockRole = 'NURSE';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('ADMIN does not see the New Request button', () => {
    mockRole = 'ADMIN';
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
  });

  test('MANAGER does not see the New Request button', () => {
    mockRole = 'MANAGER';
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
  });

  test('PATHOLOGIST sees the New Request button on the Pathology tab (default)', () => {
    mockRole = 'PATHOLOGIST';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('PATHOLOGIST does not see the New Request button on the Radiology tab', async () => {
    const user = userEvent.setup();
    mockRole = 'PATHOLOGIST';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /radiology/i }));
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
  });

  test('RADIOLOGIST sees the New Request button on the Radiology tab', async () => {
    const user = userEvent.setup();
    mockRole = 'RADIOLOGIST';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /radiology/i }));
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('RADIOLOGIST does not see the New Request button on the Pathology tab (default)', () => {
    mockRole = 'RADIOLOGIST';
    render(<LabPage />);
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument();
  });

  test('RECEPTIONIST sees the New Request button on the Pathology tab (default)', () => {
    mockRole = 'RECEPTIONIST';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('RECEPTIONIST sees the New Request button on the Radiology tab', async () => {
    const user = userEvent.setup();
    mockRole = 'RECEPTIONIST';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /radiology/i }));
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });
});
