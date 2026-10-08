import {
  PATHOLOGY_REPORT_TEMPLATES,
  GENERIC_TEMPLATE_KEY,
  findReportTemplate,
  splitPathologyTests,
  resolveReferenceText,
  computeFlag,
} from '../../../src/modules/lab/pathology-report-templates';

// The New Pathology Request catalog (client/app/(dashboard)/lab/page.tsx
// PATHOLOGY_TEST_TYPES) — every name must open its own structured form.
const CATALOG = [
  'CBC (Complete Blood Count)',
  'ESR',
  'Blood Sugar (Fasting / Post-Prandial / Random)',
  'HbA1c',
  'LFT (Liver Function Test)',
  'KFT / RFT (Kidney / Renal Function Test)',
  'Lipid Profile',
  'Thyroid Profile (T3, T4, TSH)',
  'Urine Routine & Microscopy',
  'Serum Electrolytes (Sodium, Potassium, Chloride)',
  'CRP (C-Reactive Protein)',
  'Blood Grouping & Rh Typing',
  'PT / INR',
  'Vitamin D (25-OH)',
  'Vitamin B12',
  'Uric Acid',
  'Dengue NS1 / IgM / IgG',
  'Malaria Parasite / Antigen',
  'Urine Culture & Sensitivity',
  'Troponin I',
  // Added in the second batch (catalog now 40 tests).
  'Peripheral Blood Smear (PBS)',
  'Reticulocyte Count',
  'Iron Profile / Iron Studies',
  'Serum Ferritin',
  'Serum Calcium',
  'Serum Magnesium',
  'Serum Phosphorus',
  'Serum Amylase',
  'Serum Lipase',
  'Total & Direct Bilirubin',
  'Alkaline Phosphatase (ALP)',
  'Procalcitonin (PCT)',
  'HBsAg (Hepatitis B Surface Antigen)',
  'Anti-HCV (Hepatitis C Antibody)',
  'HIV 1 & 2 Screening',
  'Widal Test',
  'Typhoid IgM',
  'Pregnancy Test (Urine β-hCG)',
  'Stool Routine & Microscopy',
  'Stool Occult Blood Test (FOBT)',
  // Added in the third batch (catalog now 47 tests).
  'DP Profile',
  'C-Peptide',
  'Fasting Insulin',
  'Sputum AFB',
  'Urea',
  'Creatinine',
  'Vitamin Profile',
];

const keysOf = (testName: string) => findReportTemplate(testName).parameters.map((p) => p.key);

describe('Pathology report templates — catalog coverage', () => {
  test.each(CATALOG)('"%s" has a dedicated structured template', (name) => {
    const t = findReportTemplate(name);
    expect(t.key).not.toBe(GENERIC_TEMPLATE_KEY);
    expect(t.testName).toBe(name);
    expect(t.parameters.length).toBeGreaterThan(0);
  });

  test('the catalog has 47 tests, each with a distinct template key', () => {
    expect(CATALOG).toHaveLength(47);
    expect(new Set(PATHOLOGY_REPORT_TEMPLATES.map((t) => t.key)).size).toBe(47);
  });

  test('one template per catalog test, no extras, and unique parameter keys within each', () => {
    expect(PATHOLOGY_REPORT_TEMPLATES.map((t) => t.testName).sort()).toEqual([...CATALOG].sort());
    for (const t of PATHOLOGY_REPORT_TEMPLATES) {
      const keys = t.parameters.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test('every number parameter has a range; every select has options', () => {
    for (const t of PATHOLOGY_REPORT_TEMPLATES) {
      for (const p of t.parameters) {
        if (p.inputType === 'number') expect(p.range ?? p.rangeMale).toBeDefined();
        if (p.inputType === 'select') expect(p.options?.length).toBeGreaterThan(0);
      }
    }
  });

  test('CBC carries the standard haematology parameters', () => {
    expect(keysOf('CBC (Complete Blood Count)')).toEqual([
      'hemoglobin', 'rbc', 'wbc', 'platelets', 'hematocrit', 'mcv', 'mch', 'mchc', 'rdw',
      'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils',
    ]);
  });

  test('Serum Electrolytes has exactly the three named electrolytes', () => {
    expect(keysOf('Serum Electrolytes (Sodium, Potassium, Chloride)')).toEqual(['sodium', 'potassium', 'chloride']);
  });

  test.each([
    ['LFT (Liver Function Test)',  ['totalBilirubin', 'directBilirubin', 'sgot', 'sgpt', 'alp', 'albumin']],
    ['KFT / RFT (Kidney / Renal Function Test)', ['urea', 'creatinine', 'uricAcid', 'sodium', 'potassium']],
    ['Lipid Profile',              ['totalCholesterol', 'triglycerides', 'hdl', 'ldl', 'vldl']],
    ['Thyroid Profile (T3, T4, TSH)', ['t3', 't4', 'tsh']],
    ['PT / INR',                   ['ptPatient', 'ptControl', 'inr']],
    ['Dengue NS1 / IgM / IgG',     ['ns1', 'igm', 'igg']],
    ['Urine Culture & Sensitivity', ['cultureResult', 'organism', 'colonyCount', 'sensitiveTo', 'resistantTo']],
  ])('%s includes its standard parameters', (name, expected) => {
    expect(keysOf(name)).toEqual(expect.arrayContaining(expected));
  });

  test.each([
    ['Peripheral Blood Smear (PBS)',        ['rbcMorphology', 'wbcMorphology', 'plateletMorphology', 'hemoparasites', 'impression']],
    ['Reticulocyte Count',                  ['reticulocytes', 'absoluteRetic']],
    ['Iron Profile / Iron Studies',         ['serumIron', 'tibc', 'uibc', 'transferrinSaturation']],
    ['Serum Ferritin',                      ['ferritin']],
    ['Serum Calcium',                       ['calcium']],
    ['Serum Magnesium',                     ['magnesium']],
    ['Serum Phosphorus',                    ['phosphorus']],
    ['Serum Amylase',                       ['amylase']],
    ['Serum Lipase',                        ['lipase']],
    ['Total & Direct Bilirubin',            ['totalBilirubin', 'directBilirubin', 'indirectBilirubin']],
    ['Alkaline Phosphatase (ALP)',          ['alp']],
    ['Procalcitonin (PCT)',                 ['procalcitonin']],
    ['HBsAg (Hepatitis B Surface Antigen)', ['hbsag']],
    ['Anti-HCV (Hepatitis C Antibody)',     ['antiHcv']],
    ['HIV 1 & 2 Screening',                 ['hiv']],
    ['Widal Test',                          ['typhiO', 'typhiH', 'paratyphiAH', 'paratyphiBH']],
    ['Typhoid IgM',                         ['typhoidIgm', 'typhoidIgg']],
    ['Pregnancy Test (Urine β-hCG)',        ['urineHcg']],
    ['Stool Routine & Microscopy',          ['colour', 'consistency', 'mucus', 'visibleBlood', 'occultBlood', 'pusCells', 'rbcs', 'ova', 'cysts']],
    ['Stool Occult Blood Test (FOBT)',      ['fobt']],
  ])('new test "%s" has exactly its standard parameters', (name, expected) => {
    expect(keysOf(name)).toEqual(expected);
  });

  test('standalone Bilirubin / ALP / Calcium reuse the LFT / KFT definitions', () => {
    const lft = findReportTemplate('LFT (Liver Function Test)').parameters;
    const kft = findReportTemplate('KFT / RFT (Kidney / Renal Function Test)').parameters;
    expect(findReportTemplate('Total & Direct Bilirubin').parameters).toEqual(lft.slice(0, 3));
    expect(findReportTemplate('Alkaline Phosphatase (ALP)').parameters).toEqual([lft.find((p) => p.key === 'alp')]);
    expect(findReportTemplate('Serum Calcium').parameters).toEqual([kft.find((p) => p.key === 'calcium')]);
  });

  test('the β in "Pregnancy Test (Urine β-hCG)" is matched exactly', () => {
    expect(findReportTemplate('Pregnancy Test (Urine β-hCG)').key).toBe('PREGNANCY');
    expect(findReportTemplate('Pregnancy Test (Urine b-hCG)').key).toBe(GENERIC_TEMPLATE_KEY);
  });

  test('lookup tolerates case/whitespace differences', () => {
    expect(findReportTemplate('  cbc   (complete blood count) ').key).toBe('CBC');
  });

  test('an unknown/free-text test name falls back to a single free-text Result field', () => {
    const t = findReportTemplate('Blood CBC');
    expect(t.key).toBe(GENERIC_TEMPLATE_KEY);
    expect(t.testName).toBe('Blood CBC');
    expect(t.parameters).toEqual([expect.objectContaining({ key: 'result', inputType: 'text' })]);
  });
});

describe('splitPathologyTests', () => {
  test('splits on top-level commas only, keeping parenthesised commas', () => {
    expect(splitPathologyTests('CBC (Complete Blood Count), Thyroid Profile (T3, T4, TSH), ESR')).toEqual([
      'CBC (Complete Blood Count)', 'Thyroid Profile (T3, T4, TSH)', 'ESR',
    ]);
  });

  test('a single legacy free-text test is one test; blanks and duplicates collapse', () => {
    expect(splitPathologyTests('Blood CBC')).toEqual(['Blood CBC']);
    expect(splitPathologyTests('ESR, , ESR')).toEqual(['ESR']);
  });
});

describe('reference ranges and flags', () => {
  const cbc = findReportTemplate('CBC (Complete Blood Count)');
  const hb  = cbc.parameters.find((p) => p.key === 'hemoglobin')!;
  const wbc = cbc.parameters.find((p) => p.key === 'wbc')!;

  test('gender-specific ranges resolve per patient gender, combined text otherwise', () => {
    expect(resolveReferenceText(hb, 'MALE')).toBe('13.0 - 17.0');
    expect(resolveReferenceText(hb, 'FEMALE')).toBe('12.0 - 15.0');
    expect(resolveReferenceText(hb, 'OTHER')).toBe('M: 13.0 - 17.0; F: 12.0 - 15.0');
  });

  test('numeric values are flagged LOW / HIGH outside the range, null inside', () => {
    expect(computeFlag(hb, '12.5', 'MALE')).toBe('LOW');
    expect(computeFlag(hb, '12.5', 'FEMALE')).toBeNull();
    expect(computeFlag(wbc, '12000', 'MALE')).toBe('HIGH');
    expect(computeFlag(wbc, '4000', 'MALE')).toBeNull();     // inclusive bound
    // No gender-specific range for OTHER → no basis for a flag.
    expect(computeFlag(hb, '5', 'OTHER')).toBeNull();
  });

  test('"< X" / "> X" bounds are exclusive', () => {
    const lipid = findReportTemplate('Lipid Profile');
    const chol = lipid.parameters.find((p) => p.key === 'totalCholesterol')!;
    const hdl  = lipid.parameters.find((p) => p.key === 'hdl')!;
    expect(computeFlag(chol, '199', null)).toBeNull();
    expect(computeFlag(chol, '200', null)).toBe('HIGH');
    expect(computeFlag(hdl, '40', 'MALE')).toBe('LOW');
    expect(computeFlag(hdl, '41', 'MALE')).toBeNull();
  });

  test('select values outside the normal set are ABNORMAL; no normal set → no flag', () => {
    const dengue = findReportTemplate('Dengue NS1 / IgM / IgG').parameters.find((p) => p.key === 'ns1')!;
    expect(computeFlag(dengue, 'Negative', null)).toBeNull();
    expect(computeFlag(dengue, 'Positive', null)).toBe('ABNORMAL');
    const abo = findReportTemplate('Blood Grouping & Rh Typing').parameters.find((p) => p.key === 'aboGroup')!;
    expect(computeFlag(abo, 'B', null)).toBeNull();
  });

  test('new tests: gender ranges, serology reactivity, Widal titre cut-offs and a non-flagged pregnancy result', () => {
    const ferritin = findReportTemplate('Serum Ferritin').parameters[0];
    expect(resolveReferenceText(ferritin, 'FEMALE')).toBe('13 - 150');
    expect(computeFlag(ferritin, '10', 'FEMALE')).toBe('LOW');

    const hbsag = findReportTemplate('HBsAg (Hepatitis B Surface Antigen)').parameters[0];
    expect(hbsag.options).toEqual(['Non-Reactive', 'Reactive']);
    expect(computeFlag(hbsag, 'Reactive', null)).toBe('ABNORMAL');
    expect(computeFlag(hbsag, 'Non-Reactive', null)).toBeNull();

    const [typhiO, typhiH] = findReportTemplate('Widal Test').parameters;
    expect(computeFlag(typhiO, '1:40', null)).toBeNull();
    expect(computeFlag(typhiO, '1:80', null)).toBe('ABNORMAL');
    expect(computeFlag(typhiH, '1:80', null)).toBeNull();
    expect(computeFlag(typhiH, '1:160', null)).toBe('ABNORMAL');
    expect(resolveReferenceText(typhiH, null)).toBe('< 1:160');

    const hcg = findReportTemplate('Pregnancy Test (Urine β-hCG)').parameters[0];
    expect(computeFlag(hcg, 'Positive', 'FEMALE')).toBeNull();
    expect(resolveReferenceText(hcg, 'FEMALE')).toBe('Negative');

    const pct = findReportTemplate('Procalcitonin (PCT)').parameters[0];
    expect(computeFlag(pct, '0.49', null)).toBeNull();
    expect(computeFlag(pct, '0.5', null)).toBe('HIGH');
  });

  test('free-text parameters are never flagged', () => {
    const pus = findReportTemplate('Urine Routine & Microscopy').parameters.find((p) => p.key === 'pusCells')!;
    expect(computeFlag(pus, '10-12', null)).toBeNull();
  });
});
