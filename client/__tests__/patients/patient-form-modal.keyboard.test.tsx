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
      'Age *',
      'Age unit',
      'Date of Birth',
      'Mobile Number *',
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

  it('submits relationship text in the name and preserves an infant age unit', async () => {
    const user = userEvent.setup();
    createPatient.mockReturnValue({ unwrap: async () => ({}) });
    render(<PatientFormModal mode="register" onClose={jest.fn()} />);

    await user.type(screen.getByLabelText('Full Name *'), 'Rahul Mourya S/O Rajesh Mourya');
    await user.type(screen.getByLabelText('Age *'), '2');
    await user.selectOptions(screen.getByLabelText('Age unit'), 'DAYS');
    await user.type(screen.getByLabelText('Mobile Number *'), '9876543210');
    await user.type(screen.getByLabelText('Address Line 1 *'), '12 Main Road');
    await user.selectOptions(screen.getByLabelText('State *'), 'Maharashtra');
    await user.type(screen.getByLabelText('City *'), 'Mumbai');
    await user.click(screen.getByRole('button', { name: 'Register Patient' }));

    await waitFor(() => expect(createPatient).toHaveBeenCalledWith(expect.objectContaining({
      fullName: 'name r/n father name',
      age: 2,
      ageUnit: 'DAYS',
    })));
  });
});
