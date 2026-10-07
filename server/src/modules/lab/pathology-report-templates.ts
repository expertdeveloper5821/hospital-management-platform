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
      num('mch',  'MCH',    'pg',   r(27, 32, '27 - 32'),         { section: RBC_INDICES }),
      num('mchc', 'MCHC',   'g/dL', r(31.5, 34.5, '31.5 - 34.5'), { section: RBC_INDICES }),
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
      num('eag', 'Estimated Average Glucose (eAG)', 'mg/dL', below(117, '< 117')),
    ],
  },
  {
    key: 'LFT', testName: 'LFT (Liver Function Test)',
    parameters: [
      BILIRUBIN_TOTAL,
      BILIRUBIN_DIRECT,
      BILIRUBIN_INDIRECT,
      num('sgot',              'SGOT (AST)',               'U/L',   r(0, 40, '0 - 40')),
      num('sgpt',              'SGPT (ALT)',               'U/L',   r(0, 41, '0 - 41')),
      ALP,
      num('ggt',               'Gamma GT (GGT)',           'U/L',   r(8, 61, '8 - 61')),
      num('totalProtein',      'Total Protein',            'g/dL',  r(6.4, 8.3, '6.4 - 8.3')),
      num('albumin',           'Albumin',                  'g/dL',  r(3.5, 5.2, '3.5 - 5.2')),
      num('globulin',          'Globulin',                 'g/dL',  r(2.0, 3.5, '2.0 - 3.5')),
      num('agRatio',           'A/G Ratio',                null,    r(1.0, 2.1, '1.0 - 2.1')),
    ],
  },
  {
    key: 'KFT', testName: 'KFT / RFT (Kidney / Renal Function Test)',
    parameters: [
      num('urea',       'Blood Urea',                'mg/dL', r(17, 43, '17 - 43')),
      num('bun',        'Blood Urea Nitrogen (BUN)', 'mg/dL', r(7, 20, '7 - 20')),
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
      num('vldl',             'VLDL Cholesterol',       'mg/dL', r(2, 30, '2 - 30')),
      num('cholHdlRatio',     'Total Cholesterol / HDL Ratio', null, below(5.0, '< 5.0')),
      num('ldlHdlRatio',      'LDL / HDL Ratio',        null,    below(3.5, '< 3.5')),
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
      num('absoluteRetic', 'Absolute Reticulocyte Count', '×10³/µL', r(25, 75, '25 - 75')),
    ],
  },
  {
    key: 'IRON_PROFILE', testName: 'Iron Profile / Iron Studies',
    parameters: [
      sexed('serumIron', 'Serum Iron', 'µg/dL', r(65, 175, '65 - 175'), r(50, 170, '50 - 170')),
      num('tibc', 'Total Iron Binding Capacity (TIBC)',       'µg/dL', r(250, 450, '250 - 450')),
      num('uibc', 'Unsaturated Iron Binding Capacity (UIBC)', 'µg/dL', r(110, 370, '110 - 370')),
      num('transferrinSaturation', 'Transferrin Saturation',  '%',     r(20, 50, '20 - 50')),
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
    parameters: [BILIRUBIN_TOTAL, BILIRUBIN_DIRECT, BILIRUBIN_INDIRECT],
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
