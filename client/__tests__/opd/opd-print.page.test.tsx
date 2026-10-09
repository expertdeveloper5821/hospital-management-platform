import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OPDVisitResponse, PatientResponse } from '@/store/types';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetVisit   = jest.fn();
const mockGetPatient = jest.fn();
const mockGetOpdSettings = jest.fn();

jest.mock('@/store/api/opd.api', () => ({
  useGetOPDVisitByIdQuery: (...args: unknown[]) => mockGetVisit(...args),
  // Only exercised when branding.parchaTemplateUrl is a PDF — not the case
  // in this suite (branding has no parchaTemplateUrl at all), but the hook
  // is still called unconditionally on every render.
  useGetOPDParchaPdfMutation: () => [jest.fn(), { isLoading: false }],
}));

jest.mock('@/store/api/patient.api', () => ({
  useGetPatientByIdQuery: (...args: unknown[]) => mockGetPatient(...args),
}));

const mockDepartments = [
  { departmentId: 'DEPT-PED', name: 'Pediatric', vitalsProfile: 'PEDIATRIC' },
  { departmentId: 'DEPT-NON', name: 'Non-Pediatric', vitalsProfile: 'NON_PEDIATRIC' },
  { departmentId: 'DEPT-DEN', name: 'Dental', vitalsProfile: null },
];
jest.mock('@/store/api/department.api', () => ({
  useListDepartmentsQuery: () => ({ data: mockDepartments }),
}));

jest.mock('@/store/api/user.api', () => ({
  useListUsersQuery: () => ({ data: { data: [] } }),
}));

jest.mock('@/store/api/tenant.api', () => ({
  useGetOpdSettingsQuery: (...args: unknown[]) => mockGetOpdSettings(...args),
}));

jest.mock('@/store/hooks', () => ({
  useAppSelector: (selector: (s: unknown) => unknown) =>
    selector({ auth: { branding: { displayName: 'Test Hospital' }, profile: { tenantId: 't1' } } }),
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
  age:                       null,
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
  vitals:       {
    weight: null, height: null, bloodPressure: null, sugar: null, bodyTemperature: null,
    spo2: null, pulse: null, respiratoryRate: null, headCircumference: null,
  },
  createdAt:    '2026-05-15T00:00:00.000Z',
  updatedAt:    '2026-05-15T00:00:00.000Z',
};

function setup(visitOverrides: Partial<OPDVisitResponse> = {}) {
  mockGetVisit.mockReturnValue({ data: { ...BASE_VISIT, ...visitOverrides }, isLoading: false, isError: false });
  mockGetPatient.mockReturnValue({ data: BASE_PATIENT, isLoading: false, isError: false });
  mockGetOpdSettings.mockReturnValue({ data: { validityDays: 5 }, isLoading: false, isError: false });
}

describe('OPD Parcha print page — Vitals section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const order = (container: HTMLElement, labels: string[]) => {
    const text = container.textContent ?? '';
    return labels.map((label) => text.indexOf(label));
  };
  const FULL_VITALS = {
    weight: 6.5, height: 65, bloodPressure: '90/60', sugar: 95,
    bodyTemperature: 98.6, spo2: 98, pulse: 120, respiratoryRate: 30, headCircumference: 40,
  };

  test('Pediatric department prints PR → RR → SpO₂ → BP → Height → Weight → Head Circ. for an adult', () => {
    setup({ departmentId: 'DEPT-PED', vitals: FULL_VITALS }); // BASE_PATIENT is an adult
    const { container } = render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    const positions = order(container, ['PR', 'RR', 'SpO₂', 'BP', 'Height', 'Weight', 'Head Circ.']);
    positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    expect(screen.queryByText('RBS')).not.toBeInTheDocument();
    expect(screen.queryByText('Temp')).not.toBeInTheDocument();
  });

  test('Non-Pediatric department prints BP → PR → SpO₂ → RBS → Temp → Weight for an infant', () => {
    setup({ departmentId: 'DEPT-NON', vitals: FULL_VITALS });
    mockGetPatient.mockReturnValue({
      data: { ...BASE_PATIENT, dateOfBirth: null, age: 5, ageUnit: 'MONTHS' }, isLoading: false, isError: false,
    });
    const { container } = render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    const positions = order(container, ['BP', 'PR', 'SpO₂', 'RBS', 'Temp', 'Weight']);
    positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    expect(screen.queryByText('RR')).not.toBeInTheDocument();
    expect(screen.queryByText('Head Circ.')).not.toBeInTheDocument();
  });

  test.each([['DEPT-DEN'], [null]] as const)(
    'department %s prints SpO₂ → Temp → BP → Pulse → Height → Weight, even for an infant',
    (departmentId) => {
      setup({ departmentId, vitals: FULL_VITALS });
      mockGetPatient.mockReturnValue({
        data: { ...BASE_PATIENT, dateOfBirth: null, age: 5, ageUnit: 'MONTHS' }, isLoading: false, isError: false,
      });
      const { container } = render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

      expect(screen.getByText('Vitals')).toBeInTheDocument();
      const positions = order(container, ['SpO₂', 'Temp', 'BP', 'Pulse', 'Height', 'Weight']);
      positions.forEach((pos) => expect(pos).toBeGreaterThan(-1));
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
      for (const label of ['PR', 'RR', 'RBS', 'Head Circ.']) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    },
  );

  test('a vital that was never recorded renders as a blank line, not a placeholder like "N/A" or "—"', () => {
    setup(); // BASE_VISIT.vitals is all null
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    // The short labels are always printed (so the sheet stays fillable by
    // hand), but none of the value slots should show a dash/N-A placeholder.
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByText('N/A')).not.toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  });

  test('a partially-recorded vitals set shows saved fields and leaves the rest blank', () => {
    setup({ vitals: { weight: 70, height: null, bloodPressure: null, sugar: null, bodyTemperature: null, spo2: null, pulse: 110 } });
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

  test('a visit with no diagnosis/prescription/notes yet hides all three sections', () => {
    setup(); // all three null on BASE_VISIT
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
    expect(screen.queryByText('Prescription')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  test('only the sections with data render — an empty Diagnosis is skipped and Prescription moves up', () => {
    setup({ prescription: 'Paracetamol 500mg' });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
    expect(screen.getByText('Prescription')).toBeInTheDocument();
    expect(screen.getByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
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
    // Visit ID is no longer printed; "Valid Till" uses the OPD date and
    // counts it as the first day of the configured validity period.
    // replaces "Registered On".
    expect(screen.queryByText('OPD-PRINT001')).not.toBeInTheDocument();
    expect(screen.queryByText(/Registered On/)).not.toBeInTheDocument();
    expect(screen.getByText('19 May 2026')).toBeInTheDocument();
    expect(screen.getByText(/Doctor's Signature/)).toBeInTheDocument();
    expect(screen.getByText(/valid for 5 days/)).toBeInTheDocument();
  });

  test('Valid Till follows the validity period configured in Branding settings', () => {
    setup();
    mockGetOpdSettings.mockReturnValue({ data: { validityDays: 3 }, isLoading: false, isError: false });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('17 May 2026')).toBeInTheDocument();
    expect(screen.getByText(/valid for 3 days/)).toBeInTheDocument();
  });

  test('prints the server-resolved Valid Till (e.g. a completed visit\'s saved date) in IST, ignoring the current setting', () => {
    // 2026-05-18T18:30Z is 19 May 00:00 IST — a UTC rendering would say 18 May.
    setup({ status: 'COMPLETED', validTill: '2026-05-18T18:30:00.000Z' });
    mockGetOpdSettings.mockReturnValue({ data: { validityDays: 30 }, isLoading: false, isError: false });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('19 May 2026')).toBeInTheDocument();
    expect(screen.queryByText('18 May 2026')).not.toBeInTheDocument();
  });

  test('fallback without a server Valid Till counts the IST creation day as day one at the IST midnight boundary', () => {
    // 2026-05-14T18:30Z is 15 May 00:00 IST (still 14 May in UTC).
    setup({ createdAt: '2026-05-14T18:30:00.000Z', validTill: undefined });
    render(<OPDParchaPrintPage params={{ visitId: 'OPD-PRINT001' }} />);

    expect(screen.getByText('19 May 2026')).toBeInTheDocument();
  });
});
