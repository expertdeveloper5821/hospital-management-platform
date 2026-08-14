import { PaymentModel, IPayment } from './payment.model';
import {
  PaymentMethod, PaymentStatus, PaymentReferenceType,
  ListPaymentsQuery, PaymentSummaryQuery, PaymentSummaryResponse,
  DepartmentRevenueQuery,
} from './payment.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

// One resolved-department revenue bucket, split by `referenceType` so the
// caller can further break each department's revenue into OPD/IPD/direct.
// `departmentId: null` means the payment could not be mapped to any
// department (see sumByResolvedDepartment).
export interface ResolvedDepartmentRevenue {
  departmentId:  string | null;
  referenceType: string | null;
  total:         number;
}

export class PaymentRepository {

  async findById(paymentId: string, tenantId: string): Promise<IPayment | null> {
    assertDbConnected();
    return PaymentModel.findOne({ paymentId, tenantId });
  }

  async findByRazorpayOrderId(razorpayOrderId: string): Promise<IPayment | null> {
    assertDbConnected();
    return PaymentModel.findOne({ razorpayOrderId });
  }

  async findByFilters(
    tenantId: string,
    query: ListPaymentsQuery,
  ): Promise<PaginatedResult<IPayment>> {
    assertDbConnected();
    const filter: Record<string, unknown> = { tenantId };

    if (query.patientId)     filter['patientId']     = query.patientId;
    if (query.paymentMethod) filter['paymentMethod'] = query.paymentMethod;
    if (query.status)        filter['status']        = query.status;
    if (query.referenceType) filter['referenceType'] = query.referenceType;
    if (query.referenceId)   filter['referenceId']   = query.referenceId;

    if (query.dateFrom || query.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (query.dateFrom) dateFilter['$gte'] = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter['$lte'] = new Date(query.dateTo);
      filter['createdAt'] = dateFilter;
    }

    const skip  = (query.page - 1) * query.limit;
    const [data, total] = await Promise.all([
      PaymentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
      PaymentModel.countDocuments(filter),
    ]);

    return {
      data:       data as IPayment[],
      total,
      page:       query.page,
      limit:      query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  // Most recent COMPLETED payment of a given reference type for a patient —
  // used by OPDService.getPaymentValidity to find the payment that governs
  // the current validity window. Only COMPLETED payments count: a PENDING/
  // FAILED/CANCELLED Razorpay attempt never granted validity.
  async findLatestCompletedByPatientAndReferenceType(
    tenantId:      string,
    patientId:     string,
    referenceType: PaymentReferenceType,
  ): Promise<IPayment | null> {
    assertDbConnected();
    return PaymentModel.findOne({
      tenantId,
      patientId,
      referenceType,
      status: PaymentStatus.COMPLETED,
    }).sort({ createdAt: -1 });
  }

  // Doctor-scoped variant of findLatestCompletedByPatientAndReferenceType —
  // only a payment whose referenced OPD visit's doctorIds is a superset of
  // every requested doctorId counts (the visit may have additional doctors
  // too; that still means the patient saw all of the requested doctors on
  // it). Resolved via $lookup on the collection name (not an OPDVisit model
  // import) to avoid a payment↔opd module dependency cycle — same pattern as
  // sumByResolvedDepartment below. Used by OPDService.getPaymentValidity to
  // make OPD payment validity doctor-specific rather than patient-wide.
  async findLatestCompletedByPatientDoctorsAndReferenceType(
    tenantId:      string,
    patientId:     string,
    doctorIds:     string[],
    referenceType: PaymentReferenceType,
  ): Promise<IPayment | null> {
    assertDbConnected();
    const rows = await PaymentModel.aggregate([
      { $match: { tenantId, patientId, referenceType, status: PaymentStatus.COMPLETED } },
      {
        $lookup: {
          from: 'opd_visits',
          let:  { refId: '$referenceId' },
          pipeline: [
            { $match: { tenantId, $expr: { $eq: ['$visitId', '$$refId'] } } },
            { $project: { _id: 0, doctorIds: 1 } },
          ],
          as: 'visit',
        },
      },
      {
        $match: {
          $expr: {
            $setIsSubset: [doctorIds, { $ifNull: [{ $arrayElemAt: ['$visit.doctorIds', 0] }, []] }],
          },
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 1 },
    ]);
    return (rows[0] as IPayment) ?? null;
  }

  async save(data: Partial<IPayment>): Promise<IPayment> {
    assertDbConnected();
    return PaymentModel.create(data);
  }

  async update(
    paymentId: string,
    tenantId:  string,
    fields:    Partial<IPayment>,
  ): Promise<IPayment | null> {
    assertDbConnected();
    return PaymentModel.findOneAndUpdate(
      { paymentId, tenantId },
      { $set: fields },
      { new: true },
    );
  }

  async sumByMethod(
    tenantId: string,
    query:    PaymentSummaryQuery,
  ): Promise<PaymentSummaryResponse> {
    assertDbConnected();
    const match: Record<string, unknown> = {
      tenantId,
      status: PaymentStatus.COMPLETED,
    };

    if (query.dateFrom || query.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (query.dateFrom) dateFilter['$gte'] = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter['$lte'] = new Date(query.dateTo);
      match['createdAt'] = dateFilter;
    }

    const rows = await PaymentModel.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMethod', total: { $sum: '$amount' } } },
    ]);

    const result: PaymentSummaryResponse = { CASH: 0, CHEQUE: 0, UPI: 0, CARD: 0, total: 0 };
    for (const row of rows) {
      const method = row._id as PaymentMethod;
      if (method === 'CASH' || method === 'CHEQUE' || method === 'UPI' || method === 'CARD') {
        result[method] = row.total as number;
        result.total  += row.total as number;
      }
    }

    return result;
  }

  // Revenue grouped by the department each payment maps to, resolved via
  // `referenceType`/`referenceId`:
  //   - OPD_VISIT      → OPDVisit.departmentId (joined on visitId)
  //   - IPD_ADMISSION  → IPDAdmission.departmentId (joined on admissionId)
  //   - anything else  → Patient.departmentId (joined on patientId) — covers
  //     registration-fee payments and any other manual/Razorpay payment that
  //     carries no reference at all.
  // A payment resolves to `departmentId: null` whenever the linked record
  // (or the patient) has no department set — old data included — rather than
  // throwing, so the caller can bucket it as "other".
  async sumByResolvedDepartment(
    tenantId: string,
    query:    DepartmentRevenueQuery,
  ): Promise<ResolvedDepartmentRevenue[]> {
    assertDbConnected();
    const match: Record<string, unknown> = {
      tenantId,
      status: query.status ?? PaymentStatus.COMPLETED,
    };
    if (query.paymentMethod) match['paymentMethod'] = query.paymentMethod;

    if (query.dateFrom || query.dateTo) {
      const dateFilter: Record<string, Date> = {};
      if (query.dateFrom) dateFilter['$gte'] = new Date(query.dateFrom);
      if (query.dateTo)   dateFilter['$lte'] = new Date(query.dateTo);
      match['createdAt'] = dateFilter;
    }

    const rows = await PaymentModel.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'opd_visits',
          let:  { refId: '$referenceId' },
          pipeline: [
            { $match: { tenantId, $expr: { $eq: ['$visitId', '$$refId'] } } },
            { $project: { _id: 0, departmentId: 1 } },
          ],
          as: 'opdVisit',
        },
      },
      {
        $lookup: {
          from: 'ipd_admissions',
          let:  { refId: '$referenceId' },
          pipeline: [
            { $match: { tenantId, $expr: { $eq: ['$admissionId', '$$refId'] } } },
            { $project: { _id: 0, departmentId: 1 } },
          ],
          as: 'ipdAdmission',
        },
      },
      {
        $lookup: {
          from: 'patients',
          let:  { pid: '$patientId' },
          pipeline: [
            { $match: { tenantId, $expr: { $eq: ['$patientId', '$$pid'] } } },
            { $project: { _id: 0, departmentId: 1 } },
          ],
          as: 'patient',
        },
      },
      {
        $addFields: {
          resolvedDepartmentId: {
            $switch: {
              branches: [
                {
                  case: { $eq: ['$referenceType', PaymentReferenceType.OPD_VISIT] },
                  then: { $ifNull: [{ $arrayElemAt: ['$opdVisit.departmentId', 0] }, null] },
                },
                {
                  case: { $eq: ['$referenceType', PaymentReferenceType.IPD_ADMISSION] },
                  then: { $ifNull: [{ $arrayElemAt: ['$ipdAdmission.departmentId', 0] }, null] },
                },
              ],
              default: { $ifNull: [{ $arrayElemAt: ['$patient.departmentId', 0] }, null] },
            },
          },
        },
      },
      {
        $group: {
          _id:   { departmentId: '$resolvedDepartmentId', referenceType: '$referenceType' },
          total: { $sum: '$amount' },
        },
      },
    ]);

    return rows.map((row) => ({
      departmentId:  (row._id.departmentId as string | null) ?? null,
      referenceType: (row._id.referenceType as string | null) ?? null,
      total:         row.total as number,
    }));
  }
}

export const paymentRepository = new PaymentRepository();
