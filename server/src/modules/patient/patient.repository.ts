import { PatientModel, IPatient } from './patient.model';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class PatientRepository {
  async findByMobile(tenantId: string, mobileNumber: string): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOne({ tenantId, mobileNumber });
  }

  async findByPatientId(tenantId: string, patientId: string): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOne({ tenantId, patientId });
  }

  async search(
    tenantId: string,
    q: string | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedResult<IPatient>> {
    assertDbConnected();
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = q
      ? {
          tenantId,
          $or: [
            { patientId:    { $regex: q, $options: 'i' } },
            { fullName:     { $regex: q, $options: 'i' } },
            { mobileNumber: q },
          ],
        }
      : { tenantId };

    const [data, total] = await Promise.all([
      PatientModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      PatientModel.countDocuments(query),
    ]);

    return {
      data:       data as IPatient[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async save(data: Partial<IPatient>): Promise<IPatient> {
    assertDbConnected();
    return PatientModel.create(data);
  }

  async update(
    tenantId: string,
    patientId: string,
    data: Partial<IPatient>,
  ): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOneAndUpdate(
      { tenantId, patientId },
      { $set: data },
      { new: true },
    );
  }
}

export const patientRepository = new PatientRepository();
