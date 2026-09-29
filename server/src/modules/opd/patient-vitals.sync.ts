import { opdRepository } from './opd.repository';
import { ipdRepository } from '../ipd/ipd.repository';
import { OPDVitals } from './opd.types';

// A patient's vitals are one shared/latest state across OPD and IPD: a save in
// either module is written through to every OPD visit and IPD admission of that
// patient, and a new visit/admission starts from the patient's latest readings.
// OPDVitals and IPDVitals are field-for-field identical (see ipd.types.ts).

type VitalsSource = { vitals?: Partial<OPDVitals> | null; updatedAt?: Date } | null | undefined;

// Explicit shape (not a spread) — vitals may be a Mongoose subdocument.
function readVitals(vitals: Partial<OPDVitals> | null | undefined): OPDVitals | null {
  if (!vitals) return null;
  const shaped: OPDVitals = {
    weight:          vitals.weight          ?? null,
    height:          vitals.height          ?? null,
    bloodPressure:   vitals.bloodPressure   ?? null,
    sugar:           vitals.sugar           ?? null,
    bodyTemperature: vitals.bodyTemperature ?? null,
  };
  return Object.values(shaped).some((v) => v !== null) ? shaped : null;
}

// Latest recorded vitals for the patient across both modules, or null when
// none were ever recorded. Read through the decrypting models — never queried
// on the encrypted vitals content itself.
export async function findLatestPatientVitals(tenantId: string, patientId: string): Promise<OPDVitals | null> {
  const [visit, admission] = await Promise.all([
    opdRepository.findLatestByPatient(tenantId, patientId),
    ipdRepository.findLatestByPatient(tenantId, patientId),
  ]);
  const candidates = ([visit, admission] as VitalsSource[])
    .filter((c): c is NonNullable<VitalsSource> => !!c)
    .sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  for (const candidate of candidates) {
    const vitals = readVitals(candidate.vitals);
    if (vitals) return vitals;
  }
  return null;
}

export async function syncPatientVitals(tenantId: string, patientId: string, vitals: OPDVitals): Promise<void> {
  await Promise.all([
    opdRepository.setVitalsByPatient(tenantId, patientId, vitals),
    ipdRepository.setVitalsByPatient(tenantId, patientId, vitals),
  ]);
}
