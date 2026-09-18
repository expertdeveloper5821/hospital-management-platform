import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OPDVisitResponse, PatientResponse } from '@/store/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetVisit   = jest.fn();
const mockGetPatient = jest.fn();

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDVisitByIdQuery: (...args: unknown[]) => mockGetVisit(...args),
}));

jest.mock('@/store/api/patient.api', () => ({
  useGetPatientByIdQuery: (...args: unknown[]) => mockGetPatient(...args),
}));

jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: [] }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { branding: { displayName: 'Test Hospital' } } }),
}));

// The page auto-fires window.print() 300ms after data loads — jsdom has no
// real print dialog, so this is stubbed to a no-op purely to keep the effect
// from throwing "Not implemented" during the test.
window.print = jest.fn();

import OPDParchaPrintPage from '@/app/(dashboard)/opd/[visitId]/print/page';

const BASE_PATIENT: PatientResponse = {
  patientId:                 'PAT-TEST0001',
  fullName:                  'Ravi Kumar',
  dateOfBirth:               '1990-05-15',
  gender:                    'MALE',
  mobileNumber:              '9876543210',
  address:                   '12 MG Road',
  addressLine1:              null,
  addressLine2:              null,
  city:                      null,
  state:                     null,
  country:                   null,
  pincode:                   null,
  aadhaarNumber:             null,
  emergencyContactName:      null,
  emergencyContactMobile:    null,
  bloodGroup:                null,
  departmentId:              null,
  registrationFee:           null,
  registrationPaymentMethod: null,
  tenantId:                  't1',
  createdAt:                 '2026-01-01T00:00:00.000Z',
  updatedAt:                 '2026-01-01T00:00:00.000Z',
};

const BASE_VISIT: OPDVisitResponse = {
  visitId:      'OPD-PRINT001',
  tenantId:     't1',
  patientId:    'PAT-TEST0001',
  fullName:     'Ravi Kumar',
  doctorIds:    [],
  nurseIds:     [],
  departmentId: null,
  visitDate:    '2026-05-15T00:00:00.000Z',
  queueNumber:  1,
  status:       'OPEN',
  diagnosis:    null,
  prescription: null,
  notes:        null,
  vitals:       { weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null },
  createdAt:    '2026-05-15T00:00:00.000Z',
  updatedAt:    '2026-05-15T00:00:00.000Z',
};

function setup(visitOverrides: Partial<OPDVisitResponse> = {}) {
  mockGetVisit.mockReturnValue({ data: { ...BASE_VISIT, ...visitOverrides }, isLoading: false, isError: false });
  mockGetPatient.mockReturnValue({ data: BASE_PATIENT, isLoading: false, isError: false });
}

describe('OPD Parcha print page — Vitals section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the Vitals heading and every saved vital with its unit', () => {
    setup({
      vitals: { weight: 68.5, height: 172, bloodPressure: '120/80', sugar: 95, bodyTemperature: 98.6 },
    });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('Vitals')).toBeInTheDocument();
    expect(screen.getByText('Weight (kg)')).toBeInTheDocument();
    expect(screen.getByText('68.5')).toBeInTheDocument();
    expect(screen.getByText('Height (cm)')).toBeInTheDocument();
    expect(screen.getByText('172')).toBeInTheDocument();
    expect(screen.getByText('Blood Pressure (mmHg)')).toBeInTheDocument();
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('Sugar (mg/dL)')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
    expect(screen.getByText('Body Temperature (°F)')).toBeInTheDocument();
    expect(screen.getByText('98.6')).toBeInTheDocument();
  });

  test('a vital that was never recorded renders as a blank line, not a placeholder like "N/A" or "—"', () => {
    setup(); // BASE_VISIT.vitals is all null
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    // The unit labels are always printed (so the sheet stays fillable by
    // hand), but none of the value slots should show a dash/N-A placeholder.
    expect(screen.getByText('Weight (kg)')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  });

  test('a partially-recorded vitals set shows saved fields and leaves the rest blank', () => {
    setup({ vitals: { weight: 70, height: null, bloodPressure: null, sugar: 110, bodyTemperature: null } });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('110')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  test('the old blank writing box is gone — no large empty placeholder area remains', () => {
    setup();
    const { container } = render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    // The previous implementation was a single childless <div> carrying a
    // 150mm minHeight and nothing else. The replacement Vitals/Clinical
    // boxes both carry that same minHeight but always have real content
    // (at minimum the "Vitals"/"Diagnosis" labels), so this asserts no
    // *empty* 150mm box survived, rather than banning the height value.
    const emptyTallBoxes = Array.from(container.querySelectorAll('div')).filter(
      (el) => el.style.minHeight === '150mm' && el.textContent?.trim() === '',
    );
    expect(emptyTallBoxes).toHaveLength(0);
  });
});

describe('OPD Parcha print page — Diagnosis/Prescription/Notes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the latest saved Diagnosis, Prescription and Notes', () => {
    setup({
      diagnosis:    'Viral fever',
      prescription: 'Paracetamol 500mg TDS\nRest for 3 days',
      notes:        '<p>Follow up in a week</p>',
    });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('Diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Viral fever')).toBeInTheDocument();
    expect(screen.getByText('Prescription')).toBeInTheDocument();
    expect(screen.getByText(/Paracetamol 500mg TDS/)).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Follow up in a week')).toBeInTheDocument();
  });

  test('a visit with no diagnosis/prescription/notes yet still renders the labelled, blank sections', () => {
    setup(); // all three null on BASE_VISIT
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('Diagnosis')).toBeInTheDocument();
    expect(screen.getByText('Prescription')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  test('re-rendering with an updated visit (e.g. after a fresh fetch post-edit) reflects the new values', () => {
    setup({ diagnosis: 'Old diagnosis' });
    const { rerender } = render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);
    expect(screen.getByText('Old diagnosis')).toBeInTheDocument();

    mockGetVisit.mockReturnValue({
      data: { ...BASE_VISIT, diagnosis: 'Updated diagnosis after edit' },
      isLoading: false,
      isError: false,
    });
    rerender(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.queryByText('Old diagnosis')).not.toBeInTheDocument();
    expect(screen.getByText('Updated diagnosis after edit')).toBeInTheDocument();
  });
});

describe('OPD Parcha print page — unrelated content unchanged', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('hospital header and patient/visit details still render', () => {
    setup();
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('Test Hospital')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('PAT-TEST0001')).toBeInTheDocument();
    expect(screen.getByText('OPD-PRINT001')).toBeInTheDocument();
    expect(screen.getByText(/Doctor's Signature/)).toBeInTheDocument();
    expect(screen.getByText(/valid for 15 days/)).toBeInTheDocument();
  });
});
