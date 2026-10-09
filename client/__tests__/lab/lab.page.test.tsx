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
  useListDisabledPathologyTestsQuery: () => ({ data: [] }),
  useDeletePathologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useEditRadiologyRequestMutation:    () => [jest.fn(), { isLoading: false }],
  useDeleteRadiologyRequestMutation:  () => [jest.fn(), { isLoading: false }],
  useCollectPathologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useCollectRadiologyPaymentMutation: () => [jest.fn(), { isLoading: false }],
  useGetPathologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
  useGetRadiologyRequestQuery:        () => ({ data: undefined, isLoading: false }),
}));

jest.mock('@/store/api/payment.api', () => ({
  useLazyGetReceiptUrlQuery: () => [jest.fn(), { isFetching: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

const DOCTORS = [
  { userId: 'doc-self',  name: 'Dr. Self Referrer' },
  { userId: 'doc-other', name: 'Dr. Other Physician' },
];

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: DOCTORS }, isFetching: false }),
}));

let mockRole   = 'DOCTOR';
let mockUserId = 'doc-self';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: mockUserId } } }),
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

  test('PATHOLOGIST sees only the Pathology tab (Radiology hidden)', () => {
    mockRole = 'PATHOLOGIST';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /pathology/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /radiology/i })).not.toBeInTheDocument();
  });

  test('RADIOLOGIST lands on the Radiology tab and sees the New Request button', () => {
    mockRole = 'RADIOLOGIST';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /new request/i })).toBeInTheDocument();
  });

  test('RADIOLOGIST sees only the Radiology tab (Pathology hidden)', () => {
    mockRole = 'RADIOLOGIST';
    render(<LabPage />);
    expect(screen.getByRole('button', { name: /radiology/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pathology/i })).not.toBeInTheDocument();
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

describe('LabPage — New Request "Referred By" dropdown', () => {
  test('DOCTOR: no Self option, own name pinned to top and pre-selected', async () => {
    const user = userEvent.setup();
    mockRole   = 'DOCTOR';
    mockUserId = 'doc-self';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /new request/i }));

    const select = screen.getByLabelText('Referred By') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).not.toContain('SELF');
    expect(options[0]).toBe('doc-self');
    expect(select.value).toBe('doc-self');
  });

  test('DOCTOR: no Other option and no referrer-name field (unchanged)', async () => {
    const user = userEvent.setup();
    mockRole   = 'DOCTOR';
    mockUserId = 'doc-self';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /new request/i }));

    const select = screen.getByLabelText('Referred By') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.text)).not.toContain('Other');
    expect(screen.queryByLabelText(/referrer name/i)).not.toBeInTheDocument();
  });

  test.each([
    ['PATHOLOGIST',    'path-001',  false],
    ['RECEPTIONIST',   'recep-001', false],
    ['HOSPITAL_ADMIN', 'admin-001', false],
    ['NURSE',          'nurse-001', false],
    ['RADIOLOGIST',    'radio-001', true],
  ])('%s: Self replaced by Other, nothing preselected', async (role, userId, radiologyTab) => {
    const user = userEvent.setup();
    mockRole   = role;
    mockUserId = userId;
    render(<LabPage />);
    if (radiologyTab) await user.click(screen.getByRole('button', { name: /radiology/i }));
    await user.click(screen.getByRole('button', { name: /new request/i }));

    const select = screen.getByLabelText('Referred By *') as HTMLSelectElement;
    const texts = Array.from(select.options).map((o) => o.text);
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('SELF');
    expect(texts).not.toContain('Self');
    expect(texts).toEqual(['Select referrer…', 'Dr. Self Referrer', 'Dr. Other Physician', 'Other']);
    expect(select.value).toBe('');
    expect(screen.queryByLabelText(/referrer name/i)).not.toBeInTheDocument();
  });

  test('Other shows a required referrer-name field; picking a doctor hides it again', async () => {
    const user = userEvent.setup();
    mockRole   = 'RECEPTIONIST';
    mockUserId = 'recep-001';
    render(<LabPage />);
    await user.click(screen.getByRole('button', { name: /new request/i }));

    const select = screen.getByLabelText('Referred By *') as HTMLSelectElement;
    await user.selectOptions(select, 'Other');
    expect(screen.getByLabelText('Referrer Name *')).toBeRequired();

    await user.selectOptions(select, 'doc-other');
    expect(select.value).toBe('doc-other');
    expect(screen.queryByLabelText(/referrer name/i)).not.toBeInTheDocument();
  });
});
