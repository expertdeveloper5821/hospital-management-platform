import { OPDVisitModel, IOPDVisit } from './opd.model';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { PaginatedResult } from '../../shared/types/common.types';
import { OPDVisitStatus } from './opd.types';

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
    tenantId: string,
    date: Date,
    doctorId?: string,
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
    if (doctorId) query.doctorId = doctorId;

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

  async save(data: Partial<IOPDVisit>): Promise<IOPDVisit> {
    assertDbConnected();
    return OPDVisitModel.create(data);
  }

  async update(
    tenantId: string,
    visitId: string,
    data: Partial<IOPDVisit>,
  ): Promise<IOPDVisit | null> {
    assertDbConnected();
    return OPDVisitModel.findOneAndUpdate(
      { tenantId, visitId },
      { $set: data },
      { new: true },
    );
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
