import { OPDVisitModel, IOPDVisit } from './opd.model';
import { OpdNurseAssignmentModel, IOpdNurseAssignment } from './opd-nurse-assignment.model';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { PaginatedResult } from '../../shared/types/common.types';
import { OPDVisitStatus, ACTIVE_STATUSES } from './opd.types';
import { ConflictError } from '../../shared/middleware/error-handler';
import { toIstMidnight } from '../attendance/attendance.timezone';

const DUPLICATE_APPOINTMENT_MESSAGE =
  'An appointment already exists for this patient with the selected doctor, date, and time slot.';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Upper bound on how many of a patient's visits a diagnosis search decrypts and
// scans in memory (see findByPatient). Far above any realistic single-patient
// OPD history, but keeps a pathological record from turning one request into an
// unbounded read.
const SEARCH_SCAN_LIMIT = 1000;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface OpdHistoryFilters {
  page:       number;
  limit:      number;
  startDate?: string;
  endDate?:   string;
  status?:    OPDVisitStatus;
  search?:    string;
}

export class OPDRepository {
  async findByVisitId(tenantId: string, visitId: string): Promise<IOPDVisit | null> {
    assertDbConnected();
    return OPDVisitModel.findOne({ tenantId, visitId });
  }

  async findByDate(
    tenantId:   string,
    date:       Date,
    doctorId?:  string,
    patientIds?: string[],
    nurseId?:   string,
  ): Promise<IOPDVisit[]> {
    assertDbConnected();
    // IST calendar-day bucket (not server-local midnight) — see toIstMidnight's
    // doc comment. Keeps the query in sync with how createVisit/updateVisit
    // now normalize and store visitDate, regardless of server OS timezone.
    const start = toIstMidnight(date);
    const end   = new Date(start.getTime() + MS_PER_DAY);

    const query: Record<string, unknown> = {
      tenantId,
      visitDate: { $gte: start, $lt: end },
    };
    if (doctorId)     query.doctorIds = { $in: [doctorId] };

    // Nurse-scoped OPD visibility is two independent grants, OR'd together:
    // (1) ward-based — any visit for a patient currently admitted in one of
    // the nurse's wards (patientIds; patient-level by design, see
    // IPDService.resolveNursePatientIds), and (2) direct assignment — this
    // exact visit names the nurse in its own nurseIds (visit-level, matched
    // against the visit document itself). (2) is deliberately never derived
    // from "patients this nurse has touched on some other visit" — being
    // assigned to one visit for a patient must never expose that patient's
    // other, unrelated visits. Must distinguish "no restriction" (both
    // undefined) from "restricted to nothing" (patientIds === [] and no
    // nurseId) — an empty $in correctly matches nothing, whereas skipping the
    // filter would leak every patient's visits.
    if (patientIds !== undefined || nurseId) {
      const scope: Record<string, unknown>[] = [];
      if (patientIds !== undefined) scope.push({ patientId: { $in: patientIds } });
      if (nurseId)                  scope.push({ nurseIds: nurseId });
      query.$or = scope;
    }

    // Newest-created visit first, so the OPD queue list surfaces a freshly
    // registered visit at the top rather than after same-day earlier tokens.
    return OPDVisitModel.find(query).sort({ createdAt: -1 });
  }

  async findByPatient(
    tenantId: string,
    patientId: string,
    filters: OpdHistoryFilters,
  ): Promise<PaginatedResult<IOPDVisit>> {
    assertDbConnected();
    const { page, limit, startDate, endDate, status, search } = filters;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = { tenantId, patientId };

    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter['$gte'] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter['$lte'] = end;
      }
      query['visitDate'] = dateFilter;
    }

    if (status) query['status'] = status;

    // Diagnosis is encrypted at rest (see opd.model.ts), so a $regex match
    // against the stored value can never hit — a random IV per write means the
    // same diagnosis text produces different ciphertext every time. The search
    // therefore runs in memory over the decrypted values: fetch this patient's
    // visits matching every other filter (the model's post-find hook decrypts
    // them), filter, then paginate the matches. Bounded to one patient's
    // history and capped at SEARCH_SCAN_LIMIT, so it stays a small read.
    if (search) {
      const scanned = await OPDVisitModel.find(query)
        .sort({ visitDate: -1 })
        .limit(SEARCH_SCAN_LIMIT)
        .lean();

      const re      = new RegExp(escapeRegex(search), 'i');
      const matched = (scanned as IOPDVisit[]).filter((v) => !!v.diagnosis && re.test(v.diagnosis));

      return {
        data:       matched.slice(skip, skip + limit),
        total:      matched.length,
        page,
        limit,
        totalPages: Math.ceil(matched.length / limit),
      };
    }

    const [data, total] = await Promise.all([
      OPDVisitModel.find(query).sort({ visitDate: -1 }).skip(skip).limit(limit).lean(),
      OPDVisitModel.countDocuments(query),
    ]);

    return {
      data:       data as IOPDVisit[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Active (non-cancelled) visit for the same patient + calendar date that shares
  // at least one of the given doctors — the duplicate-appointment guard.
  // excludeVisitId lets an in-progress edit exclude itself from the check.
  async findActiveDuplicate(
    tenantId:        string,
    patientId:       string,
    visitDate:       Date,
    doctorIds:       string[],
    excludeVisitId?: string,
  ): Promise<IOPDVisit | null> {
    assertDbConnected();
    if (!doctorIds.length) return null;

    const start = toIstMidnight(visitDate);
    const end   = new Date(start.getTime() + MS_PER_DAY);

    const query: Record<string, unknown> = {
      tenantId,
      patientId,
      visitDate: { $gte: start, $lt: end },
      doctorIds: { $in: doctorIds },
      status:    { $ne: OPDVisitStatus.CANCELLED },
    };
    if (excludeVisitId) query.visitId = { $ne: excludeVisitId };

    return OPDVisitModel.findOne(query);
  }

  async save(data: Partial<IOPDVisit>): Promise<IOPDVisit> {
    assertDbConnected();
    try {
      return await OPDVisitModel.create(data);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError(DUPLICATE_APPOINTMENT_MESSAGE);
      }
      throw err;
    }
  }

  async update(
    tenantId:           string,
    visitId:            string,
    data:               Partial<IOPDVisit>,
    scopedPatientIds?:  string[],
  ): Promise<IOPDVisit | null> {
    assertDbConnected();
    try {
      const filter: Record<string, unknown> = { tenantId, visitId };
      if (scopedPatientIds) filter.patientId = { $in: scopedPatientIds };
      return await OPDVisitModel.findOneAndUpdate(
        filter,
        { $set: data },
        { new: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictError(DUPLICATE_APPOINTMENT_MESSAGE);
      }
      throw err;
    }
  }

  // Sweep visits left on the queue after their visit date has passed. Bulk
  // $set (not findOneAndUpdate) so a backlog of stale days costs one round trip;
  // the { tenantId, visitDate, status } index makes the match cheap.
  async markStaleAsNoShow(tenantId: string, before: Date): Promise<number> {
    assertDbConnected();
    const result = await OPDVisitModel.updateMany(
      {
        tenantId,
        visitDate: { $lt: before },
        status:    { $in: [...ACTIVE_STATUSES] }, // spread — Mongoose rejects a readonly array
      },
      { $set: { status: OPDVisitStatus.NO_SHOW } },
    );
    return result.modifiedCount ?? 0;
  }

  // Patients this doctor has ever had an OPD visit with — one half of the
  // "assigned patients" set used to scope a Doctor's Patient/OPD/IPD/Lab access.
  async findPatientIdsByDoctor(tenantId: string, doctorId: string): Promise<string[]> {
    assertDbConnected();
    const patientIds = await OPDVisitModel.distinct('patientId', {
      tenantId,
      doctorIds: doctorId,
    });
    return patientIds as string[];
  }

  async countByDate(tenantId: string, date: Date): Promise<number> {
    assertDbConnected();
    const start = toIstMidnight(date);
    const end   = new Date(start.getTime() + MS_PER_DAY);

    return OPDVisitModel.countDocuments({
      tenantId,
      visitDate: { $gte: start, $lt: end },
    });
  }

  // ─── OPD Nurse Assignment (doctor-wise default nurses for OPD duty) ────────

  // Every nurse currently mapped to this doctor for OPD duty — a doctor can
  // have more than one.
  async findNurseAssignmentsByDoctor(tenantId: string, doctorId: string): Promise<IOpdNurseAssignment[]> {
    assertDbConnected();
    return OpdNurseAssignmentModel.find({ tenantId, doctorId });
  }

  // Atomically adds each doctor-nurse pair not already mapped. The unique
  // (tenantId, doctorId, nurseId) index makes each upsert idempotent, so
  // concurrent assignment requests — or re-submitting a nurse already on the
  // doctor's list — can never create a duplicate row for the same pair.
  //
  // A genuine race is still possible at the MongoDB level: two concurrent
  // upserts for the *exact same* (tenantId, doctorId, nurseId) can both see
  // "no matching document" before either commits, and the loser's insert then
  // hits the unique index — that's not a real conflict (the pair ends up
  // mapped either way), so a duplicate-key error here is swallowed rather
  // than surfaced as a request failure. Any other write error still throws.
  async addNurseAssignments(tenantId: string, doctorId: string, nurseIds: string[]): Promise<void> {
    assertDbConnected();
    if (!nurseIds.length) return;
    await Promise.all(
      nurseIds.map((nurseId) =>
        OpdNurseAssignmentModel.findOneAndUpdate(
          { tenantId, doctorId, nurseId },
          { $setOnInsert: { tenantId, doctorId, nurseId } },
          { upsert: true },
        ).catch((err) => {
          if ((err as { code?: number }).code === 11000) return null;
          throw err;
        }),
      ),
    );
  }
}

export const opdRepository = new OPDRepository();
