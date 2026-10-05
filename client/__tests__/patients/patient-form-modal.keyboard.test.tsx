import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PatientFormModal } from '@/components/patients/patient-form-modal';

const createPatient = jest.fn();

jest.mock('@/store/api/patient.api', () => ({
  useCreatePatientMutation: () => [createPatient, { isLoading: false }],
  useUpdatePatientMutation: () => [jest.fn(), { isLoading: false }],
}));

describe('PatientFormModal — keyboard navigation', () => {
  beforeEach(() => createPatient.mockReset());

  it('focuses Full Name on open and walks the fields in layout order on Enter without submitting', async () => {
    const user = userEvent.setup();
    render(<PatientFormModal mode="register" onClose={jest.fn()} />);

    await waitFor(() => expect(screen.getByLabelText('Full Name *')).toHaveFocus());

    const order = [
      'Date of Birth',
      'Mobile Number *',
      'Age *',
      'Gender *',
      'Blood Group',
      'Address Line 1 *',
      'Address Line 2',
      'State *',
      'City *',
      'Pincode',
    ];
    for (const label of order) {
      await user.keyboard('{Enter}');
      await waitFor(() => expect(screen.getByLabelText(label)).toHaveFocus());
    }
    expect(createPatient).not.toHaveBeenCalled();
  });
});
