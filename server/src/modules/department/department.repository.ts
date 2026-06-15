import { DepartmentModel, IDepartment } from './department.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class DepartmentRepository {
  async findById(tenantId: string, departmentId: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOne({ tenantId, departmentId, isDeleted: { $ne: true } });
  }

  async findByName(tenantId: string, name: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOne({
      tenantId,
      name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      isDeleted: { $ne: true },
    });
  }

  async findAll(tenantId: string): Promise<IDepartment[]> {
    assertDbConnected();
    return DepartmentModel.find({ tenantId, isDeleted: { $ne: true } }).sort({ name: 1 });
  }

  async save(data: Partial<IDepartment>): Promise<IDepartment> {
    assertDbConnected();
    return DepartmentModel.create(data);
  }

  async update(
    tenantId: string,
    departmentId: string,
    data: Partial<IDepartment>,
  ): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOneAndUpdate(
      { tenantId, departmentId, isDeleted: { $ne: true } },
      { $set: data },
      { new: true },
    );
  }

  async softDelete(tenantId: string, departmentId: string): Promise<IDepartment | null> {
    assertDbConnected();
    return DepartmentModel.findOneAndUpdate(
      { tenantId, departmentId, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, deletedAt: new Date() } },
      { new: true },
    );
  }
}

export const departmentRepository = new DepartmentRepository();
