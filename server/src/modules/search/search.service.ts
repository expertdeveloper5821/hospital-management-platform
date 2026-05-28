import { PatientModel }      from '../patient/patient.model';
import { UserModel }         from '../user/user.model';
import { OPDVisitModel }     from '../opd/opd.model';
import { IPDAdmissionModel } from '../ipd/ipd.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../lab/lab.model';
import { SearchEntityType, SearchResult, SearchResponse } from './search.types';

const MAX_PER_ENTITY = 5;

// Escape special regex chars in user input to prevent injection
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(q: string) {
  return { $regex: escapeRegex(q), $options: 'i' };
}

// ─── Entity searchers ─────────────────────────────────────────────────────────

async function searchPatients(tenantId: string, q: string): Promise<SearchResult[]> {
  const re = buildRegex(q);
  const docs = await PatientModel
    .find({ tenantId, $or: [{ fullName: re }, { mobileNumber: re }, { patientId: re }] })
    .select('patientId fullName mobileNumber')
    .limit(MAX_PER_ENTITY)
    .lean();

  return docs.map((d) => ({
    id:         d.patientId,
    entityType: SearchEntityType.PATIENT,
    title:      d.fullName,
    subtitle:   d.mobileNumber,
    href:       `/patients/${d.patientId}`,
  }));
}

async function searchUsers(tenantId: string, q: string): Promise<SearchResult[]> {
  const re = buildRegex(q);
  const docs = await UserModel
    .find({ tenantId, isActive: true, $or: [{ name: re }, { email: re }] })
    .select('_id name email role')
    .limit(MAX_PER_ENTITY)
    .lean();

  return docs.map((d) => ({
    id:         String(d._id),
    entityType: SearchEntityType.USER,
    title:      d.name,
    subtitle:   `${d.email} · ${d.role}`,
    href:       `/admin`,
  }));
}

async function searchOpdVisits(tenantId: string, q: string): Promise<SearchResult[]> {
  const re = buildRegex(q);
  const docs = await OPDVisitModel
    .find({ tenantId, $or: [{ visitId: re }, { patientId: re }, { chiefComplaint: re }] })
    .select('visitId patientId chiefComplaint status visitDate')
    .limit(MAX_PER_ENTITY)
    .lean();

  return docs.map((d) => ({
    id:         d.visitId,
    entityType: SearchEntityType.OPD_VISIT,
    title:      `OPD ${d.visitId}`,
    subtitle:   `${d.chiefComplaint} · ${d.status}`,
    href:       `/opd/${d.visitId}`,
  }));
}

async function searchIpdAdmissions(tenantId: string, q: string): Promise<SearchResult[]> {
  const re = buildRegex(q);
  const docs = await IPDAdmissionModel
    .find({ tenantId, $or: [{ admissionId: re }, { patientId: re }, { wardName: re }] })
    .select('admissionId patientId wardName bedNumber status')
    .limit(MAX_PER_ENTITY)
    .lean();

  return docs.map((d) => ({
    id:         d.admissionId,
    entityType: SearchEntityType.IPD,
    title:      `IPD ${d.admissionId}`,
    subtitle:   `${d.wardName} · Bed ${d.bedNumber} · ${d.status}`,
    href:       `/ipd/${d.admissionId}`,
  }));
}

async function searchLabRequests(tenantId: string, q: string): Promise<SearchResult[]> {
  const re = buildRegex(q);

  const pathDocs  = await PathologyRequestModel
    .find({ tenantId, $or: [{ requestId: re }, { patientId: re }, { testType: re }] })
    .select('requestId patientId testType status')
    .limit(MAX_PER_ENTITY)
    .lean();

  const radioDocs = await RadiologyRequestModel
    .find({ tenantId, $or: [{ requestId: re }, { patientId: re }, { imagingType: re }] })
    .select('requestId patientId imagingType status')
    .limit(MAX_PER_ENTITY)
    .lean();

  const pathResults: SearchResult[] = pathDocs.map((d) => ({
    id:         d.requestId,
    entityType: SearchEntityType.LAB_REQUEST,
    title:      `Pathology ${d.requestId}`,
    subtitle:   `${d.testType} · ${d.status}`,
    href:       `/lab/pathology/${d.requestId}`,
  }));

  const radioResults: SearchResult[] = radioDocs.map((d) => ({
    id:         d.requestId,
    entityType: SearchEntityType.LAB_REQUEST,
    title:      `Radiology ${d.requestId}`,
    subtitle:   `${d.imagingType} · ${d.status}`,
    href:       `/lab/radiology/${d.requestId}`,
  }));

  return [...pathResults, ...radioResults].slice(0, MAX_PER_ENTITY);
}

// ─── SearchService ────────────────────────────────────────────────────────────

export class SearchService {
  async search(
    tenantId: string,
    q: string,
    type?: string,
  ): Promise<SearchResponse> {
    const trimmed = q.trim();

    const searches: Record<string, () => Promise<SearchResult[]>> = {
      [SearchEntityType.PATIENT]:     () => searchPatients(tenantId, trimmed),
      [SearchEntityType.USER]:        () => searchUsers(tenantId, trimmed),
      [SearchEntityType.OPD_VISIT]:   () => searchOpdVisits(tenantId, trimmed),
      [SearchEntityType.IPD]:         () => searchIpdAdmissions(tenantId, trimmed),
      [SearchEntityType.LAB_REQUEST]: () => searchLabRequests(tenantId, trimmed),
    };

    const activeKeys = type && searches[type]
      ? [type]
      : Object.keys(searches);

    const resultArrays = await Promise.all(activeKeys.map((k) => searches[k]()));
    const results      = resultArrays.flat();

    return { query: trimmed, results, total: results.length };
  }
}
