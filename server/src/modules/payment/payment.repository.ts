import { PaymentModel, IPayment } from './payment.model';
import { PaymentMethod, PaymentStatus, ListPaymentsQuery, PaymentSummaryQuery, PaymentSummaryResponse } from './payment.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

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

    if (query.paymentMethod) filter['paymentMethod'] = query.paymentMethod;

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
}

export const paymentRepository = new PaymentRepository();
