// Static reference data for address dropdowns. No API/DB — this list is fixed.

// 28 states + 8 union territories.
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union territories
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

// India first (the default), then common countries alphabetically. Static — extend as needed.
export const COUNTRIES = [
  'India',
  'Australia', 'Bangladesh', 'Bhutan', 'Canada', 'China', 'France', 'Germany',
  'Indonesia', 'Ireland', 'Italy', 'Japan', 'Malaysia', 'Maldives', 'Myanmar',
  'Nepal', 'New Zealand', 'Pakistan', 'Philippines', 'Qatar', 'Russia',
  'Saudi Arabia', 'Singapore', 'South Africa', 'South Korea', 'Sri Lanka',
  'Thailand', 'United Arab Emirates', 'United Kingdom', 'United States', 'Other',
] as const;
