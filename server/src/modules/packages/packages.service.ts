import { v4 as uuidv4 } from 'uuid';
import { packageRepository, PackageListFilters } from './packages.repository';
import { packageAssignmentRepository } from './package-assignment.repository';
import { IPackage } from './packages.model';
import { IPackageAssignment } from './package-assignment.model';
import { patientRepository } from '../patient/patient.repository';
import { auditService }  from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import {
  NotFoundError,
  ConflictError,
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
}

export interface UpdatePackageInput {
  name?:             string;
  description?:      string;
  price?:            number;
  includedServices?: string[];
  status?:           'ACTIVE' | 'INACTIVE';
}

export interface AssignPackageInput {
  patientId:    string;
  assignedDate?: string;
}

class PackageService {
  async createPackage(
    tenantId:  string,
    data:      CreatePackageInput,
    createdBy: string,
  ): Promise<IPackage> {
    const normalizedName = data.name.trim().toLowerCase();
    const existing = await packageRepository.findByName(tenantId, normalizedName);
    if (existing) {
      throw new ConflictError('A package with this name already exists in this tenant.');
    }

    const pkg = await packageRepository.save({
      packageId:        generatePackageId(),
      tenantId,
      name:             data.name.trim(),
      description:      data.description ?? null,
      price:            data.price,
      includedServices: data.includedServices,
      status:           'ACTIVE',
    });

    await auditService.log({
      entityType: AuditEntityType.PACKAGE,
      entityId:   pkg.packageId,
      action:     'CREATE',
      userId:     createdBy,
      tenantId,
      newValue:   { packageId: pkg.packageId, name: pkg.name, price: pkg.price },
    });

    return pkg;
  }

  async updatePackage(
    tenantId:  string,
    packageId: string,
    data:      UpdatePackageInput,
    updatedBy: string,
  ): Promise<IPackage> {
    const pkg = await packageRepository.findById(tenantId, packageId);
    if (!pkg) throw new NotFoundError('Package not found');

    if (data.name !== undefined) {
      const normalizedName = data.name.trim().toLowerCase();
      const duplicate = await packageRepository.findByName(tenantId, normalizedName);
      if (duplicate && duplicate.packageId !== packageId) {
        throw new ConflictError('A package with this name already exists in this tenant.');
      }
    }

    const previousValue: Record<string, unknown> = {};
    const newValue:      Record<string, unknown> = {};
    const update:        Partial<IPackage>        = {};

    if (data.name             !== undefined) { previousValue.name             = pkg.name;             newValue.name             = data.name.trim();          update.name             = data.name.trim(); }
    if (data.description      !== undefined) { previousValue.description      = pkg.description;      newValue.description      = data.description;           update.description      = data.description; }
    if (data.price            !== undefined) { previousValue.price            = pkg.price;            newValue.price            = data.price;                 update.price            = data.price; }
    if (data.includedServices !== undefined) { previousValue.includedServices = pkg.includedServices; newValue.includedServices = data.includedServices;      update.includedServices = data.includedServices; }
    if (data.status           !== undefined) { previousValue.status           = pkg.status;           newValue.status           = data.status;                update.status           = data.status; }

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

    return updated;
  }

  async getPackageById(tenantId: string, packageId: string): Promise<IPackage> {
    const pkg = await packageRepository.findById(tenantId, packageId);
    if (!pkg) throw new NotFoundError('Package not found');
    return pkg;
  }

  async listPackages(
    tenantId: string,
    filters:  PackageListFilters,
  ): Promise<PaginatedResult<IPackage>> {
    return packageRepository.list(tenantId, filters);
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
