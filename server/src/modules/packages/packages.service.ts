import { v4 as uuidv4 } from 'uuid';
import { packageRepository, PackageListFilters } from './packages.repository';
import { packageAssignmentRepository } from './package-assignment.repository';
import { IPackage } from './packages.model';
import { IPackageAssignment } from './package-assignment.model';
import mongoose from 'mongoose';
import { patientRepository } from '../patient/patient.repository';
import { ipdRepository }     from '../ipd/ipd.repository';
import { auditService }  from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../../shared/middleware/error-handler';

function generatePackageId(): string {
  return 'PKG-' + uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
}

function generateAssignmentId(): string {
  return 'ASSGN-' + uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
}

export interface CreatePackageInput {
  name:             string;
  description?:     string;
  price:            number;
  includedServices: string[];
  // Mutually exclusive (enforced by the controller's Zod schema): link an
  // existing ward, or create a new one inline (Hospital Admin only).
  wardId?:          string;
  newWard?:         { name: string; floor?: string };
}

export interface UpdatePackageInput {
  name?:             string;
  description?:      string;
  price?:            number;
  includedServices?: string[];
  status?:           'ACTIVE' | 'INACTIVE';
  // null unlinks the ward; existing admissions keep their own wardId.
  wardId?:           string | null;
}

// Package as returned by the API: the stored document plus the linked
// ward's display name (null when unlinked, or the ward no longer resolves).
export type PackageView = Record<string, unknown> & { wardId: string | null; wardName: string | null };

function toPlain(pkg: IPackage): Record<string, unknown> {
  return typeof (pkg as unknown as { toObject?: unknown }).toObject === 'function'
    ? (pkg.toObject() as Record<string, unknown>)
    : (pkg as unknown as Record<string, unknown>);
}

async function withWardNames(tenantId: string, pkgs: IPackage[]): Promise<PackageView[]> {
  const names = await packageRepository.findWardNames(
    tenantId,
    pkgs.map((p) => p.wardId).filter((id): id is string => !!id),
  );
  return pkgs.map((p) => ({
    ...toPlain(p),
    wardId:   p.wardId ?? null,
    wardName: p.wardId ? (names.get(p.wardId) ?? null) : null,
  }));
}

// A linked ward must exist inside the caller's tenant. findWardById is
// tenant-scoped, so another tenant's ward id resolves to "not found".
async function assertWardInTenant(tenantId: string, wardId: string): Promise<void> {
  const ward = await ipdRepository.findWardById(tenantId, wardId);
  if (!ward) throw new NotFoundError('Ward not found');
}

export interface AssignPackageInput {
  patientId:    string;
  assignedDate?: string;
}

class PackageService {
  async createPackage(
    tenantId:    string,
    data:        CreatePackageInput,
    createdBy:   string,
    creatorRole: UserRole,
  ): Promise<PackageView> {
    // Creating a ward inline is Hospital Admin only; every package creator
    // may still link an existing ward.
    if (data.newWard && creatorRole !== UserRole.HOSPITAL_ADMIN) {
      throw new ForbiddenError('Only a Hospital Admin can create a new ward from a package.');
    }

    const normalizedName = data.name.trim().toLowerCase();
    const existing = await packageRepository.findByName(tenantId, normalizedName);
    if (existing) {
      throw new ConflictError('A package with this name already exists in this tenant.');
    }

    if (data.wardId) await assertWardInTenant(tenantId, data.wardId);

    const pkgData: Partial<IPackage> = {
      packageId:        generatePackageId(),
      tenantId,
      name:             data.name.trim(),
      description:      data.description ?? null,
      price:            data.price,
      includedServices: data.includedServices,
      status:           'ACTIVE',
      wardId:           data.wardId ?? null,
    };

    let pkg: IPackage;
    if (data.newWard) {
      // Friendly pre-check; the ward's unique index (inside the transaction)
      // is the final arbiter under a concurrent create.
      const wardName = data.newWard.name.trim();
      if (await ipdRepository.findWardByName(tenantId, wardName)) {
        throw new ConflictError(`Ward "${wardName}" already exists`);
      }
      const created = await packageRepository.saveWithNewWard(
        { tenantId, name: wardName, floor: data.newWard.floor },
        pkgData,
      );
      pkg = created.pkg;

      // Same audit shape as IPDService.createWard.
      await auditService.log({
        entityType: AuditEntityType.IPD_ADMISSION,
        entityId:   (created.ward._id as mongoose.Types.ObjectId).toString(),
        action:     'CREATE',
        userId:     createdBy,
        tenantId,
        newValue:   { name: created.ward.name, floor: created.ward.floor },
      });
    } else {
      pkg = await packageRepository.save(pkgData);
    }

    await auditService.log({
      entityType: AuditEntityType.PACKAGE,
      entityId:   pkg.packageId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { packageId: pkg.packageId, name: pkg.name, price: pkg.price, wardId: pkg.wardId ?? null },
    });

    const [view] = await withWardNames(tenantId, [pkg]);
    return view;
  }

  async updatePackage(
    tenantId:  string,
    packageId: string,
    data:      UpdatePackageInput,
    updatedBy: string,
  ): Promise<PackageView> {
    const pkg = await packageRepository.findById(tenantId, packageId);
    if (!pkg) throw new NotFoundError('Package not found');

    if (data.name !== undefined) {
      const normalizedName = data.name.trim().toLowerCase();
      const duplicate = await packageRepository.findByName(tenantId, normalizedName);
      if (duplicate && duplicate.packageId !== packageId) {
        throw new ConflictError('A package with this name already exists in this tenant.');
      }
    }

    if (data.wardId) await assertWardInTenant(tenantId, data.wardId);

    const previousValue: Record<string, unknown> = {};
    const newValue:      Record<string, unknown> = {};
    const update:        Partial<IPackage>        = {};

    if (data.name             !== undefined) { previousValue.name             = pkg.name;             newValue.name             = data.name.trim();          update.name             = data.name.trim(); }
    if (data.description      !== undefined) { previousValue.description      = pkg.description;      newValue.description      = data.description;           update.description      = data.description; }
    if (data.price            !== undefined) { previousValue.price            = pkg.price;            newValue.price            = data.price;                 update.price            = data.price; }
    if (data.includedServices !== undefined) { previousValue.includedServices = pkg.includedServices; newValue.includedServices = data.includedServices;      update.includedServices = data.includedServices; }
    if (data.status           !== undefined) { previousValue.status           = pkg.status;           newValue.status           = data.status;                update.status           = data.status; }
    if (data.wardId           !== undefined) { previousValue.wardId           = pkg.wardId ?? null;   newValue.wardId           = data.wardId;                update.wardId           = data.wardId; }

    const updated = await packageRepository.update(tenantId, packageId, update);
    if (!updated) throw new NotFoundError('Package not found');

    await auditService.log({
      entityType: AuditEntityType.PACKAGE,
      entityId:   packageId,
      action:     'UPDATE',
      userId:     updatedBy,
      tenantId,
      previousValue,
      newValue,
    });

    const [view] = await withWardNames(tenantId, [updated]);
    return view;
  }

  async getPackageById(tenantId: string, packageId: string): Promise<PackageView> {
    const pkg = await packageRepository.findById(tenantId, packageId);
    if (!pkg) throw new NotFoundError('Package not found');
    const [view] = await withWardNames(tenantId, [pkg]);
    return view;
  }

  async listPackages(
    tenantId: string,
    filters:  PackageListFilters,
  ): Promise<PaginatedResult<PackageView>> {
    const result = await packageRepository.list(tenantId, filters);
    return { ...result, data: await withWardNames(tenantId, result.data) };
  }

  async assignPackage(
    tenantId:    string,
    packageId:   string,
    data:        AssignPackageInput,
    assignedBy:  string,
  ): Promise<IPackageAssignment> {
    const pkg = await packageRepository.findById(tenantId, packageId);
    if (!pkg) throw new NotFoundError('Package not found');
    if (pkg.status === 'INACTIVE') {
      throw new ValidationError('Cannot assign an inactive package', { packageId });
    }

    const patient = await patientRepository.findByPatientId(tenantId, data.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const duplicate = await packageAssignmentRepository.findActiveAssignment(
      tenantId,
      data.patientId,
      packageId,
    );
    if (duplicate) {
      throw new ConflictError(
        `An active assignment already exists for this patient and package (${duplicate.assignmentId})`,
      );
    }

    const assignedDate = data.assignedDate
      ? new Date(data.assignedDate)
      : new Date();

    const assignment = await packageAssignmentRepository.save({
      assignmentId: generateAssignmentId(),
      tenantId,
      packageId,
      patientId:    data.patientId,
      assignedDate,
      status:       'ACTIVE',
      assignedBy,
    });

    await auditService.log({
      entityType: AuditEntityType.PACKAGE_ASSIGNMENT,
      entityId:   assignment.assignmentId,
      action:     'CREATE',
      userId:     assignedBy,
      tenantId,
      newValue:   { assignmentId: assignment.assignmentId, packageId, patientId: data.patientId },
    });

    // Auto-create charge — never roll back assignment on failure
    try {
      const { chargeService } = await import('../charges/charges.service');
      await chargeService.createPackageCharge(assignment, pkg);
    } catch (err) {
      console.warn(JSON.stringify({
        level:     'warn',
        event:     'package_charge_creation_failed',
        assignmentId: assignment.assignmentId,
        message:   (err as Error).message,
        timestamp: new Date().toISOString(),
      }));
    }

    return assignment;
  }

  async cancelAssignment(
    tenantId:     string,
    assignmentId: string,
    cancelledBy:  string,
  ): Promise<IPackageAssignment> {
    const assignment = await packageAssignmentRepository.findById(tenantId, assignmentId);
    if (!assignment) throw new NotFoundError('Assignment not found');

    if (assignment.status !== 'ACTIVE') {
      throw new ConflictError(
        `Assignment ${assignmentId} cannot be cancelled because it is already ${assignment.status}.`,
      );
    }

    const updated = await packageAssignmentRepository.update(tenantId, assignmentId, {
      status:      'CANCELLED',
      cancelledAt: new Date(),
      cancelledBy,
    });

    await auditService.log({
      entityType: AuditEntityType.PACKAGE_ASSIGNMENT,
      entityId:   assignmentId,
      action:     'UPDATE',
      userId:     cancelledBy,
      tenantId,
      previousValue: { status: 'ACTIVE' },
      newValue:      { status: 'CANCELLED', cancelledBy, cancelledAt: new Date().toISOString() },
    });

    return updated!;
  }

  async listAssignmentsByPatient(
    tenantId:  string,
    patientId: string,
  ): Promise<IPackageAssignment[]> {
    return packageAssignmentRepository.findByPatient(tenantId, patientId);
  }
}

export const packageService = new PackageService();
