export const Gender = {
  MALE:   'MALE',
  FEMALE: 'FEMALE',
  OTHER:  'OTHER',
} as const;

export type Gender = typeof Gender[keyof typeof Gender];

export const BloodGroup = {
  A_POS:  'A+',
  A_NEG:  'A-',
  B_POS:  'B+',
  B_NEG:  'B-',
  AB_POS: 'AB+',
  AB_NEG: 'AB-',
  O_POS:  'O+',
  O_NEG:  'O-',
} as const;

export type BloodGroup = typeof BloodGroup[keyof typeof BloodGroup];

export interface CreatePatientRequest {
  fullName:               string;
  dateOfBirth:            string; // YYYY-MM-DD
  gender:                 Gender;
  mobileNumber:           string;
  address:                string;
  aadhaarNumber?:         string;
  emergencyContactName?:  string;
  emergencyContactMobile?: string;
  bloodGroup?:            BloodGroup;
  departmentId?:             string;
  registrationFee?:          number;
  registrationPaymentMethod?: string;
  forceCreate?:              boolean; // explicit confirmation to bypass duplicate warning
}

export interface UpdatePatientRequest {
  fullName?:               string;
  dateOfBirth?:            string;
  gender?:                 Gender;
  mobileNumber?:           string;
  address?:                string;
  aadhaarNumber?:          string;
  emergencyContactName?:   string;
  emergencyContactMobile?: string;
  bloodGroup?:             BloodGroup;
  departmentId?:           string | null;
}
