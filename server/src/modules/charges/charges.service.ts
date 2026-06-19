import { v4 as uuidv4 } from 'uuid';
import { chargeRepository, ChargeListFilters } from './charges.repository';
import { ICharge, ChargeCategory, CHARGE_CATEGORIES } from './charges.model';
import { patientRepository } from '../patient/patient.repository';
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
  SYSTEM_AUTO:                [...CHARGE_CATEGORIES],
  // Roles not in the permissions map are denied all categories
  [UserRole.SUPER_ADMIN]:     [],
  [UserRole.MANAGER]:         [],
  [UserRole.FINANCE_MANAGER]: [],
  [UserRole.HR]:              [],
  [UserRole.STAFF]:           [],
};

export interface AddChargeInput {
  patientId:           string;
  category:            ChargeCategory;
  description:         string;
  amount:              number;
  encounterReference?: string;
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

  async voidCharge(
    tenantId:      string,
    chargeId:      string,
    voidedBy:      string,
    voidedByName:  string,
    role:          ExtendedRole,
  ): Promise<ICharge> {
    const charge = await chargeRepository.findById(tenantId, chargeId);
    if (!charge) throw new NotFoundError('Charge not found');

    const voidRoles: ExtendedRole[] = [UserRole.HOSPITAL_ADMIN, UserRole.ADMIN, UserRole.RECEPTIONIST];
    if (!voidRoles.includes(role)) {
      throw new ForbiddenError('Only HOSPITAL_ADMIN, ADMIN, or RECEPTIONIST may void charges');
    }

    if (charge.status === 'VOIDED') {
      throw new ConflictError(`Charge ${chargeId} has already been voided.`);
    }

    const updated = await chargeRepository.update(tenantId, chargeId, {
      status:   'VOIDED',
      voidedBy,
      voidedAt: new Date(),
    });

    await auditService.log({
      entityType: AuditEntityType.CHARGE,
      entityId:   chargeId,
      action:     'UPDATE',
      userId:     voidedBy,
      tenantId,
      previousValue: { status: 'UNPAID' },
      newValue:      { status: 'VOIDED', voidedBy },
    });

    // Notify original adder if a different user voided the charge
    if (voidedBy !== charge.addedBy) {
      try {
        await notificationService.sendNotification(
          charge.addedBy,
          tenantId,
          'Charge Voided',
          `Charge ${chargeId} you added was voided by ${voidedByName}.`,
          'CHARGE',
          chargeId,
        );
      } catch { /* notification failure must not block void */ }
    }

    return updated!;
  }

  async getBill(tenantId: string, patientId: string): Promise<BillResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, patientId);
    if (!patient) throw new ForbiddenError('Patient not found in this tenant');

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
  ): Promise<PaginatedResult<ICharge>> {
    return chargeRepository.list(tenantId, filters);
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
