import { v4 as uuidv4 } from 'uuid';
import { departmentRepository } from './department.repository';
import { IDepartment, VitalsProfile } from './department.model';
import { userRepository } from '../user/user.repository';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { ConflictError, NotFoundError, AppError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';
import { CreateDepartmentRequest, UpdateDepartmentRequest } from './department.types';

// System departments every tenant gets (seeded lazily on first department
// list — see ensureVitalsDepartments). Created with no doctors; the hospital
// assigns its own. Their vitalsProfile decides which vitals set an OPD
// visit / IPD admission in that department records.
// Descriptions are left blank. LEGACY_SEED_DESCRIPTIONS is the placeholder
// text an earlier version seeded, cleared on the next seed check.
const LEGACY_SEED_DESCRIPTIONS = ['Pediatric vitals', 'Non-Pediatric vitals'];
const VITALS_DEPARTMENT_SEEDS: { vitalsProfile: VitalsProfile; name: string }[] = [
  { vitalsProfile: 'PEDIATRIC',     name: 'Pediatric' },
  { vitalsProfile: 'NON_PEDIATRIC', name: 'Non-Pediatric' },
];

export class DepartmentService {
  // Creates the Pediatric / Non-Pediatric departments for this tenant if they
  // have never existed. Missing rows only, never overwriting: a department
  // the hospital already created under the same name is adopted (tagged with
  // the profile) instead of duplicated, and a seeded one the hospital later
  // renamed or deleted is left alone. A concurrent seed of the same profile
  // loses on the { tenantId, vitalsProfile } unique index and is ignored.
  async ensureVitalsDepartments(tenantId: string): Promise<void> {
    const claimed = new Set(await departmentRepository.findClaimedVitalsProfiles(tenantId));
    if (claimed.size > 0) {
      await departmentRepository.clearSeededVitalsDescriptions(tenantId, LEGACY_SEED_DESCRIPTIONS);
    }
    for (const seed of VITALS_DEPARTMENT_SEEDS) {
      if (claimed.has(seed.vitalsProfile)) continue;
      try {
        const sameName = await departmentRepository.findByName(tenantId, seed.name);
        if (sameName) {
          if (!sameName.vitalsProfile) {
            await departmentRepository.update(tenantId, sameName.departmentId, { vitalsProfile: seed.vitalsProfile });
          }
          continue;
        }
        await departmentRepository.save({
          departmentId:  `DEPT-${uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase()}`,
          tenantId,
          name:          seed.name,
          description:   null,
          headDoctorId:  null,
          vitalsProfile: seed.vitalsProfile,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err;
      }
    }
  }

  // The vitals profile of the department an OPD visit / IPD admission
  // belongs to — null for any other department (or none), which records the
  // Non-Pediatric layout.
  async getVitalsProfile(tenantId: string, departmentId: string | null | undefined): Promise<VitalsProfile | null> {
    if (!departmentId) return null;
    const department = await departmentRepository.findById(tenantId, departmentId);
    return department?.vitalsProfile ?? null;
  }

  // An explicitly chosen department on an OPD visit / IPD admission must be a
  // live department of this tenant.
  async assertDepartmentExists(tenantId: string, departmentId: string): Promise<void> {
    const department = await departmentRepository.findById(tenantId, departmentId);
    if (!department) throw new AppError('Department not found', 400);
  }

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
    await this.ensureVitalsDepartments(tenantId);
    return departmentRepository.findAll(tenantId);
  }

  async listDepartmentsPaginated(
    tenantId: string,
    filters:  { search?: string },
    page:     number,
    limit:    number,
  ): Promise<PaginatedResult<IDepartment>> {
    await this.ensureVitalsDepartments(tenantId);
    const search = filters.search?.trim() || undefined;
    const matchedDepartmentIds = search
      ? await userRepository.findDepartmentIdsByDoctorName(tenantId, search)
      : undefined;
    return departmentRepository.findPaginated(tenantId, { search, matchedDepartmentIds }, page, limit);
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
        if (!u.isActive) {
          throw new AppError('Cannot assign a deactivated staff member to a department', 400);
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

  // Shared "authoritative department source" algorithm for any record that
  // carries a doctor assignment (OPD visit, IPD admission, …): the department
  // is the first assigned doctor's own departmentIds[0], not the patient's —
  // patients are no longer department-scoped (see CLAUDE.md). Doctors without
  // any department are skipped in favour of the next one, matching IPD's
  // original admission-time resolution. Returns null when none of the given
  // doctors resolve to a department (e.g. no doctors assigned at all).
  //
  // Unlike IPD's admission-time doctor check, OPD never required doctorIds to
  // be real Doctor users (no validation on create/update) — so a malformed id
  // must resolve to "no department" here rather than throwing a Mongoose
  // CastError, same guard `userRepository.findNamesByIds` already applies.
  async resolveDepartmentFromDoctorIds(tenantId: string, doctorIds: string[]): Promise<string | null> {
    for (const doctorId of doctorIds) {
      if (!/^[a-fA-F0-9]{24}$/.test(doctorId)) continue;
      const doctor = await userRepository.findById(tenantId, doctorId);
      const departmentId = doctor?.departmentIds?.[0];
      if (departmentId) return departmentId;
    }
    return null;
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
