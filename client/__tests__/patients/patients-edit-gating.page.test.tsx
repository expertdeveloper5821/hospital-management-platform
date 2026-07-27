import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPatient = {
  patientId:                 'PAT-00000001',
  fullName:                  'Ravi Kumar',
  dateOfBirth:                '1990-05-15',
  gender:                     'MALE',
  mobileNumber:               '9876543210',
  address:                    '12 MG Road, Bengaluru',
  addressLine1:               null,
  addressLine2:               null,
  city:                       null,
  state:                      null,
  country:                    null,
  pincode:                    null,
  aadhaarNumber:               null,
  emergencyContactName:       null,
  emergencyContactMobile:     null,
  bloodGroup:                 null,
  departmentId:               null,
  registrationFee:            null,
  registrationPaymentMethod:  null,
  tenantId:                   't1',
  createdAt:                  '2026-01-01T00:00:00.000Z',
  updatedAt:                  '2026-01-01T00:00:00.000Z',
};

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({
    data: { data: [mockPatient], total: 1, page: 1, limit: 10 },
    isFetching: false,
  }),
  useCreatePatientMutation:       () => [jest.fn(), { isLoading: false }],
  useUpdatePatientMutation:       () => [jest.fn(), { isLoading: false }],
  useDownloadMedicalCardMutation: () => [jest.fn(), { isLoading: false }],
  useDeletePatientMutation:       () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDPatientHistoryQuery: () => ({ data: undefined, isLoading: false }),
}));

jest.mock('@/store/api/ipd.api', () => ({
  useGetIPDPatientHistoryQuery: () => ({ data: undefined, isLoading: false }),
  useListWardsQuery:            () => ({ data: [] }),
}));

let mockRole = 'RECEPTIONIST';

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: mockRole, userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import PatientsPage from '@/app/(dashboard)/patients/page';

function openPatientDetail() {
  fireEvent.click(screen.getByText('Ravi Kumar'));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PatientsPage — Edit action role gating', () => {
  test('NURSE cannot see the Edit action on patient details', () => {
    mockRole = 'NURSE';
    render(<PatientsPage />);
    openPatientDetail();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  test('DOCTOR cannot see the Edit action on patient details', () => {
    mockRole = 'DOCTOR';
    render(<PatientsPage />);
    openPatientDetail();
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  test('RECEPTIONIST still sees the Edit action (unchanged)', () => {
    mockRole = 'RECEPTIONIST';
    render(<PatientsPage />);
    openPatientDetail();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
  });

  test('HOSPITAL_ADMIN still sees the Edit action (unchanged)', () => {
    mockRole = 'HOSPITAL_ADMIN';
    render(<PatientsPage />);
    openPatientDetail();
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
  });
});
