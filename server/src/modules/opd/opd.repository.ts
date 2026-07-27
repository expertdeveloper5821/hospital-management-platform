import { OPDVisitModel, IOPDVisit } from './opd.model';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { PaginatedResult } from '../../shared/types/common.types';
import { OPDVisitStatus } from './opd.types';
import { ConflictError } from '../../shared/middleware/error-handler';

const DUPLICATE_APPOINTMENT_MESSAGE =
  'An appointment already exists for this patient with the selected doctor, date, and time slot.';

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
  ): Promise<IOPDVisit[]> {
    assertDbConnected();
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const query: Record<string, unknown> = {
      tenantId,
      visitDate: { $gte: start, $lte: end },
    };
    if (doctorId)     query.doctorIds = { $in: [doctorId] };
    // Must distinguish "no restriction" (undefined) from "restricted to zero
    // patients" (empty array, e.g. a nurse with no ward assignment) — an empty
    // $in correctly matches nothing, whereas skipping the filter would leak
    // every patient's visits.
    if (patientIds)   query.patientId = { $in: patientIds };

    return OPDVisitModel.find(query).sort({ queueNumber: 1 });
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

    if (search) {
      const safe = escapeRegex(search);
      query['$or'] = [
        { chiefComplaint: { $regex: safe, $options: 'i' } },
        { diagnosis:      { $regex: safe, $options: 'i' } },
      ];
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

    const start = new Date(visitDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(visitDate);
    end.setHours(23, 59, 59, 999);

    const query: Record<string, unknown> = {
      tenantId,
      patientId,
      visitDate: { $gte: start, $lte: end },
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
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return OPDVisitModel.countDocuments({
      tenantId,
      visitDate: { $gte: start, $lte: end },
    });
  }
}

export const opdRepository = new OPDRepository();
