import { PathologyRequestModel, IPathologyRequest, IPathologyTestReport } from './lab.model';
import { RadiologyRequestModel, IRadiologyRequest } from './lab.model';
import { ListLabRequestsQuery } from './lab.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

// patientId condition shared by the list queries: a scope list (Doctor's
// assigned patients and/or search matches) intersected with an optional
// explicit ?patientId. Returns undefined when neither applies.
function patientIdCondition(patientIds: string[] | undefined, patientId: string | undefined): unknown {
  if (patientIds && patientId) return patientIds.includes(patientId) ? patientId : { $in: [] };
  if (patientIds)              return { $in: patientIds };
  if (patientId)               return patientId;
  return undefined;
}

// A Doctor also sees requests where they were picked as "Referred By", even for
// patients outside their OPD/IPD assignments. `patientIds` here is the
// search-only filter (no assignment scope) applied to the referral branch.
export interface LabReferralScope {
  doctorId:    string;
  patientIds?: string[];
}

function buildListFilter(
  tenantId:    string,
  query:       ListLabRequestsQuery,
  patientIds?: string[],
  referral?:   LabReferralScope,
  extraConds?: Record<string, unknown>[],
): Record<string, unknown> {
  const { patientId, status } = query;
  const filter: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
  const scopedCond = patientIdCondition(patientIds, patientId);
  if (referral && scopedCond !== undefined) {
    const referralCond = patientIdCondition(referral.patientIds, patientId);
    filter['$or'] = [
      { patientId: scopedCond },
      { referredBy: referral.doctorId, ...(referralCond !== undefined ? { patientId: referralCond } : {}) },
    ];
  } else if (scopedCond !== undefined) {
    filter['patientId'] = scopedCond;
  }
  if (status) filter['status'] = status;
  // Linked-encounter conditions (lab.service resolveEncounterConditions) — each
  // carries its own $or, so they're ANDed rather than merged into the filter.
  if (extraConds?.length) filter['$and'] = extraConds;
  return filter;
}

export class LabRepository {

  // ─── Pathology ─────────────────────────────────────────────────────────────

  async findPathologyById(requestId: string, tenantId: string): Promise<IPathologyRequest | null> {
    assertDbConnected();
    return PathologyRequestModel.findOne({ requestId, tenantId, isDeleted: { $ne: true } });
  }

  async findPendingPathology(tenantId: string): Promise<IPathologyRequest[]> {
    assertDbConnected();
    return PathologyRequestModel
      .find({ tenantId, status: 'PENDING', isDeleted: { $ne: true } })
      .sort({ requestedAt: 1 });
  }

  async findPathologyByPatient(
    tenantId:    string,
    query:       ListLabRequestsQuery,
    patientIds?: string[],
    referral?:   LabReferralScope,
    extraConds?: Record<string, unknown>[],
  ): Promise<PaginatedResult<IPathologyRequest>> {
    assertDbConnected();
    const { page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter = buildListFilter(tenantId, query, patientIds, referral, extraConds);

    const [data, total] = await Promise.all([
      PathologyRequestModel.find(filter).sort({ requestedAt: -1, _id: -1 }).skip(skip).limit(limit),
      PathologyRequestModel.countDocuments(filter),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async savePathology(data: Partial<IPathologyRequest>): Promise<IPathologyRequest> {
    assertDbConnected();
    return PathologyRequestModel.create(data);
  }

  async updatePathology(
    requestId:          string,
    tenantId:           string,
    update:             Partial<Pick<IPathologyRequest, 'status' | 'reportS3Key' | 'testType' | 'notes' | 'priority'>>,
    allowedPatientIds?: string[],
  ): Promise<IPathologyRequest | null> {
    assertDbConnected();
    const filter: Record<string, unknown> = { requestId, tenantId, isDeleted: { $ne: true } };
    if (allowedPatientIds) filter['patientId'] = { $in: allowedPatientIds };
    return PathologyRequestModel.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true },
    );
  }

  // Stores one test's structured report — replaces that test's existing entry
  // in place (positional $set) or appends it ($push guarded on the name being
  // absent). Each test is written on its own, so concurrent submissions for
  // different tests of the same request never overwrite one another. A fresh
  // copy is passed per attempt because the encryption plugin encrypts the
  // payload in place.
  async upsertPathologyTestReport(
    requestId: string,
    tenantId:  string,
    report:    IPathologyTestReport,
  ): Promise<IPathologyRequest | null> {
    assertDbConnected();
    const base = { requestId, tenantId, isDeleted: { $ne: true } };
    const replace = () => PathologyRequestModel.findOneAndUpdate(
      { ...base, 'testReports.testName': report.testName },
      { $set: { 'testReports.$': { ...report } } },
      { new: true },
    );
    const replaced = await replace();
    if (replaced) return replaced;
    const pushed = await PathologyRequestModel.findOneAndUpdate(
      { ...base, 'testReports.testName': { $ne: report.testName } },
      { $push: { testReports: { ...report } } },
      { new: true },
    );
    // null here means a concurrent submission added this test first (replace
    // it) or the request no longer exists (replace also returns null).
    return pushed ?? replace();
  }

  async softDeletePathology(
    requestId:          string,
    tenantId:           string,
    allowedPatientIds?: string[],
  ): Promise<IPathologyRequest | null> {
    assertDbConnected();
    const filter: Record<string, unknown> = { requestId, tenantId, isDeleted: { $ne: true } };
    if (allowedPatientIds) filter['patientId'] = { $in: allowedPatientIds };
    return PathologyRequestModel.findOneAndUpdate(
      filter,
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }

  // ─── Radiology ─────────────────────────────────────────────────────────────

  async findRadiologyById(requestId: string, tenantId: string): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    return RadiologyRequestModel.findOne({ requestId, tenantId, isDeleted: { $ne: true } });
  }

  async findPendingRadiology(tenantId: string): Promise<IRadiologyRequest[]> {
    assertDbConnected();
    return RadiologyRequestModel
      .find({ tenantId, status: 'PENDING', isDeleted: { $ne: true } })
      .sort({ requestedAt: 1 });
  }

  async findRadiologyByPatient(
    tenantId:    string,
    query:       ListLabRequestsQuery,
    patientIds?: string[],
    referral?:   LabReferralScope,
    extraConds?: Record<string, unknown>[],
  ): Promise<PaginatedResult<IRadiologyRequest>> {
    assertDbConnected();
    const { page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter = buildListFilter(tenantId, query, patientIds, referral, extraConds);

    const [data, total] = await Promise.all([
      RadiologyRequestModel.find(filter).sort({ requestedAt: -1, _id: -1 }).skip(skip).limit(limit),
      RadiologyRequestModel.countDocuments(filter),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async saveRadiology(data: Partial<IRadiologyRequest>): Promise<IRadiologyRequest> {
    assertDbConnected();
    return RadiologyRequestModel.create(data);
  }

  async updateRadiology(
    requestId:          string,
    tenantId:           string,
    update:             Partial<Pick<IRadiologyRequest, 'status' | 'reportS3Key' | 'imagingType' | 'notes' | 'priority'>>,
    allowedPatientIds?: string[],
  ): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    const filter: Record<string, unknown> = { requestId, tenantId, isDeleted: { $ne: true } };
    if (allowedPatientIds) filter['patientId'] = { $in: allowedPatientIds };
    return RadiologyRequestModel.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true },
    );
  }

  async softDeleteRadiology(
    requestId:          string,
    tenantId:           string,
    allowedPatientIds?: string[],
  ): Promise<IRadiologyRequest | null> {
    assertDbConnected();
    const filter: Record<string, unknown> = { requestId, tenantId, isDeleted: { $ne: true } };
    if (allowedPatientIds) filter['patientId'] = { $in: allowedPatientIds };
    return RadiologyRequestModel.findOneAndUpdate(
      filter,
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }

  // ─── Legacy encounter link ─────────────────────────────────────────────────
  // Requests created before opdVisitId/ipdAdmissionId were stored (both fields
  // absent — a resolved "no encounter" is stored as null), narrowed by `cond`.
  // lab.service resolves their encounter from requestedAt for the list filters.
  async findUnlinked(
    type:     'pathology' | 'radiology',
    tenantId: string,
    cond:     Record<string, unknown>,
  ): Promise<Pick<IPathologyRequest, 'requestId' | 'patientId' | 'requestedAt' | 'referredBy'>[]> {
    assertDbConnected();
    const Model = (type === 'pathology' ? PathologyRequestModel : RadiologyRequestModel) as typeof PathologyRequestModel;
    return Model.find(
      { ...cond, tenantId, isDeleted: { $ne: true }, opdVisitId: { $exists: false }, ipdAdmissionId: { $exists: false } },
      { requestId: 1, patientId: 1, requestedAt: 1, referredBy: 1 },
    ).lean();
  }

  // ─── Test types ────────────────────────────────────────────────────────────
  // Distinct testType/imagingType values already used in this tenant's requests —
  // the source of truth for the Billing "Test Type" dropdown (no separate catalog).
  async listDistinctTestTypes(tenantId: string): Promise<{ category: 'PATHOLOGY' | 'RADIOLOGY'; name: string }[]> {
    assertDbConnected();
    const [pathologyTypes, radiologyTypes] = await Promise.all([
      PathologyRequestModel.distinct('testType', { tenantId, isDeleted: { $ne: true } }),
      RadiologyRequestModel.distinct('imagingType', { tenantId, isDeleted: { $ne: true } }),
    ]);
    return [
      ...(pathologyTypes as string[]).map((name) => ({ category: 'PATHOLOGY' as const, name })),
      ...(radiologyTypes as string[]).map((name) => ({ category: 'RADIOLOGY' as const, name })),
    ];
  }
}

export const labRepository = new LabRepository();
