// ─── Structured Pathology report templates ───────────────────────────────────
// One template per test in the New Pathology Request catalog
// (client/app/(dashboard)/lab/page.tsx PATHOLOGY_TEST_TYPES). The template is
// looked up by the exact test name stored in `testType`, so the catalog names
// are never changed or renamed here. Any other test name (legacy free text,
// Billing-created requests) falls back to GENERIC_TEMPLATE.
//
// Reference ranges are common adult reference intervals. They are snapshotted
// onto each submitted result (with the unit), so a later change here never
// alters an already-submitted report. Gender-specific ranges resolve against
// the patient's gender; OTHER/unknown uses the combined range text.
//
// Every string here is printed in the PDF with the standard Helvetica font
// (WinAnsiEncoding) — keep to Latin-1 glyphs (µ, ³, ×, ° are fine; ≤/≥ are not).
// The one exception is the catalog test name "Pregnancy Test (Urine β-hCG)",
// kept exactly as named — pathology-report.pdf.ts draws β from the Symbol font.

export type PathologyParameterInputType = 'number' | 'text' | 'select';

export interface PathologyReferenceRange {
  low?:  number;
  high?: number;
  // True for a "< X" / "> X" bound, where X itself is already out of range.
  exclusive?: boolean;
  text:  string;
}

export interface PathologyParameterTemplate {
  key:        string;
  name:       string;
  unit:       string | null;
  inputType:  PathologyParameterInputType;
  // Sub-heading the parameter is grouped under (e.g. "Differential Count").
  section?:   string;
  // 'select' only: allowed values, and the subset that is normal — any other
  // option is flagged ABNORMAL.
  options?:      string[];
  normalValues?: string[];
  // 'number' only: numeric bounds drive the HIGH/LOW flag.
  range?:       PathologyReferenceRange;
  rangeMale?:   PathologyReferenceRange;
  rangeFemale?: PathologyReferenceRange;
  // Reference text for 'text'/'select' parameters.
  referenceText?: string;
  readOnly?: boolean;
  calculationType?: 'calculated' | 'estimated' | 'conversion';
}

export interface PathologyReportTemplate {
  key:        string;
  testName:   string;
  parameters: PathologyParameterTemplate[];
}

const NEG_POS = ['Negative', 'Positive'];

function num(
  key: string, name: string, unit: string | null, range: PathologyReferenceRange,
  extra: Partial<PathologyParameterTemplate> = {},
): PathologyParameterTemplate {
  return { key, name, unit, inputType: 'number', range, ...extra };
}

function sexed(
  key: string, name: string, unit: string | null,
  male: PathologyReferenceRange, female: PathologyReferenceRange,
  extra: Partial<PathologyParameterTemplate> = {},
): PathologyParameterTemplate {
  return {
    key, name, unit, inputType: 'number',
    rangeMale: male, rangeFemale: female,
    range: { text: `M: ${male.text}; F: ${female.text}` },
    ...extra,
  };
}

function select(
  key: string, name: string, options: string[], normalValues: string[] | undefined,
  extra: Partial<PathologyParameterTemplate> = {},
): PathologyParameterTemplate {
  return {
    key, name, unit: null, inputType: 'select', options, normalValues,
    referenceText: normalValues?.join(' / '), ...extra,
  };
}

function text(
  key: string, name: string, unit: string | null, referenceText?: string,
  extra: Partial<PathologyParameterTemplate> = {},
): PathologyParameterTemplate {
  return { key, name, unit, inputType: 'text', referenceText, ...extra };
}

const r = (low: number | undefined, high: number | undefined, label: string): PathologyReferenceRange =>
  ({ low, high, text: label });
// "< high" / "> low" — the bound itself is out of range.
const below = (high: number, label: string): PathologyReferenceRange => ({ high, exclusive: true, text: label });
const above = (low: number, label: string): PathologyReferenceRange => ({ low, exclusive: true, text: label });

// Shared by KFT/RFT and Serum Electrolytes.
const SODIUM    = num('sodium',    'Sodium (Na+)',    'mmol/L', r(136, 145, '136 - 145'));
const POTASSIUM = num('potassium', 'Potassium (K+)',  'mmol/L', r(3.5, 5.1, '3.5 - 5.1'));
const CHLORIDE  = num('chloride',  'Chloride (Cl-)',  'mmol/L', r(98, 107, '98 - 107'));
const URIC_ACID = sexed('uricAcid', 'Uric Acid', 'mg/dL', r(3.5, 7.2, '3.5 - 7.2'), r(2.6, 6.0, '2.6 - 6.0'));

// Shared by LFT / KFT and the standalone Bilirubin, ALP and Calcium tests.
const BILIRUBIN_TOTAL    = num('totalBilirubin',    'Bilirubin - Total',    'mg/dL', r(0.3, 1.2, '0.3 - 1.2'));
const BILIRUBIN_DIRECT   = num('directBilirubin',   'Bilirubin - Direct',   'mg/dL', r(0, 0.3, '0.0 - 0.3'));
const BILIRUBIN_INDIRECT = num('indirectBilirubin', 'Bilirubin - Indirect', 'mg/dL', r(0.2, 0.9, '0.2 - 0.9'));
const ALP                = num('alp', 'Alkaline Phosphatase (ALP)', 'U/L', r(44, 147, '44 - 147'));
const CALCIUM            = num('calcium', 'Calcium', 'mg/dL', r(8.6, 10.2, '8.6 - 10.2'));

const URINE_DIPSTICK = ['Nil', 'Trace', '1+', '2+', '3+', '4+'];
const REACTIVITY     = ['Non-Reactive', 'Reactive'];
const ABSENT_PRESENT = ['Absent', 'Present'];
// Widal agglutination titres, lowest first.
const WIDAL_TITRES   = ['< 1:20', '1:20', '1:40', '1:80', '1:160', '1:320', '1:640'];
// Qualitative ELISA interpretation.
const ELISA_RESULT   = ['Negative', 'Equivocal', 'Positive'];

const DIFFERENTIAL = 'Differential Leucocyte Count';
const RBC_INDICES  = 'Red Cell Indices';

export const PATHOLOGY_REPORT_TEMPLATES: PathologyReportTemplate[] = [
  {
    key: 'CBC', testName: 'CBC (Complete Blood Count)',
    parameters: [
      sexed('hemoglobin', 'Haemoglobin (Hb)', 'g/dL', r(13.0, 17.0, '13.0 - 17.0'), r(12.0, 15.0, '12.0 - 15.0')),
      sexed('rbc', 'Total RBC Count', 'million/µL', r(4.5, 5.5, '4.5 - 5.5'), r(3.8, 4.8, '3.8 - 4.8')),
      num('wbc', 'Total Leucocyte Count (TLC / WBC)', 'cells/µL', r(4000, 11000, '4000 - 11000')),
      num('platelets', 'Platelet Count', '×10³/µL', r(150, 410, '150 - 410')),
      sexed('hematocrit', 'Haematocrit (PCV)', '%', r(40, 50, '40 - 50'), r(36, 46, '36 - 46'), { section: RBC_INDICES }),
      num('mcv',  'MCV',    'fL',   r(83, 101, '83 - 101'),       { section: RBC_INDICES }),
      num('mch',  'MCH',    'pg',   r(27, 32, '27 - 32'),         { section: RBC_INDICES, readOnly: true, calculationType: 'calculated' }),
      num('mchc', 'MCHC',   'g/dL', r(31.5, 34.5, '31.5 - 34.5'), { section: RBC_INDICES, readOnly: true, calculationType: 'calculated' }),
      num('rdw',  'RDW-CV', '%',    r(11.6, 14.0, '11.6 - 14.0'), { section: RBC_INDICES }),
      num('neutrophils', 'Neutrophils', '%', r(40, 80, '40 - 80'), { section: DIFFERENTIAL }),
      num('lymphocytes', 'Lymphocytes', '%', r(20, 40, '20 - 40'), { section: DIFFERENTIAL }),
      num('monocytes',   'Monocytes',   '%', r(2, 10, '2 - 10'),   { section: DIFFERENTIAL }),
      num('eosinophils', 'Eosinophils', '%', r(1, 6, '1 - 6'),     { section: DIFFERENTIAL }),
      num('basophils',   'Basophils',   '%', r(0, 2, '0 - 2'),     { section: DIFFERENTIAL }),
    ],
  },
  {
    key: 'ESR', testName: 'ESR',
    parameters: [
      sexed('esr', 'ESR (Westergren)', 'mm/hr', r(0, 15, '0 - 15'), r(0, 20, '0 - 20')),
    ],
  },
  {
    key: 'BLOOD_SUGAR', testName: 'Blood Sugar (Fasting / Post-Prandial / Random)',
    parameters: [
      num('fasting',      'Blood Sugar - Fasting',            'mg/dL', r(70, 100, '70 - 100')),
      num('postPrandial', 'Blood Sugar - Post-Prandial (2 hr)', 'mg/dL', r(70, 140, '70 - 140')),
      num('random',       'Blood Sugar - Random',             'mg/dL', r(70, 140, '70 - 140')),
    ],
  },
  {
    key: 'HBA1C', testName: 'HbA1c',
    parameters: [
      num('hba1c', 'HbA1c (Glycated Haemoglobin)', '%',
        below(5.7, 'Normal: < 5.7; Prediabetes: 5.7 - 6.4; Diabetes: 6.5 and above')),
      num('eag', 'Estimated Average Glucose (eAG)', 'mg/dL', below(117, '< 117'), { readOnly: true, calculationType: 'estimated' }),
    ],
  },
  {
    key: 'LFT', testName: 'LFT (Liver Function Test)',
    parameters: [
      BILIRUBIN_TOTAL,
      BILIRUBIN_DIRECT,
      { ...BILIRUBIN_INDIRECT, readOnly: true, calculationType: 'calculated' },
      num('sgot',              'SGOT (AST)',               'U/L',   r(0, 40, '0 - 40')),
      num('sgpt',              'SGPT (ALT)',               'U/L',   r(0, 41, '0 - 41')),
      ALP,
      num('ggt',               'Gamma GT (GGT)',           'U/L',   r(8, 61, '8 - 61')),
      num('totalProtein',      'Total Protein',            'g/dL',  r(6.4, 8.3, '6.4 - 8.3')),
      num('albumin',           'Albumin',                  'g/dL',  r(3.5, 5.2, '3.5 - 5.2')),
      num('globulin',          'Globulin',                 'g/dL',  r(2.0, 3.5, '2.0 - 3.5'), { readOnly: true, calculationType: 'calculated' }),
      num('agRatio',           'A/G Ratio',                null,    r(1.0, 2.1, '1.0 - 2.1'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'KFT', testName: 'KFT / RFT (Kidney / Renal Function Test)',
    parameters: [
      num('urea',       'Blood Urea',                'mg/dL', r(17, 43, '17 - 43')),
      num('bun',        'Blood Urea Nitrogen (BUN)', 'mg/dL', r(7, 20, '7 - 20'), { readOnly: true, calculationType: 'conversion' }),
      sexed('creatinine', 'Serum Creatinine', 'mg/dL', r(0.7, 1.3, '0.7 - 1.3'), r(0.6, 1.1, '0.6 - 1.1')),
      URIC_ACID,
      CALCIUM,
      SODIUM,
      POTASSIUM,
      CHLORIDE,
    ],
  },
  {
    key: 'LIPID', testName: 'Lipid Profile',
    parameters: [
      num('totalCholesterol', 'Total Cholesterol',      'mg/dL', below(200, 'Desirable: < 200')),
      num('triglycerides',    'Triglycerides',          'mg/dL', below(150, 'Normal: < 150')),
      sexed('hdl', 'HDL Cholesterol', 'mg/dL', above(40, '> 40'), above(50, '> 50')),
      num('ldl',              'LDL Cholesterol',        'mg/dL', below(100, 'Optimal: < 100')),
      num('vldl',             'VLDL Cholesterol',       'mg/dL', r(2, 30, '2 - 30'), { readOnly: true, calculationType: 'calculated' }),
      num('cholHdlRatio',     'Total Cholesterol / HDL Ratio', null, below(5.0, '< 5.0'), { readOnly: true, calculationType: 'calculated' }),
      num('ldlHdlRatio',      'LDL / HDL Ratio',        null,    below(3.5, '< 3.5'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'THYROID', testName: 'Thyroid Profile (T3, T4, TSH)',
    parameters: [
      num('t3',  'T3 (Total Triiodothyronine)', 'ng/dL',   r(80, 200, '80 - 200')),
      num('t4',  'T4 (Total Thyroxine)',        'µg/dL',   r(5.1, 14.1, '5.1 - 14.1')),
      num('tsh', 'TSH (Thyroid Stimulating Hormone)', 'µIU/mL', r(0.27, 4.2, '0.27 - 4.20')),
    ],
  },
  {
    key: 'URINE_RM', testName: 'Urine Routine & Microscopy',
    parameters: [
      select('colour', 'Colour', ['Pale Yellow', 'Yellow', 'Dark Yellow', 'Colourless', 'Amber', 'Red', 'Brown'],
        ['Pale Yellow', 'Yellow'], { section: 'Physical Examination' }),
      select('appearance', 'Appearance', ['Clear', 'Slightly Turbid', 'Turbid'], ['Clear'],
        { section: 'Physical Examination' }),
      num('specificGravity', 'Specific Gravity', null, r(1.005, 1.030, '1.005 - 1.030'), { section: 'Physical Examination' }),
      num('ph', 'pH', null, r(4.5, 8.0, '4.5 - 8.0'), { section: 'Chemical Examination' }),
      select('protein',      'Protein (Albumin)',  URINE_DIPSTICK, ['Nil'], { section: 'Chemical Examination' }),
      select('glucose',      'Glucose (Sugar)',    URINE_DIPSTICK, ['Nil'], { section: 'Chemical Examination' }),
      select('ketones',      'Ketone Bodies',      NEG_POS, ['Negative'], { section: 'Chemical Examination' }),
      select('bilirubin',    'Bilirubin',          NEG_POS, ['Negative'], { section: 'Chemical Examination' }),
      select('urobilinogen', 'Urobilinogen',       ['Normal', 'Increased'], ['Normal'], { section: 'Chemical Examination' }),
      select('blood',        'Blood',              NEG_POS, ['Negative'], { section: 'Chemical Examination' }),
      select('nitrite',      'Nitrite',            NEG_POS, ['Negative'], { section: 'Chemical Examination' }),
      text('pusCells',       'Pus Cells',       '/hpf', '0 - 5', { section: 'Microscopic Examination' }),
      text('epithelialCells', 'Epithelial Cells', '/hpf', '0 - 5', { section: 'Microscopic Examination' }),
      text('rbcs',           'RBCs',            '/hpf', '0 - 2', { section: 'Microscopic Examination' }),
      text('casts',          'Casts',           null,   'Nil',   { section: 'Microscopic Examination' }),
      text('crystals',       'Crystals',        null,   'Nil',   { section: 'Microscopic Examination' }),
      text('bacteria',       'Bacteria',        null,   'Nil',   { section: 'Microscopic Examination' }),
    ],
  },
  {
    key: 'ELECTROLYTES', testName: 'Serum Electrolytes (Sodium, Potassium, Chloride)',
    parameters: [SODIUM, POTASSIUM, CHLORIDE],
  },
  {
    key: 'CRP', testName: 'CRP (C-Reactive Protein)',
    parameters: [
      num('crp', 'C-Reactive Protein (Quantitative)', 'mg/L', below(5.0, '< 5.0')),
    ],
  },
  {
    key: 'BLOOD_GROUP', testName: 'Blood Grouping & Rh Typing',
    parameters: [
      select('aboGroup', 'ABO Group', ['A', 'B', 'AB', 'O'], undefined),
      select('rhType', 'Rh (D) Type', ['Positive', 'Negative'], undefined),
    ],
  },
  {
    key: 'PT_INR', testName: 'PT / INR',
    parameters: [
      num('ptPatient', 'Prothrombin Time (Patient)', 'seconds', r(11.0, 13.5, '11.0 - 13.5')),
      text('ptControl', 'Prothrombin Time (Control)', 'seconds'),
      num('inr', 'INR', null, r(0.8, 1.2, '0.8 - 1.2')),
    ],
  },
  {
    key: 'VITAMIN_D', testName: 'Vitamin D (25-OH)',
    parameters: [
      num('vitaminD', '25-Hydroxy Vitamin D', 'ng/mL',
        r(30, 100, 'Deficient: < 20; Insufficient: 20 - 29; Sufficient: 30 - 100; Toxic: > 100')),
    ],
  },
  {
    key: 'VITAMIN_B12', testName: 'Vitamin B12',
    parameters: [
      num('vitaminB12', 'Vitamin B12 (Cyanocobalamin)', 'pg/mL', r(211, 911, '211 - 911')),
    ],
  },
  {
    key: 'URIC_ACID', testName: 'Uric Acid',
    parameters: [URIC_ACID],
  },
  {
    key: 'DENGUE', testName: 'Dengue NS1 / IgM / IgG',
    parameters: [
      select('ns1', 'Dengue NS1 Antigen', ['Negative', 'Positive', 'Equivocal'], ['Negative']),
      select('igm', 'Dengue IgM Antibody', ['Negative', 'Positive', 'Equivocal'], ['Negative']),
      select('igg', 'Dengue IgG Antibody', ['Negative', 'Positive', 'Equivocal'], ['Negative']),
    ],
  },
  {
    key: 'MALARIA', testName: 'Malaria Parasite / Antigen',
    parameters: [
      select('smear', 'Malaria Parasite (Peripheral Smear)',
        ['Not Seen', 'P. vivax Seen', 'P. falciparum Seen', 'Mixed Infection Seen'], ['Not Seen']),
      select('pfAntigen', 'P. falciparum Antigen (HRP-2)', NEG_POS, ['Negative']),
      select('pvAntigen', 'P. vivax Antigen (pLDH)',       NEG_POS, ['Negative']),
    ],
  },
  {
    key: 'URINE_CS', testName: 'Urine Culture & Sensitivity',
    parameters: [
      select('cultureResult', 'Culture Result', ['No Growth', 'Growth Detected'], ['No Growth']),
      text('organism',     'Organism Isolated', null),
      text('colonyCount',  'Colony Count',      'CFU/mL', '< 10,000 (not significant)'),
      text('sensitiveTo',  'Sensitive To',      null),
      text('intermediateTo', 'Intermediate To', null),
      text('resistantTo',  'Resistant To',      null),
    ],
  },
  {
    key: 'TROPONIN_I', testName: 'Troponin I',
    parameters: [
      num('troponinI', 'Troponin I (Quantitative)', 'ng/mL', below(0.04, '< 0.04')),
    ],
  },
  {
    key: 'PBS', testName: 'Peripheral Blood Smear (PBS)',
    parameters: [
      text('rbcMorphology',      'RBC Morphology', null, 'Normocytic normochromic'),
      text('wbcMorphology',      'WBC Morphology', null, 'Within normal limits'),
      text('plateletMorphology', 'Platelets',      null, 'Adequate on smear'),
      select('hemoparasites', 'Haemoparasites', ['Not Seen', 'Seen'], ['Not Seen']),
      text('impression', 'Impression', null),
    ],
  },
  {
    key: 'RETIC', testName: 'Reticulocyte Count',
    parameters: [
      num('reticulocytes', 'Reticulocyte Count',          '%',       r(0.5, 2.5, '0.5 - 2.5')),
      num('absoluteRetic', 'Absolute Reticulocyte Count', '×10³/µL', r(25, 75, '25 - 75'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'IRON_PROFILE', testName: 'Iron Profile / Iron Studies',
    parameters: [
      sexed('serumIron', 'Serum Iron', 'µg/dL', r(65, 175, '65 - 175'), r(50, 170, '50 - 170')),
      num('tibc', 'Total Iron Binding Capacity (TIBC)',       'µg/dL', r(250, 450, '250 - 450')),
      num('uibc', 'Unsaturated Iron Binding Capacity (UIBC)', 'µg/dL', r(110, 370, '110 - 370'), { calculationType: 'calculated' }),
      num('transferrinSaturation', 'Transferrin Saturation',  '%',     r(20, 50, '20 - 50'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'FERRITIN', testName: 'Serum Ferritin',
    parameters: [
      sexed('ferritin', 'Serum Ferritin', 'ng/mL', r(30, 400, '30 - 400'), r(13, 150, '13 - 150')),
    ],
  },
  {
    key: 'CALCIUM', testName: 'Serum Calcium',
    parameters: [CALCIUM],
  },
  {
    key: 'MAGNESIUM', testName: 'Serum Magnesium',
    parameters: [num('magnesium', 'Magnesium', 'mg/dL', r(1.6, 2.6, '1.6 - 2.6'))],
  },
  {
    key: 'PHOSPHORUS', testName: 'Serum Phosphorus',
    parameters: [num('phosphorus', 'Phosphorus (Inorganic)', 'mg/dL', r(2.5, 4.5, '2.5 - 4.5'))],
  },
  {
    key: 'AMYLASE', testName: 'Serum Amylase',
    parameters: [num('amylase', 'Amylase', 'U/L', r(28, 100, '28 - 100'))],
  },
  {
    key: 'LIPASE', testName: 'Serum Lipase',
    parameters: [num('lipase', 'Lipase', 'U/L', r(13, 60, '13 - 60'))],
  },
  {
    key: 'BILIRUBIN', testName: 'Total & Direct Bilirubin',
    parameters: [BILIRUBIN_TOTAL, BILIRUBIN_DIRECT, { ...BILIRUBIN_INDIRECT, readOnly: true, calculationType: 'calculated' }],
  },
  {
    key: 'ALP', testName: 'Alkaline Phosphatase (ALP)',
    parameters: [ALP],
  },
  {
    key: 'PCT', testName: 'Procalcitonin (PCT)',
    parameters: [
      num('procalcitonin', 'Procalcitonin', 'ng/mL',
        below(0.5, '< 0.5: Systemic infection unlikely; 0.5 - 2.0: Possible; > 2.0: Likely')),
    ],
  },
  {
    key: 'HBSAG', testName: 'HBsAg (Hepatitis B Surface Antigen)',
    parameters: [select('hbsag', 'HBsAg', REACTIVITY, ['Non-Reactive'])],
  },
  {
    key: 'ANTI_HCV', testName: 'Anti-HCV (Hepatitis C Antibody)',
    parameters: [select('antiHcv', 'Anti-HCV Antibody', REACTIVITY, ['Non-Reactive'])],
  },
  {
    key: 'HIV', testName: 'HIV 1 & 2 Screening',
    parameters: [select('hiv', 'HIV 1 & 2 Antibodies', REACTIVITY, ['Non-Reactive'])],
  },
  {
    // Significant titres: O >= 1:80, H >= 1:160.
    key: 'WIDAL', testName: 'Widal Test',
    parameters: [
      select('typhiO',      'S. Typhi O',      WIDAL_TITRES, WIDAL_TITRES.slice(0, 3), { referenceText: '< 1:80' }),
      select('typhiH',      'S. Typhi H',      WIDAL_TITRES, WIDAL_TITRES.slice(0, 4), { referenceText: '< 1:160' }),
      select('paratyphiAH', 'S. Paratyphi AH', WIDAL_TITRES, WIDAL_TITRES.slice(0, 4), { referenceText: '< 1:160' }),
      select('paratyphiBH', 'S. Paratyphi BH', WIDAL_TITRES, WIDAL_TITRES.slice(0, 4), { referenceText: '< 1:160' }),
    ],
  },
  {
    key: 'TYPHOID_IGM', testName: 'Typhoid IgM',
    parameters: [
      select('typhoidIgm', 'Salmonella Typhi IgM', NEG_POS, ['Negative']),
      select('typhoidIgg', 'Salmonella Typhi IgG', NEG_POS, ['Negative']),
    ],
  },
  {
    // A positive pregnancy test is reported, not flagged as abnormal.
    key: 'PREGNANCY', testName: 'Pregnancy Test (Urine β-hCG)',
    parameters: [select('urineHcg', 'Urine hCG (Qualitative)', NEG_POS, undefined, { referenceText: 'Negative' })],
  },
  {
    key: 'STOOL_RM', testName: 'Stool Routine & Microscopy',
    parameters: [
      select('colour', 'Colour', ['Brown', 'Yellow', 'Green', 'Black', 'Red', 'Clay'], undefined,
        { referenceText: 'Brown', section: 'Physical Examination' }),
      select('consistency', 'Consistency', ['Formed', 'Semi-formed', 'Loose', 'Watery'], ['Formed', 'Semi-formed'],
        { section: 'Physical Examination' }),
      select('mucus',        'Mucus',         ABSENT_PRESENT, ['Absent'], { section: 'Physical Examination' }),
      select('visibleBlood', 'Visible Blood', ABSENT_PRESENT, ['Absent'], { section: 'Physical Examination' }),
      select('occultBlood',  'Occult Blood',  NEG_POS, ['Negative'],      { section: 'Chemical Examination' }),
      text('pusCells', 'Pus Cells', '/hpf', '0 - 5',    { section: 'Microscopic Examination' }),
      text('rbcs',     'RBCs',      '/hpf', 'Nil',      { section: 'Microscopic Examination' }),
      text('ova',      'Ova',       null,   'Not Seen', { section: 'Microscopic Examination' }),
      text('cysts',    'Cysts',     null,   'Not Seen', { section: 'Microscopic Examination' }),
    ],
  },
  {
    key: 'FOBT', testName: 'Stool Occult Blood Test (FOBT)',
    parameters: [select('fobt', 'Faecal Occult Blood', NEG_POS, ['Negative'])],
  },
  // ─── New tests ────────────────────────────────────────────────────────────
  {
    key: 'DP_PROFILE', testName: 'DP Profile',
    parameters: [
      num('fbs',   'Fasting Blood Sugar (FBS)',       'mg/dL', r(70, 100, '70 - 100')),
      num('ppbs',  'Post-Prandial Blood Sugar (PPBS)', 'mg/dL', r(70, 140, '70 - 140')),
      num('hba1c', 'HbA1c (Glycated Haemoglobin)',   '%',     below(5.7, 'Normal: < 5.7; Prediabetes: 5.7 - 6.4; Diabetes: >= 6.5')),
      num('eag',   'Estimated Average Glucose (eAG)', 'mg/dL', below(117, '< 117'), { readOnly: true, calculationType: 'estimated' }),
      num('fastingInsulin', 'Fasting Insulin',        'µIU/mL', r(2.0, 25.0, '2.0 - 25.0')),
      num('homaIr', 'HOMA-IR',                        null,    below(2.5, '< 2.5 (optimal < 1.0)'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'C_PEPTIDE', testName: 'C-Peptide',
    parameters: [
      num('cPeptideFasting',      'C-Peptide (Fasting)',           'ng/mL', r(1.1, 4.4, '1.1 - 4.4')),
      num('cPeptideStimulated',   'C-Peptide (Stimulated / Random)', 'ng/mL', r(1.5, 6.0, '1.5 - 6.0')),
    ],
  },
  {
    key: 'FASTING_INSULIN', testName: 'Fasting Insulin',
    parameters: [
      num('fastingInsulin', 'Fasting Insulin',  'µIU/mL', r(2.0, 25.0, '2.0 - 25.0')),
      num('fastingGlucose', 'Fasting Glucose',  'mg/dL',  r(70, 100, '70 - 100')),
      num('homaIr',         'HOMA-IR',          null,     below(2.5, '< 2.5 (optimal < 1.0)'), { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'SPUTUM_AFB', testName: 'Sputum AFB',
    parameters: [
      select('specimenType', 'Specimen Type',
        ['Sputum (Spot)', 'Sputum (Early Morning)', 'Sputum (Induced)', 'Bronchial Wash', 'BAL'],
        undefined),
      select('smearResult', 'Smear Result (ZN Stain)',
        [
          'No AFB Seen (0)',
          'Scanty (1 - 9 AFB / 100 fields)',
          '1+ (10 - 99 AFB / 100 fields)',
          '2+ (1 - 10 AFB / field)',
          '3+ (> 10 AFB / field)',
        ],
        ['No AFB Seen (0)']),
      select('grading', 'RNTCP / NTEP Grading',
        ['Negative', 'Scanty', '1+', '2+', '3+'],
        ['Negative']),
      text('remarks', 'Remarks', null, 'Negative'),
    ],
  },
  {
    key: 'UREA', testName: 'Urea',
    parameters: [
      num('bloodUrea', 'Blood Urea',                'mg/dL', r(17, 43, '17 - 43')),
      num('bun',       'Blood Urea Nitrogen (BUN)', 'mg/dL', r(7, 20, '7 - 20'), { readOnly: true, calculationType: 'conversion' }),
    ],
  },
  {
    key: 'CREATININE', testName: 'Creatinine',
    parameters: [
      sexed('creatinine', 'Serum Creatinine', 'mg/dL', r(0.7, 1.3, '0.7 - 1.3'), r(0.6, 1.1, '0.6 - 1.1')),
    ],
  },
  {
    key: 'VITAMIN_PROFILE', testName: 'Vitamin Profile',
    parameters: [
      num('vitaminD',    '25-Hydroxy Vitamin D',           'ng/mL',
        r(30, 100, 'Deficient: < 20; Insufficient: 20 - 29; Sufficient: 30 - 100; Toxic: > 100')),
      num('vitaminB12',  'Vitamin B12 (Cyanocobalamin)',   'pg/mL',  r(211, 911, '211 - 911')),
      num('vitaminB9',   'Folic Acid (Vitamin B9)',        'ng/mL',  r(3.1, 20.5, '3.1 - 20.5')),
      num('vitaminA',    'Vitamin A (Retinol)',            'µg/dL',  r(30, 65, '30 - 65')),
      num('vitaminE',    'Vitamin E (alpha-Tocopherol)',   'mg/L',   r(5.5, 17.0, '5.5 - 17.0')),
      num('vitaminC',    'Vitamin C (Ascorbic Acid)',      'mg/dL',  r(0.4, 2.0, '0.4 - 2.0')),
    ],
  },
  // ─── Fourth batch: individually-orderable tests ──────────────────────────
  // Standalone versions of parameters otherwise only orderable inside a panel
  // (CBC, LFT, Lipid Profile, Electrolytes, Blood Sugar), plus new tests.
  // Ranges match the panel's parameter so a value flags identically either way.
  {
    key: 'HB', testName: 'Haemoglobin (Hb)',
    parameters: [
      sexed('hemoglobin', 'Haemoglobin (Hb)', 'g/dL', r(13.0, 17.0, '13.0 - 17.0'), r(12.0, 15.0, '12.0 - 15.0')),
    ],
  },
  {
    key: 'TLC', testName: 'TLC (Total Leucocyte Count)',
    parameters: [num('wbc', 'Total Leucocyte Count (TLC / WBC)', 'cells/µL', r(4000, 11000, '4000 - 11000'))],
  },
  {
    key: 'DLC', testName: 'DLC (Differential Leucocyte Count)',
    parameters: [
      num('neutrophils', 'Neutrophils', '%', r(40, 80, '40 - 80')),
      num('lymphocytes', 'Lymphocytes', '%', r(20, 40, '20 - 40')),
      num('monocytes',   'Monocytes',   '%', r(2, 10, '2 - 10')),
      num('eosinophils', 'Eosinophils', '%', r(1, 6, '1 - 6')),
      num('basophils',   'Basophils',   '%', r(0, 2, '0 - 2')),
    ],
  },
  {
    key: 'PCV', testName: 'PCV / HCT (Packed Cell Volume / Haematocrit)',
    parameters: [
      sexed('hematocrit', 'Haematocrit (PCV)', '%', r(40, 50, '40 - 50'), r(36, 46, '36 - 46')),
    ],
  },
  {
    key: 'PLT', testName: 'Platelet Count (PLT)',
    parameters: [num('platelets', 'Platelet Count', '×10³/µL', r(150, 410, '150 - 410'))],
  },
  {
    key: 'AEC', testName: 'AEC (Absolute Eosinophil Count)',
    parameters: [num('aec', 'Absolute Eosinophil Count', 'cells/µL', r(40, 440, '40 - 440'))],
  },
  {
    key: 'BT', testName: 'BT (Bleeding Time)',
    parameters: [num('bleedingTime', 'Bleeding Time (Duke Method)', 'min', r(1, 5, '1 - 5'))],
  },
  {
    key: 'CT', testName: 'CT (Clotting Time)',
    parameters: [num('clottingTime', 'Clotting Time (Lee-White Method)', 'min', r(5, 15, '5 - 15'))],
  },
  {
    key: 'MP_SMEAR', testName: 'MP (Malaria Parasite - Peripheral Smear)',
    parameters: [
      select('smear', 'Malaria Parasite (Thick & Thin Smear)',
        ['Not Seen', 'P. vivax Seen', 'P. falciparum Seen', 'Mixed Infection Seen'], ['Not Seen']),
      text('stages', 'Stage(s) Seen', null, 'Not applicable'),
    ],
  },
  {
    key: 'MP_CARD', testName: 'MP Card (Malaria Rapid Antigen Test)',
    parameters: [
      select('pfAntigen', 'P. falciparum Antigen (HRP-2)', NEG_POS, ['Negative']),
      select('pvAntigen', 'P. vivax Antigen (pLDH)',       NEG_POS, ['Negative']),
    ],
  },
  {
    key: 'SUGAR_FASTING', testName: 'Blood Sugar - Fasting',
    parameters: [num('fasting', 'Blood Sugar - Fasting', 'mg/dL', r(70, 100, '70 - 100'))],
  },
  {
    key: 'SUGAR_PP', testName: 'Blood Sugar - Post-Prandial (PP)',
    parameters: [num('postPrandial', 'Blood Sugar - Post-Prandial (2 hr)', 'mg/dL', r(70, 140, '70 - 140'))],
  },
  {
    key: 'SUGAR_RANDOM', testName: 'Blood Sugar - Random',
    parameters: [num('random', 'Blood Sugar - Random', 'mg/dL', r(70, 140, '70 - 140'))],
  },
  {
    key: 'SGOT', testName: 'SGOT (AST)',
    parameters: [num('sgot', 'SGOT (AST)', 'U/L', r(0, 40, '0 - 40'))],
  },
  {
    key: 'SGPT', testName: 'SGPT (ALT)',
    parameters: [num('sgpt', 'SGPT (ALT)', 'U/L', r(0, 41, '0 - 41'))],
  },
  {
    key: 'ALBUMIN', testName: 'Serum Albumin',
    parameters: [num('albumin', 'Albumin', 'g/dL', r(3.5, 5.2, '3.5 - 5.2'))],
  },
  {
    key: 'TOTAL_PROTEIN', testName: 'Total Protein',
    parameters: [num('totalProtein', 'Total Protein', 'g/dL', r(6.4, 8.3, '6.4 - 8.3'))],
  },
  {
    key: 'SODIUM', testName: 'Serum Sodium (Na+)',
    parameters: [SODIUM],
  },
  {
    key: 'POTASSIUM', testName: 'Serum Potassium (K+)',
    parameters: [POTASSIUM],
  },
  {
    key: 'TRIGLYCERIDES', testName: 'Serum Triglycerides',
    parameters: [
      num('triglycerides', 'Triglycerides', 'mg/dL',
        below(150, 'Normal: < 150; Borderline High: 150 - 199; High: 200 - 499; Very High: 500 and above')),
    ],
  },
  {
    key: 'CHOLESTEROL', testName: 'Serum Cholesterol (Total)',
    parameters: [
      num('totalCholesterol', 'Total Cholesterol', 'mg/dL',
        below(200, 'Desirable: < 200; Borderline High: 200 - 239; High: 240 and above')),
    ],
  },
  {
    key: 'D_DIMER', testName: 'D-Dimer',
    parameters: [num('dDimer', 'D-Dimer (Quantitative)', 'µg/mL FEU', below(0.5, '< 0.50'))],
  },
  {
    key: 'LDH', testName: 'LDH (Lactate Dehydrogenase)',
    parameters: [
      sexed('ldh', 'Lactate Dehydrogenase (LDH)', 'U/L', r(135, 225, '135 - 225'), r(135, 214, '135 - 214')),
    ],
  },
  // ─── Fifth batch: serology, hormones, tumour markers, profiles ───────────
  // Standalone T3 / T4 / TSH, Serum Iron and Folic Acid mirror the panel
  // parameter (Thyroid Profile, Iron Profile, Vitamin Profile) exactly.
  // Hormone ranges are Roche Elecsys adult intervals; phase-dependent female
  // LH / FSH / E2 ranges are printed as text and not flagged. Semen Analysis
  // uses WHO 2021 lower reference limits. Kit-specific screening values
  // (marker MoMs / risks, IGRA tubes) carry no invented reference range.
  {
    key: 'VDRL', testName: 'VDRL (Syphilis Screening)',
    parameters: [
      select('vdrl', 'VDRL (Qualitative)', REACTIVITY, ['Non-Reactive']),
      select('vdrlTitre', 'Titre (if Reactive)',
        ['1:1', '1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128', '1:256'], undefined),
    ],
  },
  {
    key: 'RA_FACTOR', testName: 'RA Factor (Rheumatoid Factor)',
    parameters: [
      select('raLatex', 'RA Factor (Latex Agglutination)', NEG_POS, ['Negative']),
      num('raFactor', 'Rheumatoid Factor (Quantitative)', 'IU/mL', below(14, '< 14')),
    ],
  },
  {
    key: 'ASO', testName: 'ASO Titer (Anti-Streptolysin O)',
    parameters: [
      select('asoLatex', 'ASO (Latex Agglutination)', NEG_POS, ['Negative']),
      num('aso', 'Anti-Streptolysin O (Quantitative)', 'IU/mL', r(0, 200, 'Adults: up to 200')),
    ],
  },
  {
    key: 'H_PYLORI', testName: 'H. Pylori (Helicobacter pylori)',
    parameters: [
      select('method', 'Method', ['Serum Antibody (IgG)', 'Stool Antigen'], undefined),
      select('hPylori', 'H. pylori', NEG_POS, ['Negative']),
    ],
  },
  {
    key: 'URINE_BS', testName: 'Urine Bile Salts (BS)',
    parameters: [select('bileSalts', 'Bile Salts (Hay\'s Test)', ABSENT_PRESENT, ['Absent'])],
  },
  {
    key: 'URINE_BP', testName: 'Urine Bile Pigments (BP)',
    parameters: [select('bilePigments', 'Bile Pigments (Fouchet\'s Test)', ABSENT_PRESENT, ['Absent'])],
  },
  {
    key: 'SEMEN', testName: 'Semen Analysis',
    parameters: [
      text('abstinence', 'Abstinence Period', 'days', '2 - 7', { section: 'Physical Examination' }),
      num('volume', 'Volume', 'mL', r(1.4, undefined, '1.4 or more'), { section: 'Physical Examination' }),
      select('appearance', 'Appearance', ['Grey-Opalescent', 'Whitish', 'Yellowish', 'Reddish-Brown'],
        ['Grey-Opalescent', 'Whitish'], { section: 'Physical Examination' }),
      num('liquefaction', 'Liquefaction Time', 'min', r(undefined, 60, 'Within 60'), { section: 'Physical Examination' }),
      select('viscosity', 'Viscosity', ['Normal', 'Increased'], ['Normal'], { section: 'Physical Examination' }),
      num('ph', 'pH', null, r(7.2, undefined, '7.2 or more'), { section: 'Physical Examination' }),
      num('concentration', 'Sperm Concentration', 'million/mL', r(16, undefined, '16 or more'), { section: 'Sperm Count' }),
      num('totalCount', 'Total Sperm Count', 'million/ejaculate', r(39, undefined, '39 or more'),
        { section: 'Sperm Count', readOnly: true, calculationType: 'calculated' }),
      num('progressive', 'Progressive Motility (PR)', '%', r(30, undefined, '30 or more'), { section: 'Motility' }),
      text('nonProgressive', 'Non-Progressive Motility (NP)', '%', undefined, { section: 'Motility' }),
      text('immotile', 'Immotile (IM)', '%', undefined, { section: 'Motility' }),
      num('totalMotility', 'Total Motility (PR + NP)', '%', r(42, undefined, '42 or more'),
        { section: 'Motility', readOnly: true, calculationType: 'calculated' }),
      num('vitality', 'Vitality (Live Spermatozoa)', '%', r(54, undefined, '54 or more'), { section: 'Vitality & Morphology' }),
      num('normalForms', 'Normal Morphology', '%', r(4, undefined, '4 or more'), { section: 'Vitality & Morphology' }),
      num('leucocytes', 'Leucocytes (Peroxidase-positive)', 'million/mL', below(1.0, '< 1.0'), { section: 'Other Cells' }),
      text('rbcs', 'RBCs', '/hpf', 'Nil', { section: 'Other Cells' }),
      select('agglutination', 'Agglutination', ABSENT_PRESENT, ['Absent'], { section: 'Other Cells' }),
    ],
  },
  {
    key: 'T3', testName: 'T3 (Total Triiodothyronine)',
    parameters: [num('t3', 'T3 (Total Triiodothyronine)', 'ng/dL', r(80, 200, '80 - 200'))],
  },
  {
    key: 'T4', testName: 'T4 (Total Thyroxine)',
    parameters: [num('t4', 'T4 (Total Thyroxine)', 'µg/dL', r(5.1, 14.1, '5.1 - 14.1'))],
  },
  {
    key: 'TSH', testName: 'TSH (Thyroid Stimulating Hormone)',
    parameters: [num('tsh', 'TSH (Thyroid Stimulating Hormone)', 'µIU/mL', r(0.27, 4.2, '0.27 - 4.20'))],
  },
  {
    key: 'FT3', testName: 'FT3 (Free Triiodothyronine)',
    parameters: [num('ft3', 'Free T3 (FT3)', 'pg/mL', r(2.0, 4.4, '2.0 - 4.4'))],
  },
  {
    key: 'FT4', testName: 'FT4 (Free Thyroxine)',
    parameters: [num('ft4', 'Free T4 (FT4)', 'ng/dL', r(0.93, 1.7, '0.93 - 1.70'))],
  },
  {
    key: 'PROLACTIN', testName: 'Prolactin (PRL)',
    parameters: [
      sexed('prolactin', 'Prolactin', 'ng/mL', r(4.04, 15.2, '4.04 - 15.2'), r(4.79, 23.3, '4.79 - 23.3 (non-pregnant)')),
    ],
  },
  {
    key: 'LH', testName: 'LH (Luteinising Hormone)',
    parameters: [
      sexed('lh', 'Luteinising Hormone (LH)', 'mIU/mL', r(1.7, 8.6, '1.7 - 8.6'),
        { text: 'Follicular: 2.4 - 12.6; Ovulation: 14.0 - 95.6; Luteal: 1.0 - 11.4; Postmenopause: 7.7 - 58.5' }),
    ],
  },
  {
    key: 'FSH', testName: 'FSH (Follicle Stimulating Hormone)',
    parameters: [
      sexed('fsh', 'Follicle Stimulating Hormone (FSH)', 'mIU/mL', r(1.5, 12.4, '1.5 - 12.4'),
        { text: 'Follicular: 3.5 - 12.5; Ovulation: 4.7 - 21.5; Luteal: 1.7 - 7.7; Postmenopause: 25.8 - 134.8' }),
    ],
  },
  {
    // Flags against the widest adult interval; the age bands are printed.
    key: 'TESTOSTERONE', testName: 'Testosterone (Total)',
    parameters: [
      sexed('testosterone', 'Testosterone (Total)', 'ng/mL',
        r(1.93, 8.36, '20 - 49 yrs: 2.49 - 8.36; 50 yrs and above: 1.93 - 7.40'),
        r(0.029, 0.481, '20 - 49 yrs: 0.084 - 0.481; 50 yrs and above: 0.029 - 0.408')),
    ],
  },
  {
    key: 'SERUM_IRON', testName: 'Serum Iron',
    parameters: [sexed('serumIron', 'Serum Iron', 'µg/dL', r(65, 175, '65 - 175'), r(50, 170, '50 - 170'))],
  },
  {
    key: 'TOTAL_IGE', testName: 'Total IgE',
    parameters: [num('totalIge', 'Total IgE', 'IU/mL', r(0, 100, 'Adults: 0 - 100'))],
  },
  {
    key: 'PSA_TOTAL', testName: 'PSA Total (Prostate Specific Antigen)',
    parameters: [num('totalPsa', 'Total PSA', 'ng/mL', r(0, 4.0, '0 - 4.0'))],
  },
  {
    key: 'PSA_FREE', testName: 'PSA Free (Free / Total PSA Ratio)',
    parameters: [
      num('totalPsa', 'Total PSA', 'ng/mL', r(0, 4.0, '0 - 4.0')),
      text('freePsa', 'Free PSA', 'ng/mL', 'Interpret as % Free PSA'),
      num('percentFreePsa', '% Free PSA (Free / Total)', '%',
        above(25, '> 25: Lower risk; 10 - 25: Intermediate; < 10: Higher risk (for Total PSA 4 - 10)'),
        { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    key: 'ACE', testName: 'ACE (Angiotensin Converting Enzyme)',
    parameters: [num('ace', 'Angiotensin Converting Enzyme (ACE)', 'U/L', r(16, 85, 'Adults: 16 - 85'))],
  },
  {
    key: 'ANA', testName: 'ANA (Antinuclear Antibody)',
    parameters: [
      select('method', 'Method', ['Indirect Immunofluorescence (HEp-2)', 'ELISA'], undefined),
      select('ana', 'ANA', NEG_POS, ['Negative']),
      select('titre', 'Titre (if Positive)', ['1:40', '1:80', '1:160', '1:320', '1:640', '1:1280', '1:2560'], undefined),
      select('pattern', 'Pattern (if Positive)',
        ['Homogeneous', 'Fine Speckled', 'Coarse Speckled', 'Nucleolar', 'Centromere', 'Nuclear Dots',
          'Cytoplasmic', 'Mixed'],
        undefined),
    ],
  },
  {
    key: 'CA_125', testName: 'CA-125',
    parameters: [num('ca125', 'CA-125', 'U/mL', r(0, 35, '0 - 35'))],
  },
  {
    key: 'ANTI_CCP', testName: 'Anti-CCP (Anti-Cyclic Citrullinated Peptide)',
    parameters: [num('antiCcp', 'Anti-CCP Antibody', 'U/mL', below(17, '< 17'))],
  },
  {
    key: 'E2', testName: 'E2 (Estradiol)',
    parameters: [
      sexed('estradiol', 'Estradiol (E2)', 'pg/mL', r(11.3, 43.2, '11.3 - 43.2'),
        { text: 'Follicular: 30.9 - 90.4; Ovulation: 60.4 - 533; Luteal: 60.4 - 232; Postmenopause: < 5.0 - 138' }),
    ],
  },
  {
    key: 'HBSAG_QUANT', testName: 'HBsAg Quantitative (Surface Antigen)',
    parameters: [
      num('hbsagQuant', 'HBsAg (Quantitative)', 'IU/mL', below(0.05, '< 0.05: Non-Reactive; 0.05 and above: Reactive')),
    ],
  },
  {
    // A positive result is reported, not flagged as abnormal (as Pregnancy Test).
    key: 'BETA_HCG', testName: 'Beta HCG (Serum Quantitative)',
    parameters: [
      num('betaHcg', 'Beta hCG (Total, Quantitative)', 'mIU/mL',
        { text: 'Non-pregnant: < 5; 5 - 25: Equivocal (repeat after 48 hrs); > 25: Positive for pregnancy' }),
    ],
  },
  {
    // IgG reflects past infection / immunity, so only IgM is flagged.
    key: 'TORCH', testName: 'TORCH Profile',
    parameters: [
      select('toxoIgg',    'Toxoplasma IgG',  ['Negative', 'Positive', 'Equivocal'], undefined,    { section: 'Toxoplasma' }),
      select('toxoIgm',    'Toxoplasma IgM',  ['Negative', 'Positive', 'Equivocal'], ['Negative'], { section: 'Toxoplasma' }),
      select('rubellaIgg', 'Rubella IgG',     ['Negative', 'Positive', 'Equivocal'], undefined,    { section: 'Rubella' }),
      select('rubellaIgm', 'Rubella IgM',     ['Negative', 'Positive', 'Equivocal'], ['Negative'], { section: 'Rubella' }),
      select('cmvIgg',     'CMV IgG',         ['Negative', 'Positive', 'Equivocal'], undefined,    { section: 'Cytomegalovirus (CMV)' }),
      select('cmvIgm',     'CMV IgM',         ['Negative', 'Positive', 'Equivocal'], ['Negative'], { section: 'Cytomegalovirus (CMV)' }),
      select('hsvIgg',     'HSV 1 & 2 IgG',   ['Negative', 'Positive', 'Equivocal'], undefined,    { section: 'Herpes Simplex Virus (HSV)' }),
      select('hsvIgm',     'HSV 1 & 2 IgM',   ['Negative', 'Positive', 'Equivocal'], ['Negative'], { section: 'Herpes Simplex Virus (HSV)' }),
    ],
  },
  {
    // Interferon-gamma release assay (send-out test). Positive: TB Ag - Nil
    // of 0.35 IU/mL or more; a Nil above 8.0 IU/mL makes the test indeterminate.
    key: 'TB_PLATINUM', testName: 'TB Platinum (IGRA)',
    parameters: [
      num('nil', 'Nil (Negative Control)', 'IU/mL', r(undefined, 8.0, '8.0 or less')),
      text('tbAntigen', 'TB Antigen', 'IU/mL'),
      text('mitogen', 'Mitogen (Positive Control)', 'IU/mL'),
      num('tbAgMinusNil', 'TB Antigen - Nil', 'IU/mL', below(0.35, '< 0.35'), { readOnly: true, calculationType: 'calculated' }),
      select('result', 'Result', ['Negative', 'Positive', 'Indeterminate'], ['Negative']),
    ],
  },
  {
    key: 'MICROALBUMIN', testName: 'Microalbumin (Urine Albumin / Creatinine Ratio)',
    parameters: [
      text('urineAlbumin', 'Urine Microalbumin', 'mg/L', 'See ACR'),
      text('urineCreatinine', 'Urine Creatinine', 'mg/dL', 'See ACR'),
      num('acr', 'Albumin / Creatinine Ratio (ACR)', 'mg/g',
        below(30, 'Normal: < 30; Microalbuminuria: 30 - 300; Macroalbuminuria: > 300'),
        { readOnly: true, calculationType: 'calculated' }),
    ],
  },
  {
    // Allergen panels differ by laboratory, so the panel and its positive
    // allergens are recorded as reported rather than as fixed parameters.
    key: 'ALLERGY_PROFILE', testName: 'Allergy Profile',
    parameters: [
      num('totalIge', 'Total IgE', 'IU/mL', r(0, 100, 'Adults: 0 - 100')),
      text('method', 'Method / Panel', null),
      text('allergensTested', 'Allergens Tested', null),
      text('positiveAllergens', 'Allergens Detected (Specific IgE Class 1 and above)', null, 'None detected'),
      text('interpretation', 'Interpretation', null),
    ],
  },
  {
    // Routine antenatal investigations (MoHFW India ANC guidelines).
    key: 'ANC_PROFILE', testName: 'ANC Profile (Antenatal)',
    parameters: [
      num('hemoglobin', 'Haemoglobin (Hb)', 'g/dL', r(11.0, undefined, '11.0 or more (pregnancy)'), { section: 'Haematology' }),
      select('aboGroup', 'ABO Group', ['A', 'B', 'AB', 'O'], undefined, { section: 'Haematology' }),
      select('rhType', 'Rh (D) Type', ['Positive', 'Negative'], undefined, { section: 'Haematology' }),
      num('ogtt2h', 'Plasma Glucose - 2 hr after 75 g OGTT', 'mg/dL',
        below(140, '< 140 (GDM: 140 and above)'), { section: 'Blood Sugar' }),
      select('hiv',   'HIV 1 & 2 Antibodies', REACTIVITY, ['Non-Reactive'], { section: 'Serology' }),
      select('hbsag', 'HBsAg',                REACTIVITY, ['Non-Reactive'], { section: 'Serology' }),
      select('vdrl',  'VDRL',                 REACTIVITY, ['Non-Reactive'], { section: 'Serology' }),
      select('urineAlbumin', 'Urine Albumin', URINE_DIPSTICK, ['Nil'], { section: 'Urine' }),
      select('urineSugar',   'Urine Sugar',   URINE_DIPSTICK, ['Nil'], { section: 'Urine' }),
    ],
  },
  {
    key: 'DUAL_MARKER', testName: 'Dual Marker (First Trimester Screen)',
    parameters: [
      text('gestationalAge', 'Gestational Age (by USG)', null),
      text('freeBhcg',    'Free Beta hCG', null),
      text('freeBhcgMom', 'Free Beta hCG MoM', null),
      text('pappA',       'PAPP-A', null),
      text('pappAMom',    'PAPP-A MoM', null),
      text('riskT21',     'Risk - Trisomy 21 (Down Syndrome)', null),
      text('riskT18',     'Risk - Trisomy 18 / 13', null),
      select('screenResult', 'Screening Result', ['Screen Negative', 'Screen Positive'], ['Screen Negative']),
    ],
  },
  {
    key: 'TRIPLE_MARKER', testName: 'Triple Marker (Second Trimester Screen)',
    parameters: [
      text('gestationalAge', 'Gestational Age (by USG)', null),
      text('afp',    'AFP (Alpha-Fetoprotein)', null),
      num('afpMom',  'AFP MoM', null, below(2.5, '< 2.5 (neural tube defect screen)')),
      text('hcg',    'hCG (Total)', null),
      text('hcgMom', 'hCG MoM', null),
      text('ue3',    'Unconjugated Estriol (uE3)', null),
      text('ue3Mom', 'uE3 MoM', null),
      text('riskT21', 'Risk - Trisomy 21 (Down Syndrome)', null),
      text('riskT18', 'Risk - Trisomy 18', null),
      select('screenResult', 'Screening Result', ['Screen Negative', 'Screen Positive'], ['Screen Negative']),
    ],
  },
  {
    // Red cell indices + Hb HPLC; HbA2 above 3.5% suggests beta-thalassaemia trait.
    key: 'THALASSEMIA', testName: 'Thalassemia Profile',
    parameters: [
      sexed('hemoglobin', 'Haemoglobin (Hb)', 'g/dL', r(13.0, 17.0, '13.0 - 17.0'), r(12.0, 15.0, '12.0 - 15.0'), { section: RBC_INDICES }),
      sexed('rbc', 'Total RBC Count', 'million/µL', r(4.5, 5.5, '4.5 - 5.5'), r(3.8, 4.8, '3.8 - 4.8'), { section: RBC_INDICES }),
      num('mcv',  'MCV',    'fL', r(83, 101, '83 - 101'),       { section: RBC_INDICES }),
      num('mch',  'MCH',    'pg', r(27, 32, '27 - 32'),         { section: RBC_INDICES }),
      num('rdw',  'RDW-CV', '%',  r(11.6, 14.0, '11.6 - 14.0'), { section: RBC_INDICES }),
      num('mentzerIndex', 'Mentzer Index (MCV / RBC)', null, above(13, '> 13 (< 13 suggests thalassaemia trait)'),
        { section: RBC_INDICES, readOnly: true, calculationType: 'calculated' }),
      num('hbA',  'HbA',  '%', r(95, 98, '95 - 98'),   { section: 'Haemoglobin HPLC' }),
      num('hbA2', 'HbA2', '%', r(1.5, 3.5, '1.5 - 3.5'), { section: 'Haemoglobin HPLC' }),
      num('hbF',  'HbF',  '%', below(1.0, '< 1.0'),    { section: 'Haemoglobin HPLC' }),
      text('abnormalHb', 'Abnormal Haemoglobin Variant', null, 'Not detected', { section: 'Haemoglobin HPLC' }),
      text('interpretation', 'Interpretation', null, undefined, { section: 'Haemoglobin HPLC' }),
    ],
  },
  {
    key: 'LITHIUM', testName: 'Serum Lithium',
    parameters: [num('lithium', 'Serum Lithium', 'mmol/L', r(0.6, 1.2, 'Therapeutic: 0.6 - 1.2; Toxic: > 1.5'))],
  },
  {
    key: 'COOMBS_DIRECT', testName: 'Coombs Test - Direct (DAT)',
    parameters: [
      select('dat', 'Direct Antiglobulin Test (DAT)', NEG_POS, ['Negative']),
      select('grade', 'Agglutination Grade (if Positive)', ['Weak (w+)', '1+', '2+', '3+', '4+'], undefined),
    ],
  },
  {
    key: 'COOMBS_INDIRECT', testName: 'Coombs Test - Indirect (IAT)',
    parameters: [
      select('iat', 'Indirect Antiglobulin Test (IAT)', NEG_POS, ['Negative']),
      select('titre', 'Antibody Titre (if Positive)',
        ['1:1', '1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128', '1:256', '1:512', '1:1024'], undefined),
    ],
  },
  {
    key: 'FOLIC_ACID', testName: 'Folic Acid (Vitamin B9)',
    parameters: [num('vitaminB9', 'Folic Acid (Vitamin B9)', 'ng/mL', r(3.1, 20.5, '3.1 - 20.5'))],
  },
  {
    // Allergen-specific immunotherapy work-up: the vaccine is made up only of
    // allergens the patient is sensitised to. Panels differ by laboratory, so
    // allergens are recorded as reported (as in Allergy Profile).
    key: 'ALLERGY_VACCINE', testName: 'Allergy Vaccine',
    parameters: [
      num('totalIge', 'Total IgE', 'IU/mL', r(0, 100, 'Adults: 0 - 100')),
      text('method', 'Method / Panel', null),
      text('allergensTested', 'Allergens Tested', null),
      text('positiveAllergens', 'Allergens Detected (Specific IgE Class 1 and above)', null, 'None detected'),
      text('vaccineAllergens', 'Allergens Selected for Vaccine (Immunotherapy)', null),
      text('interpretation', 'Interpretation', null),
    ],
  },
  {
    // Salmonella Typhi IgM / IgG by ELISA, reported as an index (sample OD /
    // cut-off OD): < 0.9 Negative, 0.9 - 1.1 Equivocal, > 1.1 Positive.
    key: 'WIDAL_ELISA', testName: 'Widal ELISA',
    parameters: [
      num('typhiIgm', 'S. Typhi IgM (Index)', 'Index', below(0.9, 'Negative: < 0.9; Equivocal: 0.9 - 1.1; Positive: > 1.1'),
        { section: 'Salmonella Typhi IgM' }),
      select('typhiIgmResult', 'S. Typhi IgM Result', ELISA_RESULT, ['Negative'], { section: 'Salmonella Typhi IgM' }),
      num('typhiIgg', 'S. Typhi IgG (Index)', 'Index', below(0.9, 'Negative: < 0.9; Equivocal: 0.9 - 1.1; Positive: > 1.1'),
        { section: 'Salmonella Typhi IgG' }),
      select('typhiIggResult', 'S. Typhi IgG Result', ELISA_RESULT, ['Negative'], { section: 'Salmonella Typhi IgG' }),
    ],
  },
];

// Any test name outside the catalog — a single free-text result line.
export const GENERIC_TEMPLATE_KEY = 'GENERIC';

function genericTemplate(testName: string): PathologyReportTemplate {
  return { key: GENERIC_TEMPLATE_KEY, testName, parameters: [text('result', 'Result', null)] };
}

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

const TEMPLATE_BY_NAME = new Map(PATHOLOGY_REPORT_TEMPLATES.map((t) => [normalizeName(t.testName), t]));

export function findReportTemplate(testName: string): PathologyReportTemplate {
  return TEMPLATE_BY_NAME.get(normalizeName(testName)) ?? genericTemplate(testName);
}

// A request's tests are stored as one `testType` string, joined with ", " when
// several are selected. Commas inside parentheses belong to a single test's
// name (e.g. "Thyroid Profile (T3, T4, TSH)"), so only top-level commas split.
// Mirrors splitTests in client/app/(dashboard)/lab/page.tsx. Duplicate names
// collapse to one entry — each test name identifies one report.
export function splitPathologyTests(testType: string): string[] {
  const tests: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of testType) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      tests.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  tests.push(current);
  return [...new Set(tests.map((t) => t.trim()).filter(Boolean))];
}

// The range that applies to this patient: gender-specific when the template
// has one, otherwise the combined range.
export function resolveRange(
  param:  PathologyParameterTemplate,
  gender: string | null | undefined,
): PathologyReferenceRange | undefined {
  if (gender === 'MALE'   && param.rangeMale)   return param.rangeMale;
  if (gender === 'FEMALE' && param.rangeFemale) return param.rangeFemale;
  return param.range;
}

export function resolveReferenceText(
  param:  PathologyParameterTemplate,
  gender: string | null | undefined,
): string | null {
  return resolveRange(param, gender)?.text ?? param.referenceText ?? null;
}

export type PathologyResultFlag = 'HIGH' | 'LOW' | 'ABNORMAL';

export function computeFlag(
  param:  PathologyParameterTemplate,
  value:  string,
  gender: string | null | undefined,
): PathologyResultFlag | null {
  if (param.inputType === 'number') {
    const range = resolveRange(param, gender);
    const n = Number(value);
    if (!range || !Number.isFinite(n)) return null;
    if (range.low  !== undefined && (range.exclusive ? n <= range.low  : n < range.low))  return 'LOW';
    if (range.high !== undefined && (range.exclusive ? n >= range.high : n > range.high)) return 'HIGH';
    return null;
  }
  if (param.inputType === 'select' && param.normalValues) {
    return param.normalValues.includes(value) ? null : 'ABNORMAL';
  }
  return null;
}
