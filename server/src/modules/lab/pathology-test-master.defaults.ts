import { PATHOLOGY_REPORT_TEMPLATES, GENERIC_TEMPLATE_KEY } from './pathology-report-templates';

// ─── Pathology Test Master — initial clinical content ────────────────────────
// Seed values only. Each tenant's `pathology_test_masters` collection is
// populated from this list the first time it is read (missing rows only — a
// saved row is never overwritten), and from then on the database row is the
// single source of truth: reports always print the currently saved value,
// and the Lab → Test Master screen edits it. Nothing here is read by the PDF.
//
// `comment` is set only for tests whose report needs a test-specific comment
// (the screening serologies); every other test keeps it null. GENERIC is the
// master row for any test outside the catalog (no note/comment, but it still
// carries the report footer).
//
// Printed with Helvetica (WinAnsiEncoding) — keep to Latin-1 characters.

export interface PathologyTestMasterSeed {
  templateKey:         string;
  testName:            string;
  clinicalNote:        string | null;
  comment:             string | null;
  correlateClinically: string;
}

export const GENERIC_TEST_MASTER_NAME = 'Other / Unlisted Tests';

export const DEFAULT_CORRELATE_CLINICALLY =
  'The results pertain only to the sample tested. Laboratory investigations are only a tool to facilitate ' +
  'diagnosis and should be interpreted in correlation with the patient\'s clinical history, examination ' +
  'findings and other investigations.';

const CONTENT: Record<string, { clinicalNote: string | null; comment?: string }> = {
  CBC: {
    clinicalNote:
      'Complete Blood Count evaluates red cells, white cells and platelets. It helps detect anaemia, infection, ' +
      'inflammation, bleeding disorders and haematological malignancies. Values may vary with age, sex, ' +
      'hydration status and recent transfusion.',
  },
  ESR: {
    clinicalNote:
      'ESR is a non-specific marker of inflammation. Raised values are seen in infection, autoimmune disease, ' +
      'malignancy, anaemia, pregnancy and with advancing age; a normal ESR does not exclude disease.',
  },
  BLOOD_SUGAR: {
    clinicalNote:
      'Fasting sample requires 8 - 10 hours of fasting; the post-prandial sample is collected 2 hours after a meal. ' +
      'Fasting glucose of 126 mg/dL or above, or 2-hour / random glucose of 200 mg/dL or above, is suggestive of ' +
      'diabetes mellitus and should be confirmed by repeat testing.',
  },
  HBA1C: {
    clinicalNote:
      'HbA1c reflects the average blood glucose over the preceding 2 - 3 months. Values may be falsely altered in ' +
      'haemoglobinopathies, haemolytic or iron deficiency anaemia, recent blood loss or transfusion, and chronic ' +
      'kidney disease.',
  },
  LFT: {
    clinicalNote:
      'Liver Function Tests assess hepatocellular injury (SGOT, SGPT), cholestasis (ALP, GGT, bilirubin) and ' +
      'synthetic function (total protein, albumin). Mild variations may occur with medications, alcohol intake, ' +
      'strenuous exercise and haemolysis of the sample.',
  },
  KFT: {
    clinicalNote:
      'Kidney Function Tests assess glomerular filtration and electrolyte balance. Urea and creatinine are ' +
      'affected by hydration status, dietary protein, muscle mass and drugs; serial values are more informative ' +
      'than a single result.',
  },
  LIPID: {
    clinicalNote:
      'Lipid Profile is preferably performed after 9 - 12 hours of overnight fasting; triglycerides are ' +
      'significantly affected by recent food and alcohol intake. Values should be interpreted with the overall ' +
      'cardiovascular risk profile.',
  },
  THYROID: {
    clinicalNote:
      'Thyroid hormone levels show diurnal variation, with TSH highest in the early morning. Results may be ' +
      'affected by pregnancy, acute illness and drugs such as steroids, amiodarone and biotin supplements.',
  },
  URINE_RM: {
    clinicalNote:
      'An early-morning midstream urine sample is preferred and should be examined within 2 hours of collection. ' +
      'Results may be affected by hydration status, diet, medications and contamination of the sample.',
  },
  ELECTROLYTES: {
    clinicalNote:
      'Serum electrolytes help assess fluid, acid-base and renal status. Haemolysis or delayed separation of the ' +
      'sample may falsely raise potassium.',
  },
  CRP: {
    clinicalNote:
      'CRP is an acute-phase protein that rises within 6 - 8 hours of inflammation or infection. It is ' +
      'non-specific and is most useful for monitoring disease activity and response to treatment on serial ' +
      'measurement.',
  },
  BLOOD_GROUP: {
    clinicalNote:
      'Blood group must be reconfirmed and a cross-match performed before any transfusion. Weak D variants may ' +
      'require further testing.',
  },
  PT_INR: {
    clinicalNote:
      'PT / INR assesses the extrinsic and common coagulation pathways and is used to monitor oral anticoagulant ' +
      '(warfarin) therapy. The therapeutic INR target depends on the clinical indication, typically 2.0 - 3.0.',
  },
  VITAMIN_D: {
    clinicalNote:
      '25-Hydroxy Vitamin D is the best indicator of vitamin D status. Levels vary with sun exposure, season, ' +
      'diet and supplementation.',
  },
  VITAMIN_B12: {
    clinicalNote:
      'Low Vitamin B12 may cause megaloblastic anaemia and neurological symptoms. Borderline values should be ' +
      'interpreted with clinical features; levels may be affected by recent supplementation.',
  },
  URIC_ACID: {
    clinicalNote:
      'Serum uric acid may be raised in gout, renal impairment, high-purine diet, alcohol intake and with drugs ' +
      'such as diuretics. Hyperuricaemia alone does not confirm gout.',
  },
  DENGUE: {
    clinicalNote:
      'NS1 antigen is usually detectable from day 1 to day 5 of fever; IgM antibodies appear after day 4 - 5, and ' +
      'IgG later in primary infection or early in secondary infection. A negative result early in the illness ' +
      'does not rule out dengue.',
  },
  MALARIA: {
    clinicalNote:
      'A single negative smear does not rule out malaria; repeat smears at 6 - 12 hour intervals are advised if ' +
      'clinical suspicion persists. Antigen tests may remain positive for some time after successful treatment.',
  },
  URINE_CS: {
    clinicalNote:
      'A clean-catch midstream urine sample collected before starting antibiotics is preferred. A colony count of ' +
      '100,000 CFU/mL or more is generally considered significant; lower counts should be interpreted clinically.',
  },
  TROPONIN_I: {
    clinicalNote:
      'Troponin I is a sensitive marker of myocardial injury that begins to rise 3 - 6 hours after the onset of ' +
      'symptoms; serial measurement is recommended. Elevations may also occur in renal failure, sepsis and ' +
      'pulmonary embolism.',
  },
  PBS: {
    clinicalNote:
      'Peripheral smear examination assesses the morphology of red cells, white cells and platelets and is ' +
      'interpreted together with the complete blood count.',
  },
  RETIC: {
    clinicalNote:
      'Reticulocyte count reflects bone marrow red cell production. It is raised after blood loss, haemolysis and ' +
      'response to haematinic therapy, and low in marrow failure and untreated nutritional anaemias.',
  },
  IRON_PROFILE: {
    clinicalNote:
      'Iron studies help differentiate iron deficiency from anaemia of chronic disease. Serum iron shows diurnal ' +
      'variation and is affected by recent iron intake; a fasting morning sample is preferred.',
  },
  FERRITIN: {
    clinicalNote:
      'Serum ferritin reflects body iron stores; low values indicate iron deficiency. Ferritin is also an ' +
      'acute-phase reactant and may be raised in inflammation, infection, liver disease and malignancy.',
  },
  CALCIUM: {
    clinicalNote:
      'Total calcium should be interpreted with serum albumin, as low albumin lowers total calcium. Prolonged ' +
      'tourniquet application may falsely raise values.',
  },
  MAGNESIUM: {
    clinicalNote:
      'Serum magnesium may be low in malabsorption, alcoholism, diuretic therapy and uncontrolled diabetes, and ' +
      'raised in renal failure. Haemolysis may falsely raise values.',
  },
  PHOSPHORUS: {
    clinicalNote:
      'Serum phosphorus shows diurnal variation and is affected by recent meals. It is interpreted together with ' +
      'calcium, vitamin D and parathyroid status.',
  },
  AMYLASE: {
    clinicalNote:
      'Serum amylase rises within 6 - 12 hours of acute pancreatitis and returns to normal in 3 - 5 days. Raised ' +
      'values are also seen in salivary gland disease, bowel obstruction and renal failure.',
  },
  LIPASE: {
    clinicalNote:
      'Serum lipase is more specific than amylase for acute pancreatitis and remains elevated for longer. A value ' +
      'more than three times the upper reference limit supports the diagnosis.',
  },
  BILIRUBIN: {
    clinicalNote:
      'Predominantly indirect hyperbilirubinaemia suggests haemolysis or Gilbert syndrome; predominantly direct ' +
      'hyperbilirubinaemia suggests hepatocellular or obstructive (cholestatic) causes.',
  },
  ALP: {
    clinicalNote:
      'ALP originates mainly from liver and bone. Physiologically higher values are seen in growing children, ' +
      'adolescents and pregnancy; raised values in adults may indicate cholestasis or bone disease.',
  },
  PCT: {
    clinicalNote:
      'Procalcitonin rises in systemic bacterial infection and sepsis and helps guide antibiotic therapy. Values ' +
      'may also rise after major surgery, trauma or burns; localised infections may show normal levels.',
  },
  HBSAG: {
    clinicalNote:
      'HBsAg is the earliest serological marker of Hepatitis B virus infection and indicates current (acute or ' +
      'chronic) infection. Persistence of HBsAg beyond 6 months indicates chronic infection.',
    comment:
      'This is a screening test. A Reactive result should be confirmed by a supplemental test (e.g. neutralisation ' +
      'assay / HBV DNA) before a final diagnosis. A Non-Reactive result does not exclude infection in the window ' +
      'period or with mutant strains; repeat testing is advised if clinically indicated.',
  },
  ANTI_HCV: {
    clinicalNote:
      'Anti-HCV antibody indicates past or present exposure to Hepatitis C virus. It does not distinguish between ' +
      'active and resolved infection.',
    comment:
      'This is a screening test. A Reactive result should be confirmed by HCV RNA (PCR) testing to establish ' +
      'active infection. Antibodies may not be detectable in early infection (window period) or in ' +
      'immunocompromised patients.',
  },
  HIV: {
    clinicalNote:
      'HIV 1 & 2 screening detects antibodies to Human Immunodeficiency Virus types 1 and 2.',
    comment:
      'This is a screening test. A Reactive result must be confirmed by supplemental testing as per NACO ' +
      'guidelines before a diagnosis is made, with appropriate pre- and post-test counselling. A Non-Reactive ' +
      'result does not exclude infection during the window period; repeat testing is advised if exposure is ' +
      'suspected.',
  },
  WIDAL: {
    clinicalNote:
      'Widal titres should be interpreted in the context of local baseline titres, prior vaccination and previous ' +
      'infection. A four-fold rise in titre in paired samples taken 7 - 10 days apart is more significant than a ' +
      'single titre.',
  },
  TYPHOID_IGM: {
    clinicalNote:
      'Salmonella Typhi IgM antibodies usually appear after the first week of illness. Blood culture remains the ' +
      'gold standard for the diagnosis of enteric fever.',
  },
  PREGNANCY: {
    clinicalNote:
      'Urine hCG is usually detectable 10 - 14 days after conception; an early-morning sample is preferred. A ' +
      'negative result very early in pregnancy should be repeated after 48 - 72 hours if pregnancy is suspected.',
  },
  STOOL_RM: {
    clinicalNote:
      'A fresh stool sample, free of urine and water, should be examined within 1 hour of passage. Parasites are ' +
      'shed intermittently; examination of three samples on alternate days is advised if clinically indicated.',
  },
  FOBT: {
    clinicalNote:
      'Dietary red meat, certain vegetables, iron supplements and NSAIDs may affect the result. A positive result ' +
      'requires further evaluation to determine the source of bleeding.',
  },
  DP_PROFILE: {
    clinicalNote:
      'DP Profile (Diabetes Profile) combines fasting and post-prandial blood glucose, HbA1c and fasting insulin ' +
      'to comprehensively assess glycaemic status and insulin resistance. A fasting sample of 8 - 10 hours is ' +
      'required; results should be interpreted together with clinical history. HOMA-IR above 2.5 suggests insulin ' +
      'resistance; values above 5.0 indicate significant resistance.',
  },
  C_PEPTIDE: {
    clinicalNote:
      'C-Peptide is co-secreted with insulin and reflects endogenous insulin production. It is useful to ' +
      'distinguish Type 1 from Type 2 diabetes, assess residual beta-cell function, and evaluate hypoglycaemia. ' +
      'Low values indicate reduced insulin secretion (Type 1 / advanced Type 2); high values may suggest ' +
      'insulinoma or insulin resistance. Results should be interpreted in correlation with simultaneous blood ' +
      'glucose levels.',
  },
  FASTING_INSULIN: {
    clinicalNote:
      'Fasting insulin is elevated in insulin resistance and early Type 2 diabetes. A fasting sample of at ' +
      'least 8 hours is required. HOMA-IR (calculated from fasting insulin and fasting glucose) provides an ' +
      'estimate of insulin resistance; values above 2.5 suggest resistance and values above 5.0 indicate ' +
      'significant resistance. Results should be correlated with clinical history and other metabolic markers.',
  },
  SPUTUM_AFB: {
    clinicalNote:
      'Sputum AFB smear microscopy detects acid-fast bacilli (primarily Mycobacterium tuberculosis) using the ' +
      'Ziehl-Neelsen (ZN) stain. A minimum of three specimens on consecutive days is recommended, including at ' +
      'least one early-morning sample. A negative smear does not exclude tuberculosis; culture and CBNAAT / GeneXpert ' +
      'should be performed if clinical suspicion is high. Results are graded per RNTCP / NTEP guidelines.',
  },
  UREA: {
    clinicalNote:
      'Blood urea reflects the end product of protein catabolism and is filtered by the kidneys. Raised values ' +
      'are seen in renal impairment, dehydration, high-protein diet, gastrointestinal bleeding, and catabolic ' +
      'states; low values may occur in liver failure or malnutrition. Blood Urea Nitrogen (BUN) is a calculated ' +
      'conversion (Urea × 28/60).',
  },
  CREATININE: {
    clinicalNote:
      'Serum creatinine reflects glomerular filtration rate and is a more specific marker of renal function than ' +
      'urea. Values are influenced by muscle mass, age, sex and diet. An eGFR should be calculated when ' +
      'interpreting creatinine results. Serial values are more informative than a single measurement.',
  },
  VITAMIN_PROFILE: {
    clinicalNote:
      'Vitamin Profile measures levels of key fat-soluble (A, D, E) and water-soluble (B9/Folate, B12, C) ' +
      'vitamins. Samples for fat-soluble vitamins and B12 should ideally be collected fasting; Vitamin C should ' +
      'be processed promptly as it is unstable. Results may be affected by supplementation, diet, sun exposure, ' +
      'medications and underlying illness. Deficiencies are common and may be subclinical; interpretation should ' +
      'be correlated with clinical symptoms and dietary history.',
  },
};

// One seed row per catalog test (catalog order), then GENERIC.
export const PATHOLOGY_TEST_MASTER_SEEDS: PathologyTestMasterSeed[] = [
  ...PATHOLOGY_REPORT_TEMPLATES.map((t) => ({
    templateKey:         t.key,
    testName:            t.testName,
    clinicalNote:        CONTENT[t.key]?.clinicalNote ?? null,
    comment:             CONTENT[t.key]?.comment ?? null,
    correlateClinically: DEFAULT_CORRELATE_CLINICALLY,
  })),
  {
    templateKey:         GENERIC_TEMPLATE_KEY,
    testName:            GENERIC_TEST_MASTER_NAME,
    clinicalNote:        null,
    comment:             null,
    correlateClinically: DEFAULT_CORRELATE_CLINICALLY,
  },
];
