import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Package-wise Ward/Bed allocation in the IPD New Admission modal: an optional
// package locks the ward to the package's ward and offers only that ward's
// available beds; clearing it restores the manual ward/bed flow.

const WARDS = [
  { wardId: 'ward-mat', name: 'Maternity Ward', floor: null, assignedNurseIds: [] },
  { wardId: 'ward-gen', name: 'General Ward',   floor: null, assignedNurseIds: [] },
];
const BEDS: Record<string, unknown[]> = {
  'ward-mat': [
    { bedId: 'bed-m1', wardId: 'ward-mat', bedNumber: 'M-01', isOccupied: false },
    { bedId: 'bed-m2', wardId: 'ward-mat', bedNumber: 'M-02', isOccupied: true },
  ],
  'ward-gen': [
    { bedId: 'bed-g1', wardId: 'ward-gen', bedNumber: 'G-01', isOccupied: false },
    { bedId: 'bed-g2', wardId: 'ward-gen', bedNumber: 'G-02', isOccupied: true },
  ],
};
let mockBeds: Record<string, unknown[]> = BEDS;

const PKG_LINKED   = { packageId: 'PKG-1', name: 'Maternity Pkg', wardId: 'ward-mat', wardName: 'Maternity Ward', status: 'ACTIVE', price: 25000, includedServices: [] };
const PKG_UNLINKED = { packageId: 'PKG-2', name: 'Legacy Pkg',    wardId: null,       wardName: null,             status: 'ACTIVE', price: 1000,  includedServices: [] };

const mockCreateAdmission = jest.fn();
const mockListAdmissions  = jest.fn();
const mockCreatePayment   = jest.fn();
const mockListPackages    = jest.fn();

jest.mock('@/store/api/ipd.api', () => ({
  useListWardsQuery: () => ({ data: WARDS, isLoading: false }),
  useListBedsQuery: (wardId: string, opts?: { skip?: boolean }) =>
    ({ data: opts?.skip || !wardId ? undefined : (mockBeds[wardId] ?? []) }),
  useListAdmissionsQuery: (...args: unknown[]) => mockListAdmissions(...args),
  useCreateAdmissionMutation: () => [mockCreateAdmission, { isLoading: false }],
  useUpdateAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useDeleteAdmissionMutation: () => [jest.fn(), { isLoading: false }],
  useAddProgressNoteMutation: () => [jest.fn(), { isLoading: false }],
  useUpdateAdmissionPrescriptionMutation: () => [jest.fn(), { isLoading: false }],
  useDischargePatientMutation: () => [jest.fn(), { isLoading: false }],
  useDownloadDischargeSummaryMutation: () => [jest.fn(), { isLoading: false }],
  usePrintDischargeSummaryMutation:    () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/packages.api', () => ({
  useListPackagesQuery: (...args: unknown[]) => mockListPackages(...args),
}));

jest.mock('@/store/api/payment.api', () => ({
  useCreateManualPaymentMutation: () => [mockCreatePayment, { isLoading: false }],
  useListPaymentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

jest.mock('@/store/api/patient.api', () => ({
  useSearchPatientsQuery: () => ({ data: { data: [] }, isFetching: false }),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: undefined }),
}));

jest.mock('@/components/patients/patient-form-modal', () => ({
  PatientFormModal: ({ onSuccess }: { onSuccess?: (p: unknown) => void }) => (
    <button onClick={() => onSuccess?.({ patientId: 'PAT-1', fullName: 'Asha', mobileNumber: '9000000001' })}>
      Mock Register Patient
    </button>
  ),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { profile: { role: 'RECEPTIONIST', userId: 'u1' } } }),
  useAppDispatch: () => jest.fn(),
}));

import IPDPage from '@/app/(dashboard)/ipd/page';

const EMPTY_ADMISSIONS = { data: { data: [], total: 0, totalPages: 1 }, isLoading: false, isFetching: false, refetch: jest.fn() };

beforeEach(() => {
  mockListAdmissions.mockReturnValue(EMPTY_ADMISSIONS);
  mockBeds = BEDS;
  mockListPackages.mockReset();
  mockListPackages.mockReturnValue({ data: { data: [PKG_LINKED, PKG_UNLINKED], total: 2, page: 1, limit: 20, totalPages: 1 } });
  mockCreateAdmission.mockReset();
  mockCreateAdmission.mockReturnValue({ unwrap: () => Promise.resolve({ admissionId: 'ADM-1' }) });
  mockCreatePayment.mockReset();
  mockCreatePayment.mockReturnValue({ unwrap: () => Promise.resolve({}) });
});

function openModal() {
  render(<IPDPage />);
  fireEvent.click(screen.getByRole('button', { name: /new admission/i }));
}

const wardSelect    = () => screen.getByLabelText(/^ward$/i) as HTMLSelectElement;
const packageSelect = () => screen.getByLabelText(/package \(optional\)/i) as HTMLSelectElement;
const bedButton     = (n: string) => screen.queryByRole('button', { name: new RegExp(n) });

function fillPatientAndPayment() {
  fireEvent.click(screen.getByRole('button', { name: /add patient/i }));
  fireEvent.click(screen.getByRole('button', { name: /mock register patient/i }));
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '5000' } });
  fireEvent.click(screen.getByRole('button', { name: /^cash$/i }));
}

describe('IPD New Admission — optional package', () => {
  test('only ACTIVE packages are requested, and the package defaults to none', () => {
    openModal();
    expect(mockListPackages).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
    expect(packageSelect().value).toBe('');
    expect(wardSelect()).not.toBeDisabled();
  });

  test("selecting a package auto-selects and locks its ward, showing only that ward's available beds", () => {
    openModal();
    fireEvent.change(packageSelect(), { target: { value: 'PKG-1' } });

    expect(wardSelect().value).toBe('ward-mat');
    expect(wardSelect()).toBeDisabled();
    expect(bedButton('M-01')).toBeInTheDocument();
    expect(bedButton('M-02')).not.toBeInTheDocument(); // occupied → hidden
    expect(bedButton('G-01')).not.toBeInTheDocument(); // other ward
  });

  test('submitting with a package sends packageId, the package ward and the chosen bed; payment flow unchanged', async () => {
    openModal();
    fillPatientAndPayment();
    fireEvent.change(packageSelect(), { target: { value: 'PKG-1' } });
    fireEvent.click(bedButton('M-01')!);
    fireEvent.click(screen.getByRole('button', { name: /admit patient/i }));

    await waitFor(() => expect(mockCreateAdmission).toHaveBeenCalledWith({
      patientId: 'PAT-1', wardId: 'ward-mat', bedId: 'bed-m1', packageId: 'PKG-1',
    }));
    await waitFor(() => expect(mockCreatePayment).toHaveBeenCalledWith(expect.objectContaining({
      amount: 5000, paymentMethod: 'CASH', description: 'IPD Admission', referenceType: 'IPD_ADMISSION', referenceId: 'ADM-1',
    })));
  });

  test('a package with no linked ward shows a message and blocks admission', () => {
    openModal();
    fillPatientAndPayment();
    fireEvent.change(packageSelect(), { target: { value: 'PKG-2' } });

    expect(screen.getAllByText(/this package has no linked ward/i).length).toBeGreaterThan(0);
    expect(wardSelect()).toBeDisabled();
    expect(screen.getByRole('button', { name: /admit patient/i })).toBeDisabled();
    expect(mockCreateAdmission).not.toHaveBeenCalled();
  });

  test("a package whose ward has no available beds shows a message and blocks admission", () => {
    mockBeds = { ...BEDS, 'ward-mat': [{ bedId: 'bed-m2', wardId: 'ward-mat', bedNumber: 'M-02', isOccupied: true }] };
    openModal();
    fillPatientAndPayment();
    fireEvent.change(packageSelect(), { target: { value: 'PKG-1' } });

    expect(screen.getByText(/no available beds in this package/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /admit patient/i })).toBeDisabled();
  });

  test('clearing the package restores manual ward selection and resets ward + bed', () => {
    openModal();
    fireEvent.change(packageSelect(), { target: { value: 'PKG-1' } });
    fireEvent.click(bedButton('M-01')!);
    fireEvent.change(packageSelect(), { target: { value: '' } });

    expect(wardSelect()).not.toBeDisabled();
    expect(wardSelect().value).toBe('');
    expect(bedButton('M-01')).not.toBeInTheDocument();
  });

  test('without a package the existing flow is unchanged: any ward, occupied beds shown disabled, no packageId sent', async () => {
    openModal();
    fillPatientAndPayment();
    fireEvent.change(wardSelect(), { target: { value: 'ward-gen' } });

    expect(bedButton('G-02')).toBeDisabled(); // occupied still listed, disabled
    fireEvent.click(bedButton('G-01')!);
    fireEvent.click(screen.getByRole('button', { name: /admit patient/i }));

    await waitFor(() => expect(mockCreateAdmission).toHaveBeenCalledWith({
      patientId: 'PAT-1', wardId: 'ward-gen', bedId: 'bed-g1',
    }));
  });
});

describe('IPD AdmissionPanel — package-linked ward lock', () => {
  const admitted = {
    admissionId: 'adm-pkg-1', patientId: 'PAT-1', fullName: 'Asha',
    wardId: 'ward-mat', wardName: 'Maternity Ward', bedId: 'bed-m1', bedNumber: 'M-01',
    assignedDoctorIds: [], departmentId: null, status: 'ADMITTED',
    admissionDate: '2026-01-01T00:00:00.000Z', dischargeDate: null, progressNotes: [],
    vitals: { weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: null },
    prescription: null, dischargeSummaryNotes: null,
  };

  function openEdit(row: Record<string, unknown>) {
    mockListAdmissions.mockReturnValue({ ...EMPTY_ADMISSIONS, data: { data: [row], total: 1, totalPages: 1 } });
    render(<IPDPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /^view$/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
  }

  test('Ward is disabled for an admission linked to a package (bed stays selectable)', () => {
    openEdit({ ...admitted, packageId: 'PKG-1' });
    expect(screen.getByLabelText('Ward')).toBeDisabled();
    expect(screen.getByText(/ward is fixed by the admission/i)).toBeInTheDocument();
    expect(screen.getByText('Bed')).toBeInTheDocument();
  });

  test('Ward stays editable for an admission without a package (unchanged)', () => {
    openEdit({ ...admitted, packageId: null });
    expect(screen.getByLabelText('Ward')).not.toBeDisabled();
  });
});
