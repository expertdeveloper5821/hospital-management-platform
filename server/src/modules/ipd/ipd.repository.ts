import mongoose from 'mongoose';
import { IPDAdmissionModel, IIPDAdmission } from './ipd.model';
import { ProgressNote, ListAdmissionsQuery, StatusUpdate, IPDVitals, AdmissionStatus } from './ipd.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { WardModel, IWard } from './ward.model';
import { BedModel,  IBed  } from './bed.model';
import { WardOccupancySummary } from './ipd.types';
import { AppError, ConflictError, NotFoundError } from '../../shared/middleware/error-handler';
import { IPayment } from '../payment/payment.model';
import { PaymentReferenceType } from '../payment/payment.types';
import { paymentRepository } from '../payment/payment.repository';
import { PackageModel } from '../packages/packages.model';

// Active (non-soft-deleted) ward/bed filter. `$ne: true` also matches legacy
// documents written before the isDeleted field existed.
const NOT_DELETED = { isDeleted: { $ne: true } };

// Writes the ward document inside `session` (a no-op counter bump) so any
// transaction placing an admission/bed in the ward and the ward soft-delete
// write-conflict with each other — MongoDB then aborts one, withTransaction
// retries it, and the retry sees the other's committed result. Throws 409
// when the ward has been deleted.
export async function lockActiveWard(
  tenantId: string,
  wardId:   string,
  session:  mongoose.ClientSession,
): Promise<IWard> {
  const ward = mongoose.isValidObjectId(wardId)
    ? await WardModel.findOneAndUpdate(
      { tenantId, _id: wardId, ...NOT_DELETED },
      { $inc: { lockVersion: 1 } },
      { session, new: true, timestamps: false },
    )
    : null;
  if (!ward) throw new AppError('Ward is no longer available.', 409);
  return ward;
}

// Maps a duplicate-key hit on IPDAdmission's partial unique indexes (one
// active admission per bed / per patient) to a 409; anything else unchanged.
function mapActiveAdmissionDuplicate(err: unknown): unknown {
  const mongoErr = err as { code?: number; keyValue?: Record<string, unknown> };
  if (mongoErr.code !== 11000) return err;
  if (mongoErr.keyValue && 'bedId' in mongoErr.keyValue) {
    return new AppError('Bed is currently occupied by another active admission.', 409);
  }
  if (mongoErr.keyValue && 'patientId' in mongoErr.keyValue) {
    return new ConflictError('Patient already has an active admission.');
  }
  return new ConflictError('This admission conflicts with an existing active admission.');
}

export class IPDRepository {
  async findById(admissionId: string, tenantId: string): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({ admissionId, tenantId });
  }

  // Authoritative bed conflict check — queries IPD admissions, not the Bed flag.
  async findActiveAdmissionByBed(
    bedId: string,
    tenantId: string,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({ bedId, tenantId, status: 'ADMITTED' });
  }

  async findActiveAdmissionByPatient(
    patientId: string,
    tenantId: string,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({ patientId, tenantId, status: 'ADMITTED' });
  }

  // Distinct patients with an ADMITTED (in-treatment) IPD admission assigned
  // to this doctor — the IPD half of the doctor role-change restriction's
  // active-load check (see UserService.updateUserRole). DISCHARGED admissions
  // are historical and must never block a role change. assignedDoctorIds is a
  // multikey array-field equality match; distinct() dedupes patients with
  // multiple active admissions server-side. All keys are plaintext fields —
  // no encrypted field is filtered (see encrypted-fields conventions).
  async countActivePatientsByDoctor(tenantId: string, doctorId: string): Promise<string[]> {
    assertDbConnected();
    const patientIds = await IPDAdmissionModel.distinct('patientId', {
      tenantId,
      status:            AdmissionStatus.ADMITTED,
      assignedDoctorIds: doctorId,
    });
    return patientIds as string[];
  }

  // Active (ADMITTED) admissions in the given ward(s) — the IPD half of the
  // nurse role-change restriction's active-load check (see
  // UserService.updateUserRole): a nurse rostered onto a ward with in-treatment
  // patients has live IPD duty. Each admission is one duty entry; no dedupe
  // across wards (an admission lives in exactly one ward). All keys are
  // plaintext fields — no encrypted field is filtered.
  async countActiveAdmissionsByWards(tenantId: string, wardIds: string[]): Promise<number> {
    assertDbConnected();
    if (wardIds.length === 0) return 0;
    return IPDAdmissionModel.countDocuments({
      tenantId,
      status: AdmissionStatus.ADMITTED,
      wardId: { $in: wardIds },
    });
  }

  // The patient's admission in effect at `at` (admitted on/before it and not yet
  // discharged by then). At most one can match, since a patient can only hold
  // one ADMITTED admission at a time (uniq_active_admission_per_patient).
  async findAdmissionCoveringDate(
    tenantId:  string,
    patientId: string,
    at:        Date,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOne({
      tenantId,
      patientId,
      admissionDate: { $lte: at },
      $or: [{ status: 'ADMITTED' }, { dischargeDate: { $gt: at } }],
    }).sort({ admissionDate: -1 });
  }

  // Admissions matching the Lab list's IPD filters (any status): admissionDate
  // within [start, end), ward name containing `wardName`, bed number equal to
  // `bedNumber` (both case-insensitive). Only the fields lab.service needs to
  // match requests — including legacy unlinked ones — to these admissions.
  async findForLabFilter(
    tenantId: string,
    filter:   { admissionDateRange?: { start: Date; end: Date }; wardName?: string; bedNumber?: string },
  ): Promise<Pick<IIPDAdmission, 'admissionId' | 'patientId' | 'admissionDate' | 'dischargeDate' | 'status'>[]> {
    assertDbConnected();
    const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query: Record<string, unknown> = { tenantId };
    if (filter.admissionDateRange) {
      query['admissionDate'] = { $gte: filter.admissionDateRange.start, $lt: filter.admissionDateRange.end };
    }
    if (filter.wardName)  query['wardName']  = new RegExp(escape(filter.wardName), 'i');
    if (filter.bedNumber) query['bedNumber'] = new RegExp(`^${escape(filter.bedNumber)}$`, 'i');
    return IPDAdmissionModel.find(query, { admissionId: 1, patientId: 1, admissionDate: 1, dischargeDate: 1, status: 1 }).lean();
  }

  async findByPatient(
    tenantId:  string,
    patientId: string,
    page:      number,
    limit:     number,
    status?:   'ADMITTED' | 'DISCHARGED',
  ): Promise<PaginatedResult<IIPDAdmission>> {
    assertDbConnected();
    const skip = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId, patientId };
    if (status) filter['status'] = status;

    const [data, total] = await Promise.all([
      IPDAdmissionModel.find(filter).sort({ admissionDate: -1 }).skip(skip).limit(limit).lean(),
      IPDAdmissionModel.countDocuments(filter),
    ]);

    return {
      data:       data as IIPDAdmission[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findActiveAdmissions(
    tenantId:      string,
    query:         ListAdmissionsQuery,
    patientIds?:   string[],
    nurseWardIds?: string[],
    doctorId?:     string,
  ): Promise<PaginatedResult<IIPDAdmission>> {
    assertDbConnected();
    const { wardId, status, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId, status };
    if (nurseWardIds) {
      // Nurse is restricted to their assigned ward(s) regardless of the wardId
      // query param — a wardId outside their assignment must yield zero rows.
      filter['wardId'] = wardId
        ? (nurseWardIds.includes(wardId) ? wardId : { $in: [] })
        : { $in: nurseWardIds };
    } else if (wardId) {
      filter['wardId'] = wardId;
    }
    if (doctorId && status === 'ADMITTED') {
      filter['assignedDoctorIds'] = doctorId;
    }
    if (patientIds) filter['patientId'] = { $in: patientIds };

    const [data, total] = await Promise.all([
      IPDAdmissionModel.find(filter).sort({ admissionDate: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      IPDAdmissionModel.countDocuments(filter),
    ]);

    return {
      data:       data as IIPDAdmission[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async save(data: Partial<IIPDAdmission>): Promise<IIPDAdmission> {
    assertDbConnected();
    return IPDAdmissionModel.create(data);
  }

  /**
   * Creates an admission and marks its bed occupied atomically. The two
   * partial unique indexes on IPDAdmission — one active admission per bed,
   * one active admission per patient (see ipd.model.ts) — are the actual
   * race guard under concurrent or offline-replayed creates; this
   * transaction's job is only to keep the bed flag consistent with the
   * admission write, so a mid-write failure can never leave an ADMITTED
   * admission with a stale/unoccupied bed (the previous sequential
   * save()-then-updateBedOccupancy() could, and on failure could only log
   * "CRITICAL" and 500 rather than actually recover).
   *
   * The ward (lockActiveWard) and the bed are both written inside the
   * transaction, each conditional on not being soft-deleted — the ward/bed
   * soft-delete writes the same documents, so a concurrent delete and this
   * create can never both commit (see softDeleteWardIfEmpty / softDeleteBedIfFree).
   *
   * Requires the connected MongoDB deployment to support transactions (a
   * replica set or sharded cluster — true for MongoDB Atlas and any
   * `--replSet`-enabled deployment; not true for a bare standalone mongod).
   */
  async createAdmissionWithBedOccupancy(
    admissionData: Partial<IIPDAdmission>,
    bedId: string,
  ): Promise<IIPDAdmission> {
    assertDbConnected();
    const session = await mongoose.startSession();
    try {
      let created!: IIPDAdmission;
      await session.withTransaction(async () => {
        const tenantId = admissionData.tenantId!;
        const wardId   = admissionData.wardId!;
        const ward = await lockActiveWard(tenantId, wardId, session);
        const bed  = await BedModel.findOneAndUpdate(
          { tenantId, _id: bedId, wardId, ...NOT_DELETED },
          { isOccupied: true, currentAdmissionId: admissionData.admissionId },
          { session, new: true },
        );
        if (!bed) throw new AppError('Bed is no longer available.', 409);
        // Labels re-read inside the transaction so a concurrent rename can't
        // leave a stale copy on the admission.
        const [doc] = await IPDAdmissionModel.create(
          [{ ...admissionData, wardName: ward.name, bedNumber: bed.bedNumber }],
          { session },
        );
        created = doc;
      });
      return created;
    } catch (err) {
      throw mapActiveAdmissionDuplicate(err);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Updates an ADMITTED admission while moving it to another bed and/or ward,
   * in one transaction: locks the target ward, occupies the new bed (both
   * conditional on not being soft-deleted), releases the old bed and writes
   * the admission. A concurrent ward/bed soft-delete or discharge therefore
   * either wins outright or makes this fail with a 409 — never a half-move.
   */
  async updateAdmissionWithBedMove(
    admissionId: string,
    tenantId:    string,
    move:        { fromBedId: string; toWardId: string; toBedId: string },
    fields:      Parameters<IPDRepository['updateAdmissionFields']>[2],
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    const session = await mongoose.startSession();
    try {
      let updated: IIPDAdmission | null = null;
      await session.withTransaction(async () => {
        const ward = await lockActiveWard(tenantId, move.toWardId, session);
        const bed = await BedModel.findOneAndUpdate(
          { tenantId, _id: move.toBedId, wardId: move.toWardId, ...NOT_DELETED },
          { isOccupied: true, currentAdmissionId: admissionId },
          { session, new: true },
        );
        if (!bed) throw new AppError('Bed is no longer available.', 409);
        const set = {
          ...fields,
          wardId:    move.toWardId,
          wardName:  ward.name,
          bedId:     move.toBedId,
          bedNumber: bed.bedNumber,
        };
        await BedModel.findOneAndUpdate(
          { tenantId, _id: move.fromBedId },
          { isOccupied: false, currentAdmissionId: null },
          { session },
        );
        updated = await IPDAdmissionModel.findOneAndUpdate(
          { admissionId, tenantId, status: 'ADMITTED' },
          { $set: set },
          { session, new: true },
        );
        if (!updated) throw new ConflictError('Admission is no longer active.');
      });
      return updated;
    } catch (err) {
      throw mapActiveAdmissionDuplicate(err);
    } finally {
      await session.endSession();
    }
  }

  async updateStatus(
    admissionId: string,
    tenantId: string,
    update: StatusUpdate,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOneAndUpdate(
      { admissionId, tenantId },
      { $set: update },
      { new: true },
    );
  }

  async updateAdmissionFields(
    admissionId: string,
    tenantId: string,
    fields: Partial<{
      patientId:         string;
      assignedDoctorIds: string[];
      departmentId:      string | null;
      wardId:            string;
      wardName:          string;
      bedId:             string;
      bedNumber:         string;
      vitals:            IPDVitals;
      prescription:      string | null;
    }>,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    try {
      return await IPDAdmissionModel.findOneAndUpdate(
        { admissionId, tenantId },
        { $set: fields },
        { new: true },
      );
    } catch (err) {
      // A patient correction racing another admission of the same patient
      // trips the one-active-admission-per-patient partial unique index.
      const mongoErr = err as { code?: number; keyValue?: Record<string, unknown> };
      if (mongoErr.code === 11000 && mongoErr.keyValue && 'patientId' in mongoErr.keyValue) {
        throw new ConflictError('Patient already has an active admission.');
      }
      throw err;
    }
  }

  // Permanently deletes a still-ADMITTED admission, releases its bed and
  // cancels every active payment referencing it — all in one transaction, so
  // a deleted admission never leaves an occupied bed or an active payment
  // behind (and a failed step never leaves the admission deleted). The status
  // condition is part of the delete filter, so a concurrent discharge wins.
  // Mirrors OPDRepository.deleteOpenByVisitIdCancellingPayments; same
  // replica-set requirement as createAdmissionWithBedOccupancy.
  async deleteAdmittedReleasingBedCancellingPayments(
    tenantId:    string,
    admissionId: string,
  ): Promise<{ deleted: IIPDAdmission | null; cancelledPayments: IPayment[] }> {
    assertDbConnected();
    const session = await mongoose.startSession();
    try {
      let deleted: IIPDAdmission | null = null;
      let cancelledPayments: IPayment[] = [];
      await session.withTransaction(async () => {
        deleted = await IPDAdmissionModel.findOneAndDelete(
          { tenantId, admissionId, status: 'ADMITTED' },
          { session },
        );
        if (!deleted) {
          cancelledPayments = [];
          return;
        }
        // Only release the bed if it is still held by this admission.
        await BedModel.findOneAndUpdate(
          { tenantId, _id: (deleted as IIPDAdmission).bedId, currentAdmissionId: admissionId },
          { isOccupied: false, currentAdmissionId: null },
          { session },
        );
        cancelledPayments = await paymentRepository.cancelActiveByReference(
          tenantId, PaymentReferenceType.IPD_ADMISSION, admissionId, session,
        );
      });
      return { deleted, cancelledPayments };
    } finally {
      await session.endSession();
    }
  }

  async appendProgressNote(
    admissionId: string,
    tenantId: string,
    note: ProgressNote,
  ): Promise<IIPDAdmission | null> {
    assertDbConnected();
    return IPDAdmissionModel.findOneAndUpdate(
      { admissionId, tenantId },
      { $push: { progressNotes: note } },
      { new: true },
    );
  }





  // ─── Ward ──────────────────────────────────────────────────────────────────

  async createWard(data: { tenantId: string; name: string; floor?: string }): Promise<IWard> {
    assertDbConnected();
    return WardModel.create({
      tenantId: data.tenantId,
      name:     data.name,
      floor:    data.floor ?? null,
    });
  }

  // Active (non-deleted) ward only — the lookup for anything that places an
  // admission, bed, nurse or package in a ward.
  async findWardById(tenantId: string, wardId: string): Promise<IWard | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(wardId)) return null;
    return WardModel.findOne({ tenantId, _id: wardId, ...NOT_DELETED });
  }

  // Includes soft-deleted wards — for reading history (an existing admission's
  // ward nurses, discharge summaries), never for placing anything new.
  async findWardByIdIncludingDeleted(tenantId: string, wardId: string): Promise<IWard | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(wardId)) return null;
    return WardModel.findOne({ tenantId, _id: wardId });
  }

  async findWardByName(tenantId: string, name: string): Promise<IWard | null> {
    assertDbConnected();
    return WardModel.findOne({ tenantId, name: { $regex: new RegExp(`^${name}$`, 'i') }, ...NOT_DELETED });
  }

  async listWards(tenantId: string): Promise<IWard[]> {
    assertDbConnected();
    return WardModel.find({ tenantId, ...NOT_DELETED }).sort({ name: 1 });
  }

  // Paginated variant for the Wards page. The same filter drives both the
  // page and the count, so `total` always matches what paging through returns;
  // `_id` breaks name ties so no ward is skipped or repeated across pages.
  async listWardsPaginated(
    tenantId: string,
    query:    { search?: string; page: number; limit: number },
  ): Promise<PaginatedResult<IWard>> {
    assertDbConnected();
    const { search, page, limit } = query;
    const filter: Record<string, unknown> = { tenantId, ...NOT_DELETED };
    if (search) {
      const re = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
      filter['$or'] = [{ name: re }, { floor: re }];
    }

    const [data, total] = await Promise.all([
      WardModel.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit),
      WardModel.countDocuments(filter),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async updateWardNurses(tenantId: string, wardId: string, nurseIds: string[]): Promise<IWard | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(wardId)) return null;
    return WardModel.findOneAndUpdate(
      { tenantId, _id: wardId, ...NOT_DELETED },
      { $set: { assignedNurseIds: nurseIds } },
      { new: true },
    );
  }

  // Ward(s) a given nurse is assigned to — the authoritative source for the
  // nurse ward-scoping restriction (Ward.assignedNurseIds is the source of truth).
  // Includes soft-deleted wards by default so a nurse keeps access to the
  // history of a ward that was later deleted; `activeOnly` is for "is this
  // nurse on IPD duty right now" checks.
  async findWardIdsByNurse(
    tenantId: string,
    nurseId:  string,
    opts:     { activeOnly?: boolean } = {},
  ): Promise<string[]> {
    assertDbConnected();
    const filter = { tenantId, assignedNurseIds: nurseId, ...(opts.activeOnly ? NOT_DELETED : {}) };
    const wards = await WardModel.find(filter)
      .select('_id')
      .lean();
    return wards.map((w) => (w._id as mongoose.Types.ObjectId).toString());
  }

  // Every nurse id currently on any active ward's roster, tenant-wide — the
  // authoritative "on IPD duty" set used to exclude those nurses from the OPD
  // nurse-assignment pool (a nurse can't be simultaneously offered for OPD
  // while on active IPD ward duty). A deleted ward's roster no longer counts.
  async findAssignedNurseIds(tenantId: string): Promise<string[]> {
    assertDbConnected();
    return WardModel.distinct('assignedNurseIds', { tenantId, ...NOT_DELETED });
  }

  // Patients currently admitted (ADMITTED status) in the given ward(s) — used to
  // scope Patient/OPD visibility for a nurse down to their assigned ward.
  async findPatientIdsByWards(tenantId: string, wardIds: string[]): Promise<string[]> {
    assertDbConnected();
    if (!wardIds.length) return [];
    const patientIds = await IPDAdmissionModel.distinct('patientId', {
      tenantId,
      wardId: { $in: wardIds },
      status: 'ADMITTED',
    });
    return patientIds as string[];
  }

  // Patients this doctor has ever had an IPD admission assigned to them — the
  // other half of the "assigned patients" set used to scope a Doctor's
  // Patient/OPD/IPD/Lab access. Not restricted to ADMITTED — a discharged
  // patient the doctor treated remains "their" patient for history purposes.
  async findPatientIdsByAssignedDoctor(tenantId: string, doctorId: string): Promise<string[]> {
    assertDbConnected();
    const patientIds = await IPDAdmissionModel.distinct('patientId', {
      tenantId,
      assignedDoctorIds: doctorId,
    });
    return patientIds as string[];
  }

  // ─── Bed ───────────────────────────────────────────────────────────────────

  // Locks the ward in the same transaction (lockActiveWard) so a bed can never
  // be added to a ward that a concurrent soft-delete just retired.
  async addBed(data: { tenantId: string; wardId: string; bedNumber: string }): Promise<IBed> {
    assertDbConnected();
    const session = await mongoose.startSession();
    try {
      let bed!: IBed;
      await session.withTransaction(async () => {
        await lockActiveWard(data.tenantId, data.wardId, session);
        [bed] = await BedModel.create([{
          tenantId:           data.tenantId,
          wardId:             data.wardId,
          bedNumber:          data.bedNumber,
          isOccupied:         false,
          currentAdmissionId: null,
        }], { session });
      });
      return bed;
    } finally {
      await session.endSession();
    }
  }

  async findBedByNumber(tenantId: string, wardId: string, bedNumber: string): Promise<IBed | null> {
    assertDbConnected();
    return BedModel.findOne({ tenantId, wardId, bedNumber, ...NOT_DELETED });
  }

  async findBedById(tenantId: string, bedId: string): Promise<IBed | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(bedId)) return null;
    return BedModel.findOne({ tenantId, _id: bedId, ...NOT_DELETED });
  }

  async listBedsInWard(tenantId: string, wardId: string): Promise<IBed[]> {
    assertDbConnected();
    return BedModel.find({ tenantId, wardId, ...NOT_DELETED }).sort({ bedNumber: 1 });
  }

  // ─── Ward / Bed soft delete & bed edit (Hospital Admin) ────────────────────
  // Each runs in a transaction whose FIRST operation writes the ward/bed
  // document an admission create / bed move also writes (lockActiveWard, the
  // conditional bed occupy). If one of those is in flight or commits after
  // this transaction's snapshot, MongoDB raises a WriteConflict, withTransaction
  // retries, and the retry's active-admission check sees it — so a delete can
  // never commit alongside a new admission/bed move into the same ward/bed.
  // The active-admission check queries ipd_admissions (authoritative), the
  // isOccupied flag is checked as well.

  async softDeleteWardIfEmpty(
    tenantId:  string,
    wardId:    string,
    deletedBy: string,
  ): Promise<{ ward: IWard; retiredBeds: number }> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(wardId)) throw new NotFoundError('Ward not found');
    const session = await mongoose.startSession();
    try {
      let result!: { ward: IWard; retiredBeds: number };
      await session.withTransaction(async () => {
        const deletedAt = new Date();
        const ward = await WardModel.findOneAndUpdate(
          { tenantId, _id: wardId, ...NOT_DELETED },
          { $set: { isDeleted: true, deletedAt, deletedBy }, $inc: { lockVersion: 1 } },
          { session, new: true },
        );
        if (!ward) throw new NotFoundError('Ward not found');

        const activeAdmissions = await IPDAdmissionModel.countDocuments(
          { tenantId, wardId, status: 'ADMITTED' },
        ).session(session);
        if (activeAdmissions > 0) {
          throw new ConflictError(
            `Cannot delete ward: ${activeAdmissions} patient(s) are currently admitted in it. Discharge or move them first.`,
          );
        }
        const occupiedBeds = await BedModel.countDocuments(
          { tenantId, wardId, isOccupied: true, ...NOT_DELETED },
        ).session(session);
        if (occupiedBeds > 0) {
          throw new ConflictError(`Cannot delete ward: ${occupiedBeds} bed(s) are still marked occupied.`);
        }
        const activePackages = await PackageModel.countDocuments(
          { tenantId, wardId, status: 'ACTIVE', isDeleted: { $ne: true } },
        ).session(session);
        if (activePackages > 0) {
          throw new ConflictError(
            `Cannot delete ward: ${activePackages} active package(s) are linked to it. Unlink or deactivate them first.`,
          );
        }

        const beds = await BedModel.updateMany(
          { tenantId, wardId, ...NOT_DELETED },
          { $set: { isDeleted: true, deletedAt, deletedBy } },
          { session },
        );
        result = { ward, retiredBeds: beds.modifiedCount };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  async softDeleteBedIfFree(
    tenantId:  string,
    wardId:    string,
    bedId:     string,
    deletedBy: string,
  ): Promise<IBed> {
    return this.mutateFreeBed(tenantId, wardId, bedId, 'delete', {
      $set: { isDeleted: true, deletedAt: new Date(), deletedBy },
    });
  }

  async renameBedIfFree(
    tenantId:  string,
    wardId:    string,
    bedId:     string,
    bedNumber: string,
  ): Promise<IBed> {
    try {
      return await this.mutateFreeBed(tenantId, wardId, bedId, 'edit', { $set: { bedNumber } });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError(`Bed ${bedNumber} already exists in this ward`);
      }
      throw err;
    }
  }

  // Applies `update` to an active bed of an active ward, then aborts (rolling
  // the update back) if the bed is occupied or holds an ADMITTED admission.
  private async mutateFreeBed(
    tenantId: string,
    wardId:   string,
    bedId:    string,
    action:   'edit' | 'delete',
    update:   Record<string, unknown>,
  ): Promise<IBed> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(bedId)) throw new NotFoundError('Bed not found');
    const session = await mongoose.startSession();
    try {
      let bed!: IBed;
      await session.withTransaction(async () => {
        const before = await BedModel.findOneAndUpdate(
          { tenantId, _id: bedId, wardId, ...NOT_DELETED },
          update,
          { session, new: false },
        );
        if (!before) throw new NotFoundError('Bed not found');
        const active = await IPDAdmissionModel.findOne(
          { tenantId, bedId, status: 'ADMITTED' },
        ).select('admissionId').session(session);
        if (active || before.isOccupied) {
          throw new ConflictError(
            `Cannot ${action} bed ${before.bedNumber}: it is occupied by an active admission.`,
          );
        }
        bed = (await BedModel.findOne({ tenantId, _id: bedId }).session(session))!;
      });
      return bed;
    } finally {
      await session.endSession();
    }
  }

  async updateBedOccupancy(
    tenantId:    string,
    bedId:       string,
    isOccupied:  boolean,
    admissionId: string | null,
  ): Promise<IBed | null> {
    assertDbConnected();
    return BedModel.findOneAndUpdate(
      { tenantId, _id: bedId },
      { isOccupied, currentAdmissionId: admissionId },
      { new: true },
    );
  }

  // ─── Occupancy summary (FR-08.8) ───────────────────────────────────────────

  async getOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    assertDbConnected();

    const wards = await this.listWards(tenantId);
    if (wards.length === 0) return [];

    // Aggregate bed counts grouped by wardId in one query
    const counts = await BedModel.aggregate<{
      _id:      string;
      total:    number;
      occupied: number;
    }>([
      { $match: { tenantId, ...NOT_DELETED } },
      {
        $group: {
          _id:      '$wardId',
          total:    { $sum: 1 },
          occupied: { $sum: { $cond: ['$isOccupied', 1, 0] } },
        },
      },
    ]);

    const countMap = new Map(counts.map((c) => [c._id, c]));

    return wards.map((ward) => {
      const wardId = (ward._id as mongoose.Types.ObjectId).toString();
      const c      = countMap.get(wardId);
      const total    = c?.total    ?? 0;
      const occupied = c?.occupied ?? 0;
      return {
        wardId,
        wardName:  ward.name,
        floor:     ward.floor,
        total,
        occupied,
        available: total - occupied,
      };
    });
  }
}

export const ipdRepository = new IPDRepository();
