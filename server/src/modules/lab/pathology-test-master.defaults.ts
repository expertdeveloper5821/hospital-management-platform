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
  HB: {
    clinicalNote:
      'Haemoglobin is the oxygen-carrying protein of red cells; a low value indicates anaemia and a high value may ' +
      'be seen in dehydration, chronic hypoxia or polycythaemia. Values vary with age, sex, altitude, pregnancy ' +
      'and recent transfusion.',
  },
  TLC: {
    clinicalNote:
      'Total Leucocyte Count measures the number of white blood cells. Raised counts are seen in bacterial ' +
      'infection, inflammation, stress, steroid therapy and leukaemia; low counts in viral infections, marrow ' +
      'suppression and certain drugs. Interpret together with the differential count.',
  },
  DLC: {
    clinicalNote:
      'Differential Leucocyte Count gives the relative percentage of each white cell type. Neutrophilia suggests ' +
      'bacterial infection, lymphocytosis viral infection, and eosinophilia allergy or parasitic infestation. ' +
      'The five values should total 100%; interpret together with the total leucocyte count.',
  },
  PCV: {
    clinicalNote:
      'Packed Cell Volume (Haematocrit) is the percentage of blood volume occupied by red cells. Low values are ' +
      'seen in anaemia and haemodilution; raised values in dehydration, polycythaemia and haemoconcentration ' +
      '(e.g. dengue). Serial values are useful for monitoring fluid status.',
  },
  PLT: {
    clinicalNote:
      'Platelet count assesses primary haemostasis. Low counts are seen in viral infections (e.g. dengue), ' +
      'immune thrombocytopenia, marrow failure and hypersplenism; raised counts in inflammation, iron deficiency ' +
      'and myeloproliferative disorders. A low count should be confirmed on smear to exclude platelet clumping.',
  },
  AEC: {
    clinicalNote:
      'Absolute Eosinophil Count is raised in allergic disorders (asthma, allergic rhinitis, eczema), parasitic ' +
      'infestations, drug reactions and certain skin and haematological diseases. Counts show diurnal variation ' +
      'and are lowered by corticosteroid therapy.',
  },
  BT: {
    clinicalNote:
      'Bleeding Time is a screening test of platelet function and vascular integrity. It may be prolonged in ' +
      'thrombocytopenia, platelet function defects, von Willebrand disease and with aspirin / NSAID use; aspirin ' +
      'should ideally be stopped 7 days before testing. Results depend on technique.',
  },
  CT: {
    clinicalNote:
      'Clotting Time is a crude screening test of the intrinsic coagulation pathway. It may be prolonged in severe ' +
      'factor deficiencies (e.g. haemophilia) and heparin therapy, but is insensitive to mild defects; a normal ' +
      'result does not exclude a bleeding disorder. PT and APTT are preferred for evaluation.',
  },
  MP_SMEAR: {
    clinicalNote:
      'Thick and thin peripheral smear examination is the gold standard for the diagnosis of malaria and allows ' +
      'species identification and staging. A single negative smear does not rule out malaria; repeat smears at ' +
      '6 - 12 hour intervals are advised if clinical suspicion persists. Ideally collected before antimalarials.',
  },
  MP_CARD: {
    clinicalNote:
      'Rapid malaria antigen test detects P. falciparum HRP-2 and P. vivax pLDH antigens. HRP-2 may remain ' +
      'positive for 2 - 4 weeks after successful treatment, and low parasite density may give a false negative ' +
      'result. A positive or doubtful result should be confirmed by peripheral smear examination.',
  },
  SUGAR_FASTING: {
    clinicalNote:
      'Fasting blood glucose is measured after 8 - 10 hours of fasting. 100 - 125 mg/dL indicates impaired fasting ' +
      'glucose (prediabetes); 126 mg/dL or above on two occasions is diagnostic of diabetes mellitus (ADA criteria).',
  },
  SUGAR_PP: {
    clinicalNote:
      'Post-prandial blood glucose is collected 2 hours after the start of a meal. 140 - 199 mg/dL suggests impaired ' +
      'glucose tolerance; 200 mg/dL or above is suggestive of diabetes mellitus and should be confirmed by repeat ' +
      'testing.',
  },
  SUGAR_RANDOM: {
    clinicalNote:
      'Random blood glucose is collected without regard to the time of the last meal. A value of 200 mg/dL or above ' +
      'with classic symptoms of hyperglycaemia is diagnostic of diabetes mellitus; other raised values should be ' +
      'confirmed by fasting glucose or HbA1c.',
  },
  SGOT: {
    clinicalNote:
      'SGOT (AST) is found in liver, heart, skeletal muscle and red cells, so it is less liver-specific than SGPT. ' +
      'Raised values occur in hepatitis, alcoholic liver disease, myocardial and muscle injury, and with ' +
      'haemolysis of the sample. An AST / ALT ratio above 2 suggests alcoholic liver disease.',
  },
  SGPT: {
    clinicalNote:
      'SGPT (ALT) is a liver-specific enzyme and a sensitive marker of hepatocellular injury. Raised values are ' +
      'seen in viral, drug-induced and alcoholic hepatitis and fatty liver; mild elevations may follow strenuous ' +
      'exercise or certain medications.',
  },
  ALBUMIN: {
    clinicalNote:
      'Serum albumin reflects hepatic synthetic function and nutritional status. Low values are seen in chronic ' +
      'liver disease, nephrotic syndrome, malnutrition, malabsorption and acute inflammation; raised values ' +
      'usually indicate dehydration.',
  },
  TOTAL_PROTEIN: {
    clinicalNote:
      'Total protein comprises albumin and globulins. Low values are seen in liver disease, renal protein loss, ' +
      'malnutrition and malabsorption; raised values in dehydration, chronic inflammation and multiple myeloma. ' +
      'Interpret together with serum albumin.',
  },
  SODIUM: {
    clinicalNote:
      'Serum sodium reflects water balance relative to sodium. Hyponatraemia is seen in SIADH, diuretic use, heart ' +
      'or liver failure and vomiting / diarrhoea; hypernatraemia usually indicates water loss or inadequate intake. ' +
      'Marked hyperglycaemia or hyperlipidaemia may give falsely low values.',
  },
  POTASSIUM: {
    clinicalNote:
      'Serum potassium is critical for cardiac and neuromuscular function. Haemolysis, delayed separation, fist ' +
      'clenching or a high platelet count may falsely raise potassium; an unexpectedly high value should be ' +
      'confirmed on a fresh, non-haemolysed sample.',
  },
  TRIGLYCERIDES: {
    clinicalNote:
      'Triglycerides should be measured after 9 - 12 hours of overnight fasting and avoidance of alcohol for 24 ' +
      'hours. Raised values are seen in obesity, diabetes, hypothyroidism, alcohol intake and certain drugs; values ' +
      'of 500 mg/dL or above increase the risk of acute pancreatitis.',
  },
  CHOLESTEROL: {
    clinicalNote:
      'Total cholesterol is a component of cardiovascular risk assessment and should be interpreted with HDL, LDL ' +
      'and triglycerides. Values may be raised in hypothyroidism, nephrotic syndrome, diabetes and obstructive ' +
      'liver disease, and lowered in acute illness.',
  },
  D_DIMER: {
    clinicalNote:
      'D-Dimer is a fibrin degradation product. A value below the cut-off helps exclude deep vein thrombosis and ' +
      'pulmonary embolism in patients with low or intermediate pre-test probability. Raised values are ' +
      'non-specific and occur in DIC, sepsis, malignancy, pregnancy, trauma, recent surgery and advancing age.',
  },
  LDH: {
    clinicalNote:
      'Lactate dehydrogenase is present in most body tissues and is a non-specific marker of tissue damage. Raised ' +
      'values are seen in haemolysis, megaloblastic anaemia, liver disease, myocardial and muscle injury, and ' +
      'malignancy (e.g. lymphoma). Haemolysis of the sample falsely raises LDH.',
  },
  VDRL: {
    clinicalNote:
      'VDRL is a non-treponemal screening test for syphilis. The titre reflects disease activity and is used to ' +
      'monitor response to treatment; a four-fold fall in titre indicates adequate response.',
    comment:
      'This is a screening test. A Reactive result should be confirmed by a treponemal test (e.g. TPHA). ' +
      'Biological false positives may occur in pregnancy, autoimmune disease, malaria and other infections; a ' +
      'Non-Reactive result does not exclude very early or late syphilis.',
  },
  RA_FACTOR: {
    clinicalNote:
      'Rheumatoid factor is present in about 70 - 80% of patients with rheumatoid arthritis but is not specific; ' +
      'it may also be positive in Sjogren syndrome, SLE, chronic infections, liver disease and healthy elderly ' +
      'individuals. Interpret together with Anti-CCP and clinical findings.',
  },
  ASO: {
    clinicalNote:
      'ASO titre indicates recent Group A streptococcal infection. Titres rise 1 - 3 weeks after infection and ' +
      'peak at 3 - 5 weeks; a rising titre on paired samples is more significant than a single value. Normal ' +
      'values are higher in school-age children.',
  },
  H_PYLORI: {
    clinicalNote:
      'Serum H. pylori IgG antibody indicates exposure and may remain positive long after eradication, so it is ' +
      'not suitable to confirm cure. The stool antigen test indicates active infection; proton pump inhibitors, ' +
      'antibiotics and bismuth taken in the preceding 2 - 4 weeks may cause a false negative result.',
  },
  URINE_BS: {
    clinicalNote:
      'Bile salts appear in urine in obstructive (cholestatic) jaundice and hepatocellular jaundice. A fresh urine ' +
      'sample should be tested; interpret together with urine bile pigments and serum bilirubin.',
  },
  URINE_BP: {
    clinicalNote:
      'Bile pigment (conjugated bilirubin) in urine indicates hepatocellular or obstructive jaundice; it is absent ' +
      'in haemolytic jaundice. Bilirubin is light-sensitive, so a fresh sample protected from light is required.',
  },
  SEMEN: {
    clinicalNote:
      'Reference limits are the WHO 2021 (6th edition) lower reference limits. The sample should be collected ' +
      'after 2 - 7 days of abstinence and examined within 1 hour of collection. Semen parameters vary considerably ' +
      'between samples; an abnormal result should be confirmed on a repeat sample after 2 - 3 months.',
  },
  T3: {
    clinicalNote:
      'Total T3 is affected by changes in binding proteins (pregnancy, oral contraceptives, liver disease) and is ' +
      'lowered in acute illness (sick euthyroid state). It is most useful in suspected T3 thyrotoxicosis and should ' +
      'be interpreted together with TSH.',
  },
  T4: {
    clinicalNote:
      'Total T4 is affected by changes in thyroxine-binding globulin, as in pregnancy, oral contraceptive use and ' +
      'liver disease. Interpret together with TSH; free T4 is preferred when binding protein abnormalities are ' +
      'suspected.',
  },
  TSH: {
    clinicalNote:
      'TSH is the most sensitive screening test for primary thyroid dysfunction. It shows diurnal variation, being ' +
      'highest in the early morning, and may be affected by acute illness, pregnancy (trimester-specific ranges ' +
      'apply) and drugs such as steroids, dopamine and biotin supplements.',
  },
  FT3: {
    clinicalNote:
      'Free T3 is the unbound, active form of triiodothyronine and is not affected by changes in binding proteins. ' +
      'It is useful in suspected T3 thyrotoxicosis and should be interpreted together with TSH and free T4.',
  },
  FT4: {
    clinicalNote:
      'Free T4 is the unbound form of thyroxine and reflects thyroid status more accurately than total T4. ' +
      'Interpret together with TSH; high-dose biotin supplements may interfere with immunoassay results.',
  },
  PROLACTIN: {
    clinicalNote:
      'Prolactin is secreted in pulses and rises with stress, sleep, exercise, breast stimulation and pregnancy; ' +
      'a sample taken at rest 2 - 3 hours after waking is preferred. Drugs (antipsychotics, metoclopramide), ' +
      'hypothyroidism and macroprolactin may cause raised values.',
  },
  LH: {
    clinicalNote:
      'LH varies with the menstrual cycle, peaking at ovulation; the cycle day of collection should be noted. ' +
      'Raised values are seen in primary gonadal failure and menopause, and an elevated LH / FSH ratio may be seen ' +
      'in polycystic ovary syndrome. Ranges are method-dependent.',
  },
  FSH: {
    clinicalNote:
      'FSH varies with the menstrual cycle; a day 2 - 3 sample is used to assess ovarian reserve. Raised values ' +
      'indicate primary gonadal failure or menopause; low values suggest pituitary or hypothalamic disease. ' +
      'Ranges are method-dependent.',
  },
  TESTOSTERONE: {
    clinicalNote:
      'Testosterone shows diurnal variation and is highest in the morning; a sample collected between 7 and 10 AM ' +
      'is preferred, and a low value should be confirmed on a repeat morning sample. Values decline with age in ' +
      'men. Raised values in women may indicate PCOS or an androgen-secreting tumour.',
  },
  SERUM_IRON: {
    clinicalNote:
      'Serum iron shows marked diurnal variation and is affected by recent iron intake; a fasting morning sample ' +
      'is preferred. It should be interpreted together with TIBC, transferrin saturation and ferritin.',
  },
  TOTAL_IGE: {
    clinicalNote:
      'Total IgE is raised in atopic conditions (asthma, allergic rhinitis, eczema), parasitic infestations and ' +
      'certain immunodeficiencies. A normal total IgE does not exclude allergy; specific IgE testing identifies ' +
      'the individual allergens. Values are age-dependent in children.',
  },
  PSA_TOTAL: {
    clinicalNote:
      'PSA is prostate-specific but not cancer-specific; raised values are also seen in benign prostatic ' +
      'hyperplasia, prostatitis, urinary retention and after ejaculation, cycling or prostate manipulation. ' +
      'Collect before digital rectal examination or catheterisation. Values increase with age.',
  },
  PSA_FREE: {
    clinicalNote:
      'The percentage of free PSA helps evaluate men with total PSA in the 4 - 10 ng/mL range: a lower free PSA ' +
      'percentage is associated with a higher probability of prostate cancer. Total and free PSA should be ' +
      'measured on the same sample by the same method.',
  },
  ACE: {
    clinicalNote:
      'Serum ACE is raised in active sarcoidosis and is used to monitor disease activity, but it is neither ' +
      'sensitive nor specific for diagnosis. ACE inhibitor therapy lowers the value; raised levels may also be ' +
      'seen in hyperthyroidism, liver disease and diabetes.',
  },
  ANA: {
    clinicalNote:
      'ANA by indirect immunofluorescence on HEp-2 cells is the screening test for systemic autoimmune rheumatic ' +
      'diseases such as SLE. Low-titre positives are common in healthy individuals, the elderly and with ' +
      'infections; a positive result should be followed by specific antibody (ENA / anti-dsDNA) testing.',
  },
  CA_125: {
    clinicalNote:
      'CA-125 is used mainly to monitor treatment and detect recurrence of ovarian cancer; it is not a reliable ' +
      'screening test. Raised values also occur in endometriosis, pelvic inflammatory disease, pregnancy, ' +
      'menstruation, ascites, and liver, pancreatic and lung disease.',
  },
  ANTI_CCP: {
    clinicalNote:
      'Anti-CCP antibodies are highly specific for rheumatoid arthritis, may be present years before symptoms, ' +
      'and are associated with more erosive disease. Interpret together with rheumatoid factor and clinical ' +
      'findings. Cut-off values are kit-dependent.',
  },
  E2: {
    clinicalNote:
      'Estradiol varies widely across the menstrual cycle and the cycle day of collection should be noted. It is ' +
      'used in the evaluation of ovarian function, infertility treatment monitoring and menopause. Ranges are ' +
      'method-dependent.',
  },
  HBSAG_QUANT: {
    clinicalNote:
      'Quantitative HBsAg measures the level of Hepatitis B surface antigen. Serial values help monitor the ' +
      'natural course of chronic Hepatitis B and response to antiviral (especially interferon) therapy; a falling ' +
      'level predicts HBsAg loss. Interpret together with HBeAg status and HBV DNA.',
  },
  BETA_HCG: {
    clinicalNote:
      'Serum beta hCG detects pregnancy earlier than urine tests. In early normal pregnancy the level roughly ' +
      'doubles every 48 - 72 hours; a slower rise or a fall may indicate ectopic pregnancy or miscarriage. ' +
      'Raised values are also seen in molar pregnancy and certain germ cell tumours.',
  },
  TORCH: {
    clinicalNote:
      'TORCH screening detects antibodies to Toxoplasma, Rubella, Cytomegalovirus and Herpes Simplex Virus. A ' +
      'positive IgG indicates past infection or immunity; a positive IgM may indicate recent infection but can ' +
      'persist for months or be falsely positive, so it should be confirmed by IgG avidity testing.',
  },
  TB_PLATINUM: {
    clinicalNote:
      'TB Platinum is an interferon-gamma release assay (IGRA) measuring the response to M. tuberculosis-specific ' +
      'antigens. TB Antigen minus Nil of 0.35 IU/mL or more is reported Positive; a high Nil or low Mitogen ' +
      'response gives an Indeterminate result. An IGRA cannot distinguish latent from active tuberculosis.',
  },
  MICROALBUMIN: {
    clinicalNote:
      'The urine albumin / creatinine ratio on a spot (preferably early-morning) sample is used to detect early ' +
      'diabetic and hypertensive kidney disease. Exercise, fever, urinary tract infection and heart failure may ' +
      'raise values; a raised ACR should be confirmed in 2 of 3 samples over 3 - 6 months.',
  },
  ALLERGY_PROFILE: {
    clinicalNote:
      'Specific IgE results are graded in classes (Class 0: < 0.35 kU/L; Class 1: 0.35 - 0.70; Class 2: 0.70 - ' +
      '3.50; Class 3: 3.50 - 17.5; Class 4: 17.5 - 50; Class 5: 50 - 100; Class 6: > 100). Sensitisation does ' +
      'not always mean clinical allergy; results must be correlated with the clinical history.',
  },
  ANC_PROFILE: {
    clinicalNote:
      'Routine antenatal investigations as per national ANC guidelines. Haemoglobin below 11.0 g/dL indicates ' +
      'anaemia in pregnancy. A 2-hour plasma glucose of 140 mg/dL or above after a 75 g oral glucose load is ' +
      'diagnostic of gestational diabetes. Reactive serology should be confirmed and managed as per guidelines.',
  },
  DUAL_MARKER: {
    clinicalNote:
      'First trimester screening (11 - 13 weeks 6 days) combines free beta hCG and PAPP-A, adjusted for maternal ' +
      'age, weight and gestational age, to estimate the risk of trisomy 21 and 18 / 13. This is a screening test, ' +
      'not a diagnosis; a screen-positive result should be followed by counselling and diagnostic testing.',
  },
  TRIPLE_MARKER: {
    clinicalNote:
      'Second trimester screening (15 - 20 weeks) uses AFP, hCG and unconjugated estriol to estimate the risk of ' +
      'trisomy 21, trisomy 18 and open neural tube defects (AFP of 2.5 MoM or above). Accurate gestational age is ' +
      'essential. A screen-positive result requires counselling and diagnostic testing.',
  },
  THALASSEMIA: {
    clinicalNote:
      'HbA2 above 3.5% supports beta-thalassaemia trait; raised HbF is seen in beta-thalassaemia and hereditary ' +
      'persistence of HbF. Iron deficiency can lower HbA2 and mask the trait, so iron status should be assessed. ' +
      'A Mentzer index below 13 favours thalassaemia trait over iron deficiency.',
  },
  LITHIUM: {
    clinicalNote:
      'Serum lithium should be measured 12 hours after the last dose (trough level), at least 5 days after a dose ' +
      'change. The therapeutic range is narrow; dehydration, renal impairment, diuretics, ACE inhibitors and ' +
      'NSAIDs can raise levels into the toxic range. Do not collect in lithium heparin tubes.',
  },
  COOMBS_DIRECT: {
    clinicalNote:
      'The Direct Antiglobulin Test detects antibody or complement bound to red cells in vivo. It is positive in ' +
      'autoimmune haemolytic anaemia, haemolytic disease of the newborn, haemolytic transfusion reactions and ' +
      'some drug-induced haemolysis. An EDTA sample is required.',
  },
  COOMBS_INDIRECT: {
    clinicalNote:
      'The Indirect Antiglobulin Test detects free red cell antibodies in serum. It is used in antenatal screening ' +
      '(e.g. anti-D in Rh-negative mothers) and pre-transfusion compatibility testing. A positive result in ' +
      'pregnancy needs antibody identification and serial titres.',
  },
  FOLIC_ACID: {
    clinicalNote:
      'Low serum folate may cause megaloblastic anaemia and, in pregnancy, increases the risk of neural tube ' +
      'defects. Serum folate reflects recent dietary intake; a fasting sample is preferred, and vitamin B12 status ' +
      'should be assessed at the same time.',
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
