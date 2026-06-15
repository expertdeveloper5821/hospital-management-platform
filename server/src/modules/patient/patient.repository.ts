import { PatientModel, IPatient } from './patient.model';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class PatientRepository {
  async findByMobile(tenantId: string, mobileNumber: string): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOne({ tenantId, mobileNumber, isDeleted: { $ne: true } });
  }

  async findByPatientId(tenantId: string, patientId: string): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOne({ tenantId, patientId, isDeleted: { $ne: true } });
  }

  async findPatientIdsByDepartments(tenantId: string, departmentIds: string[]): Promise<string[]> {
    assertDbConnected();
    const patients = await PatientModel.find(
      { tenantId, departmentId: { $in: departmentIds }, isDeleted: { $ne: true } },
    ).select('patientId').lean();
    return patients.map((p) => (p as IPatient).patientId);
  }

  async findNamesByPatientIds(tenantId: string, patientIds: string[]): Promise<Map<string, string>> {
    assertDbConnected();
    const patients = await PatientModel.find(
      { tenantId, patientId: { $in: patientIds }, isDeleted: { $ne: true } },
    ).select('patientId fullName').lean();
    const map = new Map<string, string>();
    for (const p of patients) map.set(p.patientId, (p as IPatient).fullName);
    return map;
  }

  async search(
    tenantId:     string,
    q:            string | undefined,
    page:         number,
    limit:        number,
    departmentIds?: string[],
  ): Promise<PaginatedResult<IPatient>> {
    assertDbConnected();
    const skip = (page - 1) * limit;
    const safeQuery = q ? escapeRegex(q) : undefined;

    const base: Record<string, unknown> = { tenantId, isDeleted: { $ne: true } };
    if (departmentIds?.length) base['departmentId'] = { $in: departmentIds };

    const query: Record<string, unknown> = safeQuery
      ? {
          ...base,
          $or: [
            { patientId:    { $regex: safeQuery, $options: 'i' } },
            { fullName:     { $regex: safeQuery, $options: 'i' } },
            { mobileNumber: { $regex: safeQuery, $options: 'i' } },
          ],
        }
      : base;

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

  async softDelete(tenantId: string, patientId: string): Promise<IPatient | null> {
    assertDbConnected();
    return PatientModel.findOneAndUpdate(
      { tenantId, patientId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
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
