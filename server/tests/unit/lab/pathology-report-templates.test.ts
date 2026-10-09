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
  // Added in the fourth batch (catalog now 70 tests).
  'Haemoglobin (Hb)',
  'TLC (Total Leucocyte Count)',
  'DLC (Differential Leucocyte Count)',
  'PCV / HCT (Packed Cell Volume / Haematocrit)',
  'Platelet Count (PLT)',
  'AEC (Absolute Eosinophil Count)',
  'BT (Bleeding Time)',
  'CT (Clotting Time)',
  'MP (Malaria Parasite - Peripheral Smear)',
  'MP Card (Malaria Rapid Antigen Test)',
  'Blood Sugar - Fasting',
  'Blood Sugar - Post-Prandial (PP)',
  'Blood Sugar - Random',
  'SGOT (AST)',
  'SGPT (ALT)',
  'Serum Albumin',
  'Total Protein',
  'Serum Sodium (Na+)',
  'Serum Potassium (K+)',
  'Serum Triglycerides',
  'Serum Cholesterol (Total)',
  'D-Dimer',
  'LDH (Lactate Dehydrogenase)',
  // Added in the fifth batch (catalog now 109 tests).
  'VDRL (Syphilis Screening)',
  'RA Factor (Rheumatoid Factor)',
  'ASO Titer (Anti-Streptolysin O)',
  'H. Pylori (Helicobacter pylori)',
  'Urine Bile Salts (BS)',
  'Urine Bile Pigments (BP)',
  'Semen Analysis',
  'T3 (Total Triiodothyronine)',
  'T4 (Total Thyroxine)',
  'TSH (Thyroid Stimulating Hormone)',
  'FT3 (Free Triiodothyronine)',
  'FT4 (Free Thyroxine)',
  'Prolactin (PRL)',
  'LH (Luteinising Hormone)',
  'FSH (Follicle Stimulating Hormone)',
  'Testosterone (Total)',
  'Serum Iron',
  'Total IgE',
  'PSA Total (Prostate Specific Antigen)',
  'PSA Free (Free / Total PSA Ratio)',
  'ACE (Angiotensin Converting Enzyme)',
  'ANA (Antinuclear Antibody)',
  'CA-125',
  'Anti-CCP (Anti-Cyclic Citrullinated Peptide)',
  'E2 (Estradiol)',
  'HBsAg Quantitative (Surface Antigen)',
  'Beta HCG (Serum Quantitative)',
  'TORCH Profile',
  'TB Platinum (IGRA)',
  'Microalbumin (Urine Albumin / Creatinine Ratio)',
  'Allergy Profile',
  'ANC Profile (Antenatal)',
  'Dual Marker (First Trimester Screen)',
  'Triple Marker (Second Trimester Screen)',
  'Thalassemia Profile',
  'Serum Lithium',
  'Coombs Test - Direct (DAT)',
  'Coombs Test - Indirect (IAT)',
  'Folic Acid (Vitamin B9)',
];

const keysOf = (testName: string) => findReportTemplate(testName).parameters.map((p) => p.key);

describe('Pathology report templates — catalog coverage', () => {
  test.each(CATALOG)('"%s" has a dedicated structured template', (name) => {
    const t = findReportTemplate(name);
    expect(t.key).not.toBe(GENERIC_TEMPLATE_KEY);
    expect(t.testName).toBe(name);
    expect(t.parameters.length).toBeGreaterThan(0);
  });

  test('the catalog has 109 tests, each with a distinct template key', () => {
    expect(CATALOG).toHaveLength(109);
    expect(new Set(PATHOLOGY_REPORT_TEMPLATES.map((t) => t.key)).size).toBe(109);
  });

  test('no two catalog names collide after normalisation, and none contains a top-level comma', () => {
    const norm = CATALOG.map((n) => n.trim().replace(/\s+/g, ' ').toLowerCase());
    expect(new Set(norm).size).toBe(CATALOG.length);
    for (const name of CATALOG) expect(splitPathologyTests(name)).toEqual([name]);
  });

  test.each([
    ['Haemoglobin (Hb)',                             'HB',            ['hemoglobin']],
    ['TLC (Total Leucocyte Count)',                  'TLC',           ['wbc']],
    ['DLC (Differential Leucocyte Count)',           'DLC',           ['neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils']],
    ['PCV / HCT (Packed Cell Volume / Haematocrit)', 'PCV',           ['hematocrit']],
    ['Platelet Count (PLT)',                         'PLT',           ['platelets']],
    ['AEC (Absolute Eosinophil Count)',              'AEC',           ['aec']],
    ['BT (Bleeding Time)',                           'BT',            ['bleedingTime']],
    ['CT (Clotting Time)',                           'CT',            ['clottingTime']],
    ['MP (Malaria Parasite - Peripheral Smear)',     'MP_SMEAR',      ['smear', 'stages']],
    ['MP Card (Malaria Rapid Antigen Test)',         'MP_CARD',       ['pfAntigen', 'pvAntigen']],
    ['Blood Sugar - Fasting',                        'SUGAR_FASTING', ['fasting']],
    ['Blood Sugar - Post-Prandial (PP)',             'SUGAR_PP',      ['postPrandial']],
    ['Blood Sugar - Random',                         'SUGAR_RANDOM',  ['random']],
    ['SGOT (AST)',                                   'SGOT',          ['sgot']],
    ['SGPT (ALT)',                                   'SGPT',          ['sgpt']],
    ['Serum Albumin',                                'ALBUMIN',       ['albumin']],
    ['Total Protein',                                'TOTAL_PROTEIN', ['totalProtein']],
    ['Serum Sodium (Na+)',                           'SODIUM',        ['sodium']],
    ['Serum Potassium (K+)',                         'POTASSIUM',     ['potassium']],
    ['Serum Triglycerides',                          'TRIGLYCERIDES', ['triglycerides']],
    ['Serum Cholesterol (Total)',                    'CHOLESTEROL',   ['totalCholesterol']],
    ['D-Dimer',                                      'D_DIMER',       ['dDimer']],
    ['LDH (Lactate Dehydrogenase)',                  'LDH',           ['ldh']],
  ])('fourth-batch test "%s" (%s) has exactly its own parameters', (name, key, expected) => {
    expect(findReportTemplate(name).key).toBe(key);
    expect(keysOf(name)).toEqual(expected);
  });

  test('standalone tests share the unit and reference range of the panel parameter they mirror', () => {
    const param = (test: string, key: string) => findReportTemplate(test).parameters.find((p) => p.key === key)!;
    const pairs: Array<[string, string, string]> = [
      ['Haemoglobin (Hb)', 'CBC (Complete Blood Count)', 'hemoglobin'],
      ['TLC (Total Leucocyte Count)', 'CBC (Complete Blood Count)', 'wbc'],
      ['DLC (Differential Leucocyte Count)', 'CBC (Complete Blood Count)', 'neutrophils'],
      ['DLC (Differential Leucocyte Count)', 'CBC (Complete Blood Count)', 'eosinophils'],
      ['PCV / HCT (Packed Cell Volume / Haematocrit)', 'CBC (Complete Blood Count)', 'hematocrit'],
      ['Platelet Count (PLT)', 'CBC (Complete Blood Count)', 'platelets'],
      ['Blood Sugar - Fasting', 'Blood Sugar (Fasting / Post-Prandial / Random)', 'fasting'],
      ['Blood Sugar - Post-Prandial (PP)', 'Blood Sugar (Fasting / Post-Prandial / Random)', 'postPrandial'],
      ['Blood Sugar - Random', 'Blood Sugar (Fasting / Post-Prandial / Random)', 'random'],
      ['SGOT (AST)', 'LFT (Liver Function Test)', 'sgot'],
      ['SGPT (ALT)', 'LFT (Liver Function Test)', 'sgpt'],
      ['Serum Albumin', 'LFT (Liver Function Test)', 'albumin'],
      ['Total Protein', 'LFT (Liver Function Test)', 'totalProtein'],
      ['Serum Sodium (Na+)', 'Serum Electrolytes (Sodium, Potassium, Chloride)', 'sodium'],
      ['Serum Potassium (K+)', 'Serum Electrolytes (Sodium, Potassium, Chloride)', 'potassium'],
    ];
    for (const [standalone, panel, key] of pairs) {
      const a = param(standalone, key);
      const b = param(panel, key);
      expect({ standalone, key, unit: a.unit, range: a.range, m: a.rangeMale, f: a.rangeFemale })
        .toEqual({ standalone, key, unit: b.unit, range: b.range, m: b.rangeMale, f: b.rangeFemale });
    }
  });

  test('fourth-batch flags: exclusive D-Dimer cut-off, gender-specific LDH, positive MP smear / card', () => {
    const p = (test: string, key: string) => findReportTemplate(test).parameters.find((x) => x.key === key)!;
    expect(computeFlag(p('D-Dimer', 'dDimer'), '0.49', null)).toBeNull();
    expect(computeFlag(p('D-Dimer', 'dDimer'), '0.5', null)).toBe('HIGH');
    expect(computeFlag(p('LDH (Lactate Dehydrogenase)', 'ldh'), '220', 'MALE')).toBeNull();
    expect(computeFlag(p('LDH (Lactate Dehydrogenase)', 'ldh'), '220', 'FEMALE')).toBe('HIGH');
    expect(resolveReferenceText(p('LDH (Lactate Dehydrogenase)', 'ldh'), null)).toBe('M: 135 - 225; F: 135 - 214');
    expect(computeFlag(p('MP (Malaria Parasite - Peripheral Smear)', 'smear'), 'P. vivax Seen', null)).toBe('ABNORMAL');
    expect(computeFlag(p('MP (Malaria Parasite - Peripheral Smear)', 'smear'), 'Not Seen', null)).toBeNull();
    expect(computeFlag(p('MP Card (Malaria Rapid Antigen Test)', 'pfAntigen'), 'Positive', null)).toBe('ABNORMAL');
    expect(computeFlag(p('BT (Bleeding Time)', 'bleedingTime'), '6', null)).toBe('HIGH');
    expect(computeFlag(p('CT (Clotting Time)', 'clottingTime'), '8', null)).toBeNull();
    expect(computeFlag(p('AEC (Absolute Eosinophil Count)', 'aec'), '600', null)).toBe('HIGH');
    expect(computeFlag(p('Serum Triglycerides', 'triglycerides'), '150', null)).toBe('HIGH');
    expect(computeFlag(p('Serum Cholesterol (Total)', 'totalCholesterol'), '199', null)).toBeNull();
  });

  test.each([
    ['VDRL (Syphilis Screening)',                       'VDRL',            ['vdrl', 'vdrlTitre']],
    ['RA Factor (Rheumatoid Factor)',                   'RA_FACTOR',       ['raLatex', 'raFactor']],
    ['ASO Titer (Anti-Streptolysin O)',                 'ASO',             ['asoLatex', 'aso']],
    ['H. Pylori (Helicobacter pylori)',                 'H_PYLORI',        ['method', 'hPylori']],
    ['Urine Bile Salts (BS)',                           'URINE_BS',        ['bileSalts']],
    ['Urine Bile Pigments (BP)',                        'URINE_BP',        ['bilePigments']],
    ['Semen Analysis',                                  'SEMEN',           ['abstinence', 'volume', 'appearance', 'liquefaction', 'viscosity', 'ph',
      'concentration', 'totalCount', 'progressive', 'nonProgressive', 'immotile', 'totalMotility', 'vitality', 'normalForms',
      'leucocytes', 'rbcs', 'agglutination']],
    ['T3 (Total Triiodothyronine)',                     'T3',              ['t3']],
    ['T4 (Total Thyroxine)',                            'T4',              ['t4']],
    ['TSH (Thyroid Stimulating Hormone)',               'TSH',             ['tsh']],
    ['FT3 (Free Triiodothyronine)',                     'FT3',             ['ft3']],
    ['FT4 (Free Thyroxine)',                            'FT4',             ['ft4']],
    ['Prolactin (PRL)',                                 'PROLACTIN',       ['prolactin']],
    ['LH (Luteinising Hormone)',                        'LH',              ['lh']],
    ['FSH (Follicle Stimulating Hormone)',              'FSH',             ['fsh']],
    ['Testosterone (Total)',                            'TESTOSTERONE',    ['testosterone']],
    ['Serum Iron',                                      'SERUM_IRON',      ['serumIron']],
    ['Total IgE',                                       'TOTAL_IGE',       ['totalIge']],
    ['PSA Total (Prostate Specific Antigen)',           'PSA_TOTAL',       ['totalPsa']],
    ['PSA Free (Free / Total PSA Ratio)',               'PSA_FREE',        ['totalPsa', 'freePsa', 'percentFreePsa']],
    ['ACE (Angiotensin Converting Enzyme)',             'ACE',             ['ace']],
    ['ANA (Antinuclear Antibody)',                      'ANA',             ['method', 'ana', 'titre', 'pattern']],
    ['CA-125',                                          'CA_125',          ['ca125']],
    ['Anti-CCP (Anti-Cyclic Citrullinated Peptide)',    'ANTI_CCP',        ['antiCcp']],
    ['E2 (Estradiol)',                                  'E2',              ['estradiol']],
    ['HBsAg Quantitative (Surface Antigen)',            'HBSAG_QUANT',     ['hbsagQuant']],
    ['Beta HCG (Serum Quantitative)',                   'BETA_HCG',        ['betaHcg']],
    ['TORCH Profile',                                   'TORCH',           ['toxoIgg', 'toxoIgm', 'rubellaIgg', 'rubellaIgm', 'cmvIgg', 'cmvIgm', 'hsvIgg', 'hsvIgm']],
    ['TB Platinum (IGRA)',                              'TB_PLATINUM',     ['nil', 'tbAntigen', 'mitogen', 'tbAgMinusNil', 'result']],
    ['Microalbumin (Urine Albumin / Creatinine Ratio)', 'MICROALBUMIN',    ['urineAlbumin', 'urineCreatinine', 'acr']],
    ['Allergy Profile',                                 'ALLERGY_PROFILE', ['totalIge', 'method', 'allergensTested', 'positiveAllergens', 'interpretation']],
    ['ANC Profile (Antenatal)',                         'ANC_PROFILE',     ['hemoglobin', 'aboGroup', 'rhType', 'ogtt2h', 'hiv', 'hbsag', 'vdrl', 'urineAlbumin', 'urineSugar']],
    ['Dual Marker (First Trimester Screen)',            'DUAL_MARKER',     ['gestationalAge', 'freeBhcg', 'freeBhcgMom', 'pappA', 'pappAMom', 'riskT21', 'riskT18', 'screenResult']],
    ['Triple Marker (Second Trimester Screen)',         'TRIPLE_MARKER',   ['gestationalAge', 'afp', 'afpMom', 'hcg', 'hcgMom', 'ue3', 'ue3Mom', 'riskT21', 'riskT18', 'screenResult']],
    ['Thalassemia Profile',                             'THALASSEMIA',     ['hemoglobin', 'rbc', 'mcv', 'mch', 'rdw', 'mentzerIndex', 'hbA', 'hbA2', 'hbF', 'abnormalHb', 'interpretation']],
    ['Serum Lithium',                                   'LITHIUM',         ['lithium']],
    ['Coombs Test - Direct (DAT)',                      'COOMBS_DIRECT',   ['dat', 'grade']],
    ['Coombs Test - Indirect (IAT)',                    'COOMBS_INDIRECT', ['iat', 'titre']],
    ['Folic Acid (Vitamin B9)',                         'FOLIC_ACID',      ['vitaminB9']],
  ])('fifth-batch test "%s" (%s) has exactly its own parameters', (name, key, expected) => {
    expect(findReportTemplate(name).key).toBe(key);
    expect(keysOf(name)).toEqual(expected);
  });

  test('fifth-batch standalone tests share the unit and range of the panel parameter they mirror', () => {
    const param = (test: string, key: string) => findReportTemplate(test).parameters.find((p) => p.key === key)!;
    const pairs: Array<[string, string, string]> = [
      ['T3 (Total Triiodothyronine)', 'Thyroid Profile (T3, T4, TSH)', 't3'],
      ['T4 (Total Thyroxine)', 'Thyroid Profile (T3, T4, TSH)', 't4'],
      ['TSH (Thyroid Stimulating Hormone)', 'Thyroid Profile (T3, T4, TSH)', 'tsh'],
      ['Serum Iron', 'Iron Profile / Iron Studies', 'serumIron'],
      ['Folic Acid (Vitamin B9)', 'Vitamin Profile', 'vitaminB9'],
      ['PSA Free (Free / Total PSA Ratio)', 'PSA Total (Prostate Specific Antigen)', 'totalPsa'],
      ['Allergy Profile', 'Total IgE', 'totalIge'],
      ['Thalassemia Profile', 'CBC (Complete Blood Count)', 'rbc'],
      ['Thalassemia Profile', 'CBC (Complete Blood Count)', 'mcv'],
      ['Thalassemia Profile', 'CBC (Complete Blood Count)', 'rdw'],
    ];
    for (const [standalone, panel, key] of pairs) {
      const a = param(standalone, key);
      const b = param(panel, key);
      expect({ standalone, key, unit: a.unit, range: a.range, m: a.rangeMale, f: a.rangeFemale })
        .toEqual({ standalone, key, unit: b.unit, range: b.range, m: b.rangeMale, f: b.rangeFemale });
    }
  });

  test('fifth-batch flags: exclusive cut-offs, sexed hormones, unflagged phase ranges and qualitative results', () => {
    const p = (test: string, key: string) => findReportTemplate(test).parameters.find((x) => x.key === key)!;
    // Exclusive "< X" cut-offs flag X itself.
    expect(computeFlag(p('RA Factor (Rheumatoid Factor)', 'raFactor'), '13.9', null)).toBeNull();
    expect(computeFlag(p('RA Factor (Rheumatoid Factor)', 'raFactor'), '14', null)).toBe('HIGH');
    expect(computeFlag(p('HBsAg Quantitative (Surface Antigen)', 'hbsagQuant'), '0.05', null)).toBe('HIGH');
    expect(computeFlag(p('Anti-CCP (Anti-Cyclic Citrullinated Peptide)', 'antiCcp'), '16', null)).toBeNull();
    expect(computeFlag(p('Triple Marker (Second Trimester Screen)', 'afpMom'), '2.5', null)).toBe('HIGH');
    expect(computeFlag(p('TB Platinum (IGRA)', 'tbAgMinusNil'), '0.35', null)).toBe('HIGH');
    expect(computeFlag(p('Microalbumin (Urine Albumin / Creatinine Ratio)', 'acr'), '45', null)).toBe('HIGH');
    // WHO 2021 semen limits are lower limits only.
    expect(computeFlag(p('Semen Analysis', 'concentration'), '15', null)).toBe('LOW');
    expect(computeFlag(p('Semen Analysis', 'concentration'), '16', null)).toBeNull();
    expect(computeFlag(p('Semen Analysis', 'normalForms'), '80', null)).toBeNull();
    // Gender-specific.
    expect(computeFlag(p('Prolactin (PRL)', 'prolactin'), '20', 'MALE')).toBe('HIGH');
    expect(computeFlag(p('Prolactin (PRL)', 'prolactin'), '20', 'FEMALE')).toBeNull();
    // Cycle-phase female ranges are printed but never flagged.
    const phased: Array<[string, string]> = [
      ['LH (Luteinising Hormone)', 'lh'], ['FSH (Follicle Stimulating Hormone)', 'fsh'], ['E2 (Estradiol)', 'estradiol'],
    ];
    for (const [test, key] of phased) {
      expect(computeFlag(p(test, key), '9999', 'FEMALE')).toBeNull();
      expect(resolveReferenceText(p(test, key), 'FEMALE')).toMatch(/^Follicular: .*Postmenopause: /);
    }
    expect(computeFlag(p('LH (Luteinising Hormone)', 'lh'), '9', 'MALE')).toBe('HIGH');
    // A positive pregnancy result is reported, not flagged.
    expect(computeFlag(p('Beta HCG (Serum Quantitative)', 'betaHcg'), '25000', 'FEMALE')).toBeNull();
    // Qualitative.
    expect(computeFlag(p('VDRL (Syphilis Screening)', 'vdrl'), 'Reactive', null)).toBe('ABNORMAL');
    expect(computeFlag(p('VDRL (Syphilis Screening)', 'vdrlTitre'), '1:8', null)).toBeNull();
    expect(computeFlag(p('TORCH Profile', 'rubellaIgg'), 'Positive', null)).toBeNull();
    expect(computeFlag(p('TORCH Profile', 'rubellaIgm'), 'Positive', null)).toBe('ABNORMAL');
    expect(computeFlag(p('Coombs Test - Direct (DAT)', 'dat'), 'Positive', null)).toBe('ABNORMAL');
    expect(computeFlag(p('Thalassemia Profile', 'hbA2'), '4.8', null)).toBe('HIGH');
  });

  test('every template string fits the PDF font (Latin-1), except the original Pregnancy Test name', () => {
    for (const t of PATHOLOGY_REPORT_TEMPLATES) {
      const strings = [t.key === 'PREGNANCY' ? '' : t.testName];
      for (const prm of t.parameters) {
        strings.push(prm.name, prm.unit ?? '', prm.section ?? '', prm.referenceText ?? '',
          prm.range?.text ?? '', prm.rangeMale?.text ?? '', prm.rangeFemale?.text ?? '', ...(prm.options ?? []));
      }
      for (const str of strings) {
        expect({ key: t.key, str, latin1: /^[\x20-\xFF]*$/.test(str) }).toEqual({ key: t.key, str, latin1: true });
      }
    }
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
