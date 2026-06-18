import { v4 as uuidv4 } from 'uuid';
import { departmentRepository } from './department.repository';
import { IDepartment } from './department.model';
import { userRepository } from '../user/user.repository';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import { ConflictError, NotFoundError, AppError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';
import { CreateDepartmentRequest, UpdateDepartmentRequest } from './department.types';

export class DepartmentService {
  async createDepartment(
    tenantId:  string,
    data:      CreateDepartmentRequest,
    createdBy: string,
  ): Promise<IDepartment> {
    const existing = await departmentRepository.findByName(tenantId, data.name);
    if (existing) throw new ConflictError(`Department "${data.name}" already exists`);

    if (data.headDoctorId) {
      const doctor = await userRepository.findById(tenantId, data.headDoctorId);
      if (!doctor || doctor.role !== UserRole.DOCTOR) {
        throw new AppError('Head doctor must be a user with the DOCTOR role', 400);
      }
    }

    const department = await departmentRepository.save({
      departmentId:  `DEPT-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
      tenantId,
      name:          data.name,
      description:   data.description ?? null,
      headDoctorId:  data.headDoctorId ?? null,
    });

    await auditService.log({
      entityType: AuditEntityType.DEPARTMENT,
      entityId:   department.departmentId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { name: data.name },
    });

    return department;
  }

  async updateDepartment(
    tenantId:     string,
    departmentId: string,
    data:         UpdateDepartmentRequest,
    updatedBy:    string,
  ): Promise<IDepartment> {
    const department = await departmentRepository.findById(tenantId, departmentId);
    if (!department) throw new NotFoundError('Department not found');

    if (data.name && data.name !== department.name) {
      const nameConflict = await departmentRepository.findByName(tenantId, data.name);
      if (nameConflict) throw new ConflictError(`Department "${data.name}" already exists`);
    }

    if (data.headDoctorId !== undefined && data.headDoctorId !== null) {
      const doctor = await userRepository.findById(tenantId, data.headDoctorId);
      if (!doctor || doctor.role !== UserRole.DOCTOR) {
        throw new AppError('Head doctor must be a user with the DOCTOR role', 400);
      }
    }

    const updateData: Partial<IDepartment> = {};
    const previousValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};

    if (data.name !== undefined)         { previousValue.name = department.name; newValue.name = data.name; updateData.name = data.name; }
    if (data.description !== undefined)  { updateData.description = data.description ?? null; }
    if (data.headDoctorId !== undefined) { updateData.headDoctorId = data.headDoctorId; }

    const updated = await departmentRepository.update(tenantId, departmentId, updateData);
    if (!updated) throw new NotFoundError('Department not found');

    if (Object.keys(newValue).length > 0) {
      await auditService.log({
        entityType: AuditEntityType.DEPARTMENT,
        entityId:   departmentId,
        action:     'UPDATE',
        userId:     updatedBy,
        tenantId,
        previousValue,
        newValue,
      });
    }

    return updated;
  }

  async listDepartments(tenantId: string): Promise<IDepartment[]> {
    return departmentRepository.findAll(tenantId);
  }

  async getDepartmentById(tenantId: string, departmentId: string): Promise<IDepartment> {
    const department = await departmentRepository.findById(tenantId, departmentId);
    if (!department) throw new NotFoundError('Department not found');
    return department;
  }

  async updateDoctorAssignments(
    tenantId:     string,
    departmentId: string,
    { add = [], remove = [] }: { add?: string[]; remove?: string[] },
    updatedBy:    string,
  ): Promise<void> {
    const department = await departmentRepository.findById(tenantId, departmentId);
    if (!department) throw new NotFoundError('Department not found');

    const CLINICAL_ROLES = [UserRole.DOCTOR, UserRole.NURSE, UserRole.PATHOLOGIST, UserRole.RADIOLOGIST];

    if (add.length > 0) {
      const users = await Promise.all(add.map((uid) => userRepository.findById(tenantId, uid)));
      for (const u of users) {
        if (!u) throw new AppError('One or more users not found', 404);
        if (!(CLINICAL_ROLES as UserRole[]).includes(u.role)) {
          throw new AppError('Only clinical staff can be assigned to departments', 400);
        }
      }
      await userRepository.addDepartmentToUsers(tenantId, add, departmentId);
    }

    if (remove.length > 0) {
      await userRepository.removeDepartmentFromUsers(tenantId, remove, departmentId);
    }

    await auditService.log({
      entityType:    AuditEntityType.DEPARTMENT,
      entityId:      departmentId,
      action:        'UPDATE',
      userId:        updatedBy,
      tenantId,
      previousValue: { removedDoctors: remove },
      newValue:      { addedDoctors: add },
    });
  }

  async deleteDepartment(
    tenantId:     string,
    departmentId: string,
    deletedBy:    string,
  ): Promise<void> {
    const department = await departmentRepository.findById(tenantId, departmentId);
    if (!department) throw new NotFoundError('Department not found');

    await departmentRepository.softDelete(tenantId, departmentId);

    await auditService.log({
      entityType:    AuditEntityType.DEPARTMENT,
      entityId:      departmentId,
      action:        'DELETE',
      userId:        deletedBy,
      tenantId,
      previousValue: { name: department.name },
    });
  }
}

export const departmentService = new DepartmentService();
