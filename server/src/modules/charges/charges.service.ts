import { v4 as uuidv4 } from 'uuid';
import { chargeRepository, ChargeListFilters } from './charges.repository';
import { ICharge, ChargeCategory, CHARGE_CATEGORIES } from './charges.model';
import { patientRepository } from '../patient/patient.repository';
import { userRepository } from '../user/user.repository';
import { notificationService } from '../notification/notification.service';
import { paymentService, ManualPaymentOptions } from '../payment/payment.service';
import { labService, LabKind } from '../lab/lab.service';
import { labRepository } from '../lab/lab.repository';
import { LAB_REFERRED_BY_SELF } from '../lab/lab.types';
import { paymentRepository } from '../payment/payment.repository';
import { PaymentReferenceType, PaymentMethod, PaymentStatus } from '../payment/payment.types';
import { auditService }  from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
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

// A LAB_TEST charge's testTypeId is `${category}:${name}` (see
// LabService.listTestTypes) — the prefix decides which Lab request it creates.
export function parseLabTestKind(testTypeId: string | null | undefined): LabKind | null {
  const prefix = testTypeId?.split(':', 1)[0];
  if (prefix === 'PATHOLOGY') return 'pathology';
  if (prefix === 'RADIOLOGY') return 'radiology';
  return null;
}

function labKindOf(charge: ICharge): LabKind | null {
  if (charge.labRequestKind === 'PATHOLOGY') return 'pathology';
  if (charge.labRequestKind === 'RADIOLOGY') return 'radiology';
  return null;
}

// A LAB_TEST charge's Payment gets the Lab receipt (test, lab request id,
// referred by) instead of the generic one, so Billing and Lab download the same
// receipt for the same payment. Other charges keep the generic receipt.
function labReceiptOptions(charge: ICharge, collectedBy: string, paymentMethod: string): ManualPaymentOptions {
  const kind = labKindOf(charge);
  if (!kind || !charge.labRequestId) return {};
  const requestId = charge.labRequestId;
  return {
    buildReceipt: ({ paymentId, paymentDate }) => labService.buildChargeLabReceipt(kind, requestId, charge.tenantId, {
      paymentId, paymentDate, amount: charge.amount, paymentMethod, collectedBy,
    }),
  };
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

    // A LAB_TEST charge also creates the matching Lab request, so the test
    // shows up in the Lab section for the Pathologist/Radiologist.
    const isLabTest = data.category === 'LAB_TEST';
    const labKind   = isLabTest ? parseLabTestKind(data.testTypeId) : null;
    if (isLabTest && (!labKind || !data.testTypeName)) {
      throw new ValidationError('Test Type must be a Pathology or Radiology test.');
    }
    const amount = Math.round(data.amount * 100) / 100;
    if (!isLabTest && amount < 0.01) throw new ValidationError('Amount must be at least ₹0.01.');
    // A free (₹0) lab test has nothing to collect — it is settled on creation.
    const isFree       = isLabTest && amount === 0;
    const labRequestId = labKind ? uuidv4() : null;

    const charge = await chargeRepository.save({
      chargeId:           generateChargeId(),
      tenantId,
      patientId:          data.patientId,
      category:           data.category,
      description:        data.description,
      amount,
      encounterReference: data.encounterReference ?? null,
      testTypeId:         isLabTest ? (data.testTypeId   ?? null) : null,
      testTypeName:       isLabTest ? (data.testTypeName ?? null) : null,
      labRequestId,
      labRequestKind:     labKind === 'pathology' ? 'PATHOLOGY' : labKind === 'radiology' ? 'RADIOLOGY' : null,
      addedBy,
      status:             isFree ? 'PAID'  : 'UNPAID',
      paidBy:             isFree ? addedBy : null,
      paidAt:             isFree ? new Date() : null,
    });

    if (labKind && labRequestId) {
      const billing = { requestId: labRequestId, chargeId: charge.chargeId };
      try {
        if (labKind === 'pathology') {
          await labService.createPathologyRequest(
            { patientId: data.patientId, testType: data.testTypeName!, referredBy: LAB_REFERRED_BY_SELF },
            tenantId, addedBy, undefined, billing,
          );
        } else {
          await labService.createRadiologyRequest(
            { patientId: data.patientId, imagingType: data.testTypeName!, referredBy: LAB_REFERRED_BY_SELF },
            tenantId, addedBy, undefined, billing,
          );
        }
      } catch (err) {
        // No charge without its Lab request: undo the (not yet audited) charge.
        try { await chargeRepository.deleteById(tenantId, charge.chargeId); } catch { /* best-effort */ }
        throw err;
      }
    }

    await auditService.log({
      entityType: AuditEntityType.CHARGE,
      entityId:   charge.chargeId,
      action:     'CREATE',
      userId:     addedBy,
      tenantId,
      newValue:   { chargeId: charge.chargeId, patientId: data.patientId, amount: charge.amount, category: data.category },
    });

    // Mirror the new charge into Payments as PENDING; markPaid / cancelCharge
    // settle it to COMPLETED / CANCELLED. A free lab test is recorded straight
    // away as a ₹0 COMPLETED payment so it has a receipt in Billing and Lab.
    // Failure must not undo the charge.
    try {
      if (isFree) {
        await paymentService.createManualPayment(
          {
            patientId:     charge.patientId,
            amount:        0,
            paymentMethod: PaymentMethod.CASH,
            description:   `Billing Charge – ${charge.description}`,
            referenceType: PaymentReferenceType.CHARGE,
            referenceId:   charge.chargeId,
          },
          tenantId,
          addedBy,
          labReceiptOptions(charge, addedBy, PaymentMethod.CASH),
        );
      } else {
        await paymentService.createPendingChargePayment(
          {
            patientId:   charge.patientId,
            amount:      charge.amount,
            description: `Billing Charge – ${charge.description}`,
            chargeId:    charge.chargeId,
          },
          tenantId,
          addedBy,
        );
      }
    } catch { /* payment record creation failure must not undo the charge */ }

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

    // Settle the charge's PENDING Payment record to CANCELLED.
    try {
      const pendingPayment = await paymentRepository.findByReference(
        tenantId, PaymentReferenceType.CHARGE, chargeId,
      );
      if (pendingPayment) {
        await paymentService.settleChargePayment(pendingPayment, PaymentStatus.CANCELLED, cancelledBy);
      }
    } catch { /* payment status sync failure must not undo the charge's CANCELLED status */ }

    // A cancelled LAB_TEST charge's Lab request will never be paid — remove it
    // from the Lab section (soft delete). It can't have a report: uploads need
    // a paid request, and only UNPAID charges reach this point.
    const labKind = labKindOf(charge);
    if (labKind && charge.labRequestId) {
      try {
        const removed = labKind === 'pathology'
          ? await labRepository.softDeletePathology(charge.labRequestId, tenantId)
          : await labRepository.softDeleteRadiology(charge.labRequestId, tenantId);
        if (removed) {
          await auditService.log({
            entityType:    labKind === 'pathology' ? AuditEntityType.PATHOLOGY_REQUEST : AuditEntityType.RADIOLOGY_REQUEST,
            entityId:      charge.labRequestId,
            action:        'DELETE',
            userId:        cancelledBy,
            tenantId,
            previousValue: { requestId: charge.labRequestId, chargeId, status: removed.status, patientId: charge.patientId },
          });
        }
      } catch { /* lab request cleanup failure must not undo the charge's CANCELLED status */ }
    }

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

    // Settle the charge's PENDING Payment record (created by addCharge) to
    // COMPLETED so it counts in Payments / Revenue / Department-wise Revenue
    // (under "Other" — CHARGE is deliberately not registered in
    // REFERENCE_DEPARTMENT_SOURCES, see payment.types.ts). Charges added
    // before the PENDING record existed have none, so one is created
    // COMPLETED instead. Failure must never undo the charge's PAID status.
    try {
      const existingPayment = await paymentRepository.findByReference(
        tenantId, PaymentReferenceType.CHARGE, chargeId,
      );
      if (existingPayment) {
        await paymentService.settleChargePayment(
          existingPayment, PaymentStatus.COMPLETED, paidBy,
          labReceiptOptions(updated!, paidBy, existingPayment.paymentMethod),
        );
      } else {
        await paymentService.createManualPayment(
          {
            patientId:     updated!.patientId,
            amount:        updated!.amount,
            paymentMethod: PaymentMethod.CASH,
            description:   `Billing Charge – ${updated!.description}`,
            referenceType: PaymentReferenceType.CHARGE,
            referenceId:   chargeId,
          },
          tenantId,
          paidBy,
          labReceiptOptions(updated!, paidBy, PaymentMethod.CASH),
        );
      }
    } catch { /* payment record creation failure must not undo the charge's PAID status */ }

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
  ): Promise<PaginatedResult<ICharge & { addedByName: string | null; paymentId: string | null; receiptAvailable: boolean }>> {
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

    // Enrich each charge with the actor's display name and, for a paid charge,
    // its COMPLETED Payment (for the Billing receipt download).
    const actorIds = [...new Set(result.data.map((c) => c.addedBy))];
    const paidIds  = result.data.filter((c) => c.status === 'PAID').map((c) => c.chargeId);
    const [names, payments] = await Promise.all([
      userRepository.findNamesByIds(tenantId, actorIds),
      paymentRepository.findCompletedByReferences(tenantId, PaymentReferenceType.CHARGE, paidIds),
    ]);
    const paymentByCharge = new Map((payments ?? []).map((p) => [p.referenceId as string, p]));
    // result.data are lean (plain) objects despite the ICharge typing.
    const data = result.data.map((c) => {
      const payment = paymentByCharge.get(c.chargeId);
      return {
        ...(c as unknown as Record<string, unknown>),
        // Auto-generated charges (e.g. package assignment) have a synthetic actor.
        addedByName:      c.addedBy === 'SYSTEM_AUTO' ? 'System' : (names.get(c.addedBy) ?? null),
        paymentId:        payment?.paymentId ?? null,
        receiptAvailable: !!payment?.receiptS3Key,
      };
    }) as unknown as (ICharge & { addedByName: string | null; paymentId: string | null; receiptAvailable: boolean })[];

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
