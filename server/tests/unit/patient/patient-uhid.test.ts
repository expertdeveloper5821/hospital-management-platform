import { formatUhid, hospitalInitials } from '../../../src/modules/patient/patient-uhid';
import { patientIdSchema } from '../../../src/shared/utils/validation';

describe('hospitalInitials', () => {
  test.each([
    ['Narayan Hospital',             'NH'],
    ['narayan   hospital',           'NH'],
    ["St. Mary's Hospital",          'SMH'],
    ['Apollo 24x7 Hospital',         'AXH'],
    ['Saint-Jérôme Clinic',          'SJC'],
    ['City-Care Multi Speciality',   'CCMS'],
  ])('%s → %s', (name, expected) => {
    expect(hospitalInitials(name)).toBe(expected);
  });

  test('caps initials at 10 letters', () => {
    expect(hospitalInitials('A B C D E F G H I J K L')).toBe('ABCDEFGHIJ');
  });

  test('falls back to H when the name has no Latin letters', () => {
    expect(hospitalInitials('')).toBe('H');
    expect(hospitalInitials(null)).toBe('H');
    expect(hospitalInitials('नारायण अस्पताल')).toBe('H');
  });
});

describe('formatUhid', () => {
  test('pads the sequence to at least two digits', () => {
    expect(formatUhid('NH', 1)).toBe('PAT-NH01');
    expect(formatUhid('NH', 9)).toBe('PAT-NH09');
    expect(formatUhid('NH', 10)).toBe('PAT-NH10');
    expect(formatUhid('NH', 100)).toBe('PAT-NH100');
  });
});

describe('patientIdSchema', () => {
  test.each(['PAT-NH01', 'PAT-NH100', 'PAT-H01', 'PAT-ABCDEFGHIJ01', 'PAT-ABCD1234', 'PAT-0A1B2C3D'])(
    'accepts %s', (id) => expect(patientIdSchema.safeParse(id).success).toBe(true),
  );

  test.each(['PAT-NH1', 'PAT-nh01', 'NH01', 'PAT-', 'PAT-NH01X', 'PAT-ABCDEFGHIJK01'])(
    'rejects %s', (id) => expect(patientIdSchema.safeParse(id).success).toBe(false),
  );
});
