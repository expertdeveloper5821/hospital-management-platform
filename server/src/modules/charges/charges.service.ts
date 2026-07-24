import { v4 as uuidv4 } from 'uuid';
import { chargeRepository, ChargeListFilters } from './charges.repository';
import { ICharge, ChargeCategory, CHARGE_CATEGORIES } from './charges.model';
import { patientRepository } from '../patient/patient.repository';
import { userRepository } from '../user/user.repository';
import { notificationService } from '../notification/notification.service';
import { auditService }  from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '../../shared/middleware/error-handler';

// SYSTEM_AUTO role: internal bypass — not a real UserRole
type ExtendedRole = UserRole | 'SYSTEM_AUTO';

const ROLE_CATEGORY_PERMISSIONS: Record<ExtendedRole, ChargeCategory[]> = {
  [UserRole.DOCTOR]:          ['CONSULTATION', 'PROCEDURE'],
  [UserRole.NURSE]:           ['NURSING'],
  [UserRole.PATHOLOGIST]:     ['LAB_TEST'],
  [UserRole.RADIOLOGIST]:     ['LAB_TEST'],
  [UserRole.RECEPTIONIST]:    ['CONSULTATION', 'PROCEDURE', 'LAB_TEST', 'MEDICATION', 'PACKAGE', 'OTHER'],
  [UserRole.ADMIN]:           [...CHARGE_CATEGORIES],
  [UserRole.HOSPITAL_ADMIN]:  [...CHARGE_CATEGORIES],
  [UserRole.FINANCE_MANAGER]: [...CHARGE_CATEGORIES],
  SYSTEM_AUTO:                [...CHARGE_CATEGORIES],
  // Roles not in the permissions map are denied all categories
  [UserRole.SUPER_ADMIN]:     [],
  [UserRole.MANAGER]:         [],
  [UserRole.HR]:              [],
  [UserRole.STAFF]:           [],
};

export interface AddChargeInput {
  patientId:           string;
  category:            ChargeCategory;
  description:         string;
  amount:              number;
  encounterReference?: string;
  testTypeId?:         string;
  testTypeName?:       string;
}

export interface BillTotals {
  categorySubtotals: Partial<Record<ChargeCategory, number>>;
  grandTotal:        number;
}

export interface BillResponse extends BillTotals {
  patientId: string;
  lineItems: ICharge[];
}

export function computeBillTotals(charges: ICharge[]): BillTotals {
  const unpaid = charges.filter((c) => c.status === 'UNPAID');
  const categorySubtotals: Partial<Record<ChargeCategory, number>> = {};

  for (const charge of unpaid) {
    const existing = categorySubtotals[charge.category] ?? 0;
    categorySubtotals[charge.category] = Math.round((existing + charge.amount) * 100) / 100;
  }

  const grandTotal = Math.round(
    Object.values(categorySubtotals).reduce((sum, v) => sum + (v ?? 0), 0) * 100,
  ) / 100;

  return { categorySubtotals, grandTotal };
}

function generateChargeId(): string {
  return 'CHG-' + uuidv4().replace(/-/g, '').substring(0, 8).toUpperCase();
}

class ChargeService {
  async addCharge(
    tenantId: string,
    data:     AddChargeInput,
    addedBy:  string,
    role:     ExtendedRole,
  ): Promise<ICharge> {
    // Verify patient belongs to this tenant
    const patient = await patientRepository.findByPatientId(tenantId, data.patientId);
    if (!patient) throw new ForbiddenError('Patient not found in this tenant');

    // Role-category permission check
    const allowed = ROLE_CATEGORY_PERMISSIONS[role] ?? [];
    if (!allowed.includes(data.category)) {
      throw new ForbiddenError(
        `Role ${role} is not permitted to add charges in category ${data.category}`,
      );
    }

    const charge = await chargeRepository.save({
      chargeId:           generateChargeId(),
      tenantId,
      patientId:          data.patientId,
      category:           data.category,
      description:        data.description,
      amount:             Math.round(data.amount * 100) / 100,
      encounterReference: data.encounterReference ?? null,
      testTypeId:         data.category === 'LAB_TEST' ? (data.testTypeId   ?? null) : null,
      testTypeName:       data.category === 'LAB_TEST' ? (data.testTypeName ?? null) : null,
      addedBy,
      status:             'UNPAID',
    });

    await auditService.log({
      entityType: AuditEntityType.CHARGE,
      entityId:   charge.chargeId,
      action:     'CREATE',
      userId:     addedBy,
      tenantId,
      newValue:   { chargeId: charge.chargeId, patientId: data.patientId, amount: charge.amount, category: data.category },
    });

    return charge;
  }

  async cancelCharge(
    tenantId:        string,
    chargeId:        string,
    cancelledBy:     string,
    cancelledByName: string,
    role:            ExtendedRole,
  ): Promise<ICharge> {
    const charge = await chargeRepository.findById(tenantId, chargeId);
    if (!charge) throw new NotFoundError('Charge not found');

    const cancelRoles: ExtendedRole[] = [
      UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER,
    ];
    if (!cancelRoles.includes(role)) {
      throw new ForbiddenError('Only HOSPITAL_ADMIN, ADMIN, RECEPTIONIST, or FINANCE_MANAGER may cancel charges');
    }

    // Only UNPAID charges can be cancelled. Explicit checks give clear messages
    // for the common cases; the atomic write below is the real guard.
    if (charge.status === 'CANCELLED') {
      throw new ConflictError(`Charge ${chargeId} has already been cancelled.`);
    }
    if (charge.status === 'PAID') {
      throw new ConflictError(`Charge ${chargeId} is already paid and cannot be cancelled.`);
    }
    if (charge.status !== 'UNPAID') {
      throw new ConflictError(`Charge ${chargeId} cannot be cancelled from status ${charge.status}.`);
    }

    const updated = await chargeRepository.updateFromStatus(tenantId, chargeId, 'UNPAID', {
      status:      'CANCELLED',
      cancelledBy,
      cancelledAt: new Date(),
    });
    // Lost the race — another request changed the status between read and write.
    if (!updated) {
      throw new ConflictError(`Charge ${chargeId} could not be cancelled; its status changed. Please retry.`);
    }

    await auditService.log({
      entityType: AuditEntityType.CHARGE,
      entityId:   chargeId,
      action:     'UPDATE',
      userId:     cancelledBy,
      tenantId,
      previousValue: { status: 'UNPAID' },
      newValue:      { status: 'CANCELLED', cancelledBy },
    });

    // Notify original adder if a different user cancelled the charge
    if (cancelledBy !== charge.addedBy) {
      try {
        await notificationService.sendNotification(
          charge.addedBy,
          tenantId,
          'Charge Cancelled',
          `Charge ${chargeId} you added was cancelled by ${cancelledByName}.`,
          'CHARGE',
          chargeId,
        );
      } catch { /* notification failure must not block cancel */ }
    }

    return updated!;
  }

  async markPaid(
    tenantId: string,
    chargeId: string,
    paidBy:   string,
    role:     ExtendedRole,
  ): Promise<ICharge> {
    const charge = await chargeRepository.findById(tenantId, chargeId);
    if (!charge) throw new NotFoundError('Charge not found');

    const payRoles: ExtendedRole[] = [
      UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.FINANCE_MANAGER,
    ];
    if (!payRoles.includes(role)) {
      throw new ForbiddenError('Only HOSPITAL_ADMIN, ADMIN, RECEPTIONIST, or FINANCE_MANAGER may mark charges paid');
    }

    // Only UNPAID charges can be marked paid. Explicit checks give clear
    // messages for the common cases; the atomic write below is the real guard.
    if (charge.status === 'PAID') {
      throw new ConflictError(`Charge ${chargeId} is already paid.`);
    }
    if (charge.status === 'CANCELLED') {
      throw new ConflictError(`Charge ${chargeId} is cancelled and cannot be marked paid.`);
    }
    if (charge.status !== 'UNPAID') {
      throw new ConflictError(`Charge ${chargeId} cannot be marked paid from status ${charge.status}.`);
    }

    const updated = await chargeRepository.updateFromStatus(tenantId, chargeId, 'UNPAID', {
      status: 'PAID',
      paidBy,
      paidAt: new Date(),
    });
    // Lost the race — another request changed the status between read and write.
    if (!updated) {
      throw new ConflictError(`Charge ${chargeId} could not be marked paid; its status changed. Please retry.`);
    }

    await auditService.log({
      entityType: AuditEntityType.CHARGE,
      entityId:   chargeId,
      action:     'UPDATE',
      userId:     paidBy,
      tenantId,
      previousValue: { status: 'UNPAID' },
      newValue:      { status: 'PAID', paidBy },
    });

    return updated!;
  }

  async getBill(tenantId: string, patientId: string): Promise<BillResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const charges = await chargeRepository.findByPatient(tenantId, patientId);
    const { categorySubtotals, grandTotal } = computeBillTotals(charges);

    return {
      patientId,
      lineItems: charges,
      categorySubtotals,
      grandTotal,
    };
  }

  async listCharges(
    tenantId: string,
    filters:  ChargeListFilters,
  ): Promise<PaginatedResult<ICharge & { addedByName: string | null }>> {
    // Name search: resolve the typed name to the matching actor ids. No match →
    // empty result (rather than ignoring the filter).
    let repoFilters = filters;
    if (filters.addedByName && filters.addedByName.trim()) {
      const ids = await userRepository.findIdsByNameSearch(tenantId, filters.addedByName);
      if (ids.length === 0) {
        return { data: [], total: 0, page: filters.page ?? 1, limit: filters.limit ?? 20, totalPages: 0 };
      }
      repoFilters = { ...filters, addedByIds: ids };
    }

    const result = await chargeRepository.list(tenantId, repoFilters);

    // Enrich each charge with the actor's display name for the UI.
    const actorIds = [...new Set(result.data.map((c) => c.addedBy))];
    const names = await userRepository.findNamesByIds(tenantId, actorIds);
    // result.data are lean (plain) objects despite the ICharge typing.
    const data = result.data.map((c) => ({
      ...(c as unknown as Record<string, unknown>),
      // Auto-generated charges (e.g. package assignment) have a synthetic actor.
      addedByName: c.addedBy === 'SYSTEM_AUTO' ? 'System' : (names.get(c.addedBy) ?? null),
    })) as unknown as (ICharge & { addedByName: string | null })[];

    return { ...result, data };
  }

  async createPackageCharge(
    assignment: { assignmentId: string; tenantId: string; patientId: string; assignedBy: string },
    pkg:        { price: number; name: string; packageId: string },
  ): Promise<ICharge | null> {
    if (pkg.price < 0.01) {
      console.warn(JSON.stringify({
        level:        'warn',
        event:        'package_charge_skipped_zero_price',
        packageId:    pkg.packageId,
        assignmentId: assignment.assignmentId,
        timestamp:    new Date().toISOString(),
      }));
      return null;
    }

    return this.addCharge(
      assignment.tenantId,
      {
        patientId:          assignment.patientId,
        category:           'PACKAGE',
        description:        pkg.name,
        amount:             pkg.price,
        encounterReference: assignment.assignmentId,
      },
      assignment.assignedBy,
      'SYSTEM_AUTO',
    );
  }
}

export const chargeService = new ChargeService();
