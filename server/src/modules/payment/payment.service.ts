import crypto   from 'crypto';
import Razorpay from 'razorpay';
import { v4 as uuidv4 } from 'uuid';

import { paymentRepository }  from './payment.repository';
import { IPayment }            from './payment.model';
import {
  PaymentMethod,
  PaymentStatus,
  PaymentReferenceType,
  CreateManualPaymentInput,
  CreateRazorpayOrderInput,
  ListPaymentsQuery,
  PaymentSummaryQuery,
  PaymentResponse,
  RazorpayOrderResponse,
  PaymentSummaryResponse,
  DepartmentRevenueQuery,
  DepartmentRevenueResponse,
  DepartmentRevenueEntry,
  DepartmentRevenueBreakdown,
  LAB_PAYMENT_REFERENCE_TYPES,
} from './payment.types';

import { patientRepository }    from '../patient/patient.repository';
import { labRepository }        from '../lab/lab.repository';
import { tenantRepository }     from '../tenant/tenant.repository';
import { departmentRepository } from '../department/department.repository';
import { userRepository }       from '../user/user.repository';
import { IPatient }             from '../patient/patient.model';
import { pdfService }        from '../../shared/services/pdf.service';
import { resolveReceiptHospitalDetails, resolvePatientAge, resolvePatientAgeUnit, generateInvoiceNumber } from '../../shared/utils/receipt-details';
import { s3Service }         from '../../shared/services/s3.service';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { AppError, NotFoundError, ConflictError } from '../../shared/middleware/error-handler';
import config from '../../shared/config/env';

// Pre-signed URL expiry: 1 hour
const RECEIPT_URL_EXPIRY_SECONDS = 3600;

// Lets a caller (e.g. Lab payment collection) supply its own receipt PDF in
// place of the generic one. Omitted → the existing generic receipt, unchanged.
export interface ManualPaymentOptions {
  buildReceipt?: (ctx: { paymentId: string; paymentDate: Date }) => Promise<Buffer>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveReceiptUrl(s3Key: string | null): Promise<string | null> {
  if (!s3Key) return null;
  // A presign failure (e.g. transient S3 issue) must not break payment creation/listing —
  // the receipt link is secondary to the payment record itself.
  return s3Service.getPresignedUrl(s3Key, RECEIPT_URL_EXPIRY_SECONDS).catch(() => null);
}

// Generic A5 receipt for every non-Lab payment (manual, Billing charge,
// Razorpay). Hospital letterhead comes from the payment's own tenant and the
// patient block from its patient record — never from the client.
// receiptKind='billing' → BILLING RECEIPT title; 'payment' → PAYMENT RECEIPT.
async function buildPaymentReceipt(input: {
  tenantId:      string;
  paymentId:     string;
  paymentDate:   Date;
  patient:       IPatient;
  amount:        number;
  paymentMethod: string;
  description:   string;
  transactionId: string | null;
  createdBy:     string;
  receiptKind?:  'billing' | 'payment';
}): Promise<Buffer> {
  const [tenant, creator] = await Promise.all([
    tenantRepository.findById(input.tenantId),
    // The creator's name is a nice-to-have — a lookup failure only drops the row.
    userRepository.findById(input.tenantId, input.createdBy).catch(() => null),
  ]);
  const hospitalDetails = resolveReceiptHospitalDetails(tenant);
  const invoiceCounter  = await tenantRepository.incrementInvoiceCounter(input.tenantId);
  const invoiceNumber   = generateInvoiceNumber(hospitalDetails.hospitalName, invoiceCounter);
  return pdfService.generateReceipt({
    receiptNumber: input.paymentId,
    invoiceNumber,
    paymentDate:   input.paymentDate,
    ...hospitalDetails,
    patientName:   input.patient.fullName,
    patientId:     input.patient.patientId,
    patientAge:    resolvePatientAge(input.patient),
    patientAgeUnit: resolvePatientAgeUnit(input.patient),
    patientGender: input.patient.gender ?? null,
    patientMobile: input.patient.mobileNumber ?? null,
    description:   input.description,
    amountInr:     input.amount,
    paymentMethod: input.paymentMethod,
    transactionId: input.transactionId,
    createdBy:     creator?.name || creator?.email || null,
    receiptKind:   input.receiptKind ?? 'payment',
  });
}

async function toResponse(doc: IPayment): Promise<PaymentResponse> {
  const patient = await patientRepository.findByPatientId(doc.tenantId, doc.patientId);

  return {
    paymentId:         doc.paymentId,
    tenantId:          doc.tenantId,
    patientId:         doc.patientId,
    fullName:          patient?.fullName ?? doc.fullName ?? null,
    amount:            doc.amount,
    paymentMethod:     doc.paymentMethod,
    description:       doc.description,
    status:            doc.status,
    receiptUrl:        await resolveReceiptUrl(doc.receiptS3Key),
    razorpayOrderId:   doc.razorpayOrderId,
    razorpayPaymentId: doc.razorpayPaymentId,
    referenceType:     (doc.referenceType as PaymentResponse['referenceType']) ?? null,
    referenceId:       doc.referenceId ?? null,
    transactionId:     doc.transactionId ?? null,
    createdBy:         doc.createdBy,
    createdAt:         doc.createdAt.toISOString(),
    updatedAt:         doc.updatedAt.toISOString(),
  };
}

// Lazily instantiated — avoids throwing at module load in environments without Razorpay creds.
let _razorpay: Razorpay | null = null;
function getRazorpay(): Razorpay {
  if (!_razorpay) {
    _razorpay = new Razorpay({
      key_id:     config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
    });
  }
  return _razorpay;
}

// ─── PaymentService ───────────────────────────────────────────────────────────

export class PaymentService {

  // ─── U5-B-03: Create manual payment (Cash / Cheque) ────────────────────────

  async createManualPayment(
    input:    CreateManualPaymentInput,
    tenantId: string,
    userId:   string,
    options:  ManualPaymentOptions = {},
  ): Promise<PaymentResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    if (input.referenceType && LAB_PAYMENT_REFERENCE_TYPES.includes(input.referenceType)) {
      await this.assertLabReferencePayable(tenantId, input);
    }

    const paymentId   = uuidv4();
    const paymentDate = new Date();

    // Generate receipt PDF and upload to S3 (SECURITY: receipt linked only to this payment).
    // Receipt failure must not fail the payment — same non-fatal handling as the Razorpay webhook.
    let receiptS3Key: string | null = null;
    try {
      const receiptBuffer = options.buildReceipt
        ? await options.buildReceipt({ paymentId, paymentDate })
        : await buildPaymentReceipt({
          tenantId,
          paymentId,
          paymentDate,
          patient,
          amount:        input.amount,
          paymentMethod: input.paymentMethod,
          description:   input.description,
          transactionId: input.transactionId || null,
          createdBy:     userId,
          // A CHARGE reference → Billing section receipt; everything else → Payment receipt.
          receiptKind: input.referenceType === PaymentReferenceType.CHARGE ? 'billing' : 'payment',
        });
      const key = `org/${tenantId}/payments/${paymentId}/receipt.pdf`;
      await s3Service.uploadFile(key, receiptBuffer, 'application/pdf');
      receiptS3Key = key; // only recorded once the upload actually succeeds
    } catch (err) {
      console.warn(JSON.stringify({
        level:     'warn',
        event:     'manual_payment_receipt_failed',
        tenantId,
        paymentId,
        patientId: input.patientId,
        message:   err instanceof Error ? err.message : 'Unknown receipt generation/upload failure',
        timestamp: new Date().toISOString(),
      }));
    }

    let payment: IPayment;
    try {
      payment = await paymentRepository.save({
        paymentId,
        tenantId,
        patientId:     input.patientId,
        fullName:      patient.fullName,
        amount:        input.amount,
        paymentMethod: input.paymentMethod,
        description:   input.description,
        status:        PaymentStatus.COMPLETED,
        receiptS3Key,
        razorpayOrderId:   null,
        razorpayPaymentId: null,
        referenceType: input.referenceType ?? null,
        referenceId:   input.referenceId   ?? null,
        transactionId: input.transactionId ?? null,
        createdBy:     userId,
      });
    } catch (err) {
      // Lost a concurrent collect for the same lab request — the partial
      // unique index (payment.model.ts) rejected this second COMPLETED row.
      if ((err as { code?: number }).code === 11000) {
        if (receiptS3Key) {
          try { await s3Service.deleteFile(receiptS3Key); } catch { /* best-effort orphan cleanup */ }
        }
        throw new ConflictError('Payment has already been collected for this lab request.');
      }
      throw err;
    }

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   paymentId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   {
          patientId:     input.patientId,
          amount:        input.amount,
          method:        input.paymentMethod,
          // transactionId is encrypted at rest (see payment.model.ts) — the
          // audit trail is stored/rendered in plaintext, so it records only
          // that one was supplied, never its value.
          transactionId: input.transactionId ? '[redacted]' : null,
        },
      });
    } catch { /* swallow — audit must not block payment */ }

    return toResponse(payment);
  }

  // A manual payment referencing a Pathology/Radiology request must point at
  // an existing, non-deleted request of this tenant belonging to the same
  // patient, and that request must not already be paid. Guards the generic
  // POST /api/payments/manual as well as the Lab section's collect endpoint.
  private async assertLabReferencePayable(tenantId: string, input: CreateManualPaymentInput): Promise<void> {
    if (!input.referenceId) {
      throw new AppError('referenceId is required for a lab request payment', 400);
    }
    const labRequest = input.referenceType === PaymentReferenceType.PATHOLOGY_REQUEST
      ? await labRepository.findPathologyById(input.referenceId, tenantId)
      : await labRepository.findRadiologyById(input.referenceId, tenantId);
    if (!labRequest) throw new NotFoundError('Lab request not found');
    if (labRequest.patientId !== input.patientId) {
      throw new AppError('Lab request does not belong to this patient', 400);
    }
    // A Billing-created request is paid through its charge (Billing → Mark
    // Paid) — a second, lab-referenced payment would double-charge it.
    if (labRequest.chargeId) {
      throw new ConflictError(
        `This lab request is billed under Billing charge ${labRequest.chargeId}. Collect the payment from Billing.`,
      );
    }
    const existing = await paymentRepository.findCompletedByReference(
      tenantId, input.referenceType as string, input.referenceId,
    );
    if (existing) {
      throw new ConflictError('Payment has already been collected for this lab request.');
    }
  }

  // ─── Billing charge → Payments sync ─────────────────────────────────────────
  // A Billing charge's Payment record is created PENDING when the charge is
  // added, and settled when the charge is marked paid (COMPLETED, receipt
  // generated) or cancelled (CANCELLED). PENDING/CANCELLED records never count
  // towards revenue — every revenue aggregation filters status COMPLETED.

  async createPendingChargePayment(
    input:    { patientId: string; amount: number; description: string; chargeId: string },
    tenantId: string,
    userId:   string,
  ): Promise<IPayment> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const paymentId = uuidv4();
    const payment = await paymentRepository.save({
      paymentId,
      tenantId,
      patientId:         input.patientId,
      fullName:          patient.fullName,
      amount:            input.amount,
      paymentMethod:     PaymentMethod.CASH,
      description:       input.description,
      status:            PaymentStatus.PENDING,
      receiptS3Key:      null,
      razorpayOrderId:   null,
      razorpayPaymentId: null,
      referenceType:     PaymentReferenceType.CHARGE,
      referenceId:       input.chargeId,
      transactionId:     null,
      createdBy:         userId,
    });

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   paymentId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   {
          patientId: input.patientId,
          amount:    input.amount,
          method:    PaymentMethod.CASH,
          status:    PaymentStatus.PENDING,
        },
      });
    } catch { /* swallow — audit must not block payment */ }

    return payment;
  }

  // Settle a PENDING charge payment. Returns null when the record was no longer
  // PENDING (already settled by a concurrent request).
  // `options.buildReceipt` replaces the generic receipt (e.g. a Lab receipt for
  // a Billing LAB_TEST charge), same contract as createManualPayment's.
  async settleChargePayment(
    record:  IPayment,
    status:  typeof PaymentStatus.COMPLETED | typeof PaymentStatus.CANCELLED,
    userId:  string,
    options: ManualPaymentOptions = {},
  ): Promise<IPayment | null> {
    if (record.status !== PaymentStatus.PENDING) return null;

    const fields: Partial<IPayment> = { status };

    if (status === PaymentStatus.COMPLETED) {
      const patient = await patientRepository.findByPatientId(record.tenantId, record.patientId);
      if (patient) {
        try {
          const paymentDate = new Date();
          const receiptBuffer = options.buildReceipt
            ? await options.buildReceipt({ paymentId: record.paymentId, paymentDate })
            : await buildPaymentReceipt({
              tenantId:      record.tenantId,
              paymentId:     record.paymentId,
              paymentDate,
              patient,
              amount:        record.amount,
              paymentMethod: record.paymentMethod,
              description:   record.description,
              transactionId: record.transactionId ?? null,
              createdBy:     userId, // the user marking the charge paid
              receiptKind:   'billing', // settled via Billing section → BILLING RECEIPT
            });
          const key = `org/${record.tenantId}/payments/${record.paymentId}/receipt.pdf`;
          await s3Service.uploadFile(key, receiptBuffer, 'application/pdf');
          fields.receiptS3Key = key; // only recorded once the upload actually succeeds
        } catch { /* receipt generation failure must not fail completion */ }
      }
    }

    const updated = await paymentRepository.updateFromStatus(
      record.paymentId, record.tenantId, PaymentStatus.PENDING, fields,
    );
    if (!updated) return null;

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   record.paymentId,
        action:     'UPDATE',
        userId,
        tenantId:   record.tenantId,
        previousValue: { status: PaymentStatus.PENDING },
        newValue:      { status },
      });
    } catch { /* swallow */ }

    return updated;
  }

  // ─── U5-C-02: Create Razorpay order (UPI / Card) ───────────────────────────

  async createRazorpayOrder(
    input:    CreateRazorpayOrderInput,
    tenantId: string,
    userId:   string,
  ): Promise<RazorpayOrderResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const paymentId   = uuidv4();
    const amountPaise = Math.round(input.amount * 100); // Razorpay requires paise

    const order = await getRazorpay().orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  paymentId,
      notes:    { patientId: input.patientId, description: input.description, tenantId },
    });

    // Store PENDING payment record — will be updated by webhook on capture
    await paymentRepository.save({
      paymentId,
      tenantId,
      patientId:         input.patientId,
      fullName:          patient.fullName,
      amount:            input.amount,
      paymentMethod:     input.paymentMethod,
      description:       input.description,
      status:            PaymentStatus.PENDING,
      receiptS3Key:      null,
      razorpayOrderId:   order.id,
      razorpayPaymentId: null,
      createdBy:         userId,
    });

    return {
      paymentId,
      razorpayOrderId: order.id,
      amountPaise,
      currency: 'INR',
      keyId:    config.razorpay.keyId,
    };
  }

  // ─── U5-C-03: Handle Razorpay webhook ──────────────────────────────────────

  async handleRazorpayWebhook(rawBody: Buffer, signature: string): Promise<void> {
    // HMAC-SHA256 signature validation (timing-safe — SECURITY-XX)
    // Reject non-hex or wrong-length strings before timingSafeEqual (which throws on length mismatch)
    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      throw new AppError('Invalid webhook signature', 400);
    }

    const expectedSig = crypto
      .createHmac('sha256', config.razorpay.webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(
      Buffer.from(expectedSig, 'hex'),
      Buffer.from(signature,   'hex'),
    )) {
      throw new AppError('Invalid webhook signature', 400);
    }

    const payload = JSON.parse(rawBody.toString()) as Record<string, unknown>;
    const event   = payload['event'];

    const entity   = (payload['payload'] as Record<string, unknown> | undefined);
    const payment  = entity && ((entity['payment'] as Record<string, unknown> | undefined)?.['entity']) as Record<string, unknown> | undefined;
    if (!payment) return;
    const orderId  = payment['order_id'] as string;
    const rzpPayId = payment['id']       as string;

    const record = await paymentRepository.findByRazorpayOrderId(orderId);
    if (!record) return;

    if (event === 'payment.captured') {
      if (record.status === PaymentStatus.COMPLETED) return; // idempotent
      await this.completePaymentRecord(record, rzpPayId);
      return;
    }

    if (event === 'payment.failed') {
      // A captured payment (webhook/verify) always wins; never downgrade it.
      // An explicitly cancelled checkout must remain CANCELLED even if a late failure event arrives.
      if (record.status === PaymentStatus.COMPLETED || record.status === PaymentStatus.FAILED || record.status === PaymentStatus.CANCELLED) return;
      await paymentRepository.update(record.paymentId, record.tenantId, {
        status:            PaymentStatus.FAILED,
        razorpayPaymentId: rzpPayId,
      } as Partial<IPayment>);
      try {
        await auditService.log({
          entityType: AuditEntityType.PAYMENT_RECORD,
          entityId:   record.paymentId,
          action:     'UPDATE',
          userId:     record.createdBy,
          tenantId:   record.tenantId,
          previousValue: { status: record.status },
          newValue:      { status: PaymentStatus.FAILED },
        });
      } catch { /* swallow */ }
      return;
    }
    // other events ignored
  }

  // Mark a PENDING record COMPLETED and generate its receipt. Shared by the
  // webhook (payment.captured) and the client-verify path.
  private async completePaymentRecord(record: IPayment, rzpPayId: string): Promise<IPayment | null> {
    const patient = await patientRepository.findByPatientId(record.tenantId, record.patientId);

    let receiptS3Key: string | null = null;
    if (patient) {
      try {
        const receiptBuffer = await buildPaymentReceipt({
          tenantId:      record.tenantId,
          paymentId:     record.paymentId,
          paymentDate:   new Date(),
          patient,
          amount:        record.amount,
          paymentMethod: record.paymentMethod,
          description:   record.description,
          transactionId: rzpPayId, // Razorpay payment ID
          createdBy:     record.createdBy,
        });
        receiptS3Key = `org/${record.tenantId}/payments/${record.paymentId}/receipt.pdf`;
        await s3Service.uploadFile(receiptS3Key, receiptBuffer, 'application/pdf');
      } catch { /* receipt generation failure must not fail completion */ }
    }

    const updated = await paymentRepository.update(record.paymentId, record.tenantId, {
      status:            PaymentStatus.COMPLETED,
      razorpayPaymentId: rzpPayId,
      receiptS3Key,
    } as Partial<IPayment>);

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   record.paymentId,
        action:     'UPDATE',
        userId:     record.createdBy,
        tenantId:   record.tenantId,
        previousValue: { status: record.status },
        newValue:      { status: PaymentStatus.COMPLETED, razorpayPaymentId: rzpPayId },
      });
    } catch { /* swallow */ }

    return updated;
  }

  // ─── Verify a Razorpay checkout success (client handler → authoritative) ──────
  // Validates the HMAC signature Razorpay returns to the browser so success does
  // not rely solely on the webhook. Idempotent.
  async verifyRazorpayPayment(
    tenantId: string,
    data: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
  ): Promise<PaymentResponse> {
    const expected = crypto
      .createHmac('sha256', config.razorpay.keySecret)
      .update(`${data.razorpayOrderId}|${data.razorpayPaymentId}`)
      .digest('hex');

    const sig = data.razorpaySignature;
    if (!/^[0-9a-f]{64}$/i.test(sig) ||
        !crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'))) {
      throw new AppError('Invalid payment signature', 400);
    }

    const record = await paymentRepository.findByRazorpayOrderId(data.razorpayOrderId);
    if (!record || record.tenantId !== tenantId) throw new NotFoundError('Payment not found');
    if (record.status === PaymentStatus.COMPLETED) return toResponse(record);

    const updated = await this.completePaymentRecord(record, data.razorpayPaymentId);
    return toResponse(updated ?? record);
  }

  // ─── Cancel an abandoned Razorpay checkout (client ondismiss) ─────────────────
  // Only a still-PENDING order is cancelled. If the payment was actually captured,
  // the payment.captured webhook (which ignores the COMPLETED check for CANCELLED)
  // still corrects it to COMPLETED — reality wins.
  async cancelRazorpayOrder(
    tenantId: string,
    razorpayOrderId: string,
    userId: string,
  ): Promise<PaymentResponse> {
    const record = await paymentRepository.findByRazorpayOrderId(razorpayOrderId);
    if (!record || record.tenantId !== tenantId) throw new NotFoundError('Payment not found');
    if (record.status !== PaymentStatus.PENDING) return toResponse(record);

    const updated = await paymentRepository.update(record.paymentId, tenantId, {
      status: PaymentStatus.CANCELLED,
    } as Partial<IPayment>);

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   record.paymentId,
        action:     'UPDATE',
        userId,
        tenantId,
        previousValue: { status: PaymentStatus.PENDING },
        newValue:      { status: PaymentStatus.CANCELLED },
      });
    } catch { /* swallow */ }

    return toResponse(updated ?? record);
  }

  // ─── U5-B-04: List payments ────────────────────────────────────────────────

  async listPayments(
    tenantId: string,
    query:    ListPaymentsQuery,
  ): Promise<PaginatedResult<PaymentResponse>> {
    const result = await paymentRepository.findByFilters(tenantId, query);
    const data   = await Promise.all(result.data.map(toResponse));
    return { ...result, data };
  }

  // ─── U5-B-04: Get receipt pre-signed URL ──────────────────────────────────

  async getReceiptUrl(paymentId: string, tenantId: string): Promise<string> {
    const payment = await paymentRepository.findById(paymentId, tenantId);
    if (!payment) throw new NotFoundError('Payment not found');

    if (!payment.receiptS3Key) {
      throw new AppError('Receipt is not yet available for this payment', 404);
    }

    return s3Service.getPresignedUrl(payment.receiptS3Key, RECEIPT_URL_EXPIRY_SECONDS);
  }

  // ─── U5-B-04: Payment summary report ──────────────────────────────────────

  async getPaymentSummary(
    tenantId: string,
    query:    PaymentSummaryQuery,
  ): Promise<PaymentSummaryResponse> {
    return paymentRepository.sumByMethod(tenantId, query);
  }

  // ─── Department-wise revenue report ────────────────────────────────────────
  // Every active department is included (₹0 if it has no matching revenue).
  // Unassigned pathology/radiology requests have dedicated category buckets;
  // other unresolved revenue is folded into `other`.

  async getDepartmentRevenue(
    tenantId: string,
    query:    DepartmentRevenueQuery,
  ): Promise<DepartmentRevenueResponse> {
    const [departments, resolvedSums] = await Promise.all([
      departmentRepository.findAll(tenantId),
      paymentRepository.sumByResolvedDepartment(tenantId, query),
    ]);

    const emptyBreakdown = (): DepartmentRevenueBreakdown => (
      { opdRevenue: 0, ipdRevenue: 0, directPayment: 0, total: 0 }
    );
    const addToBreakdown = (bucket: DepartmentRevenueBreakdown, referenceType: string | null, amount: number) => {
      if (referenceType === PaymentReferenceType.OPD_VISIT) bucket.opdRevenue += amount;
      else if (referenceType === PaymentReferenceType.IPD_ADMISSION) bucket.ipdRevenue += amount;
      else bucket.directPayment += amount;
      bucket.total += amount;
    };

    const breakdownByDepartmentId = new Map<string, DepartmentRevenueBreakdown>();
    const other = emptyBreakdown();
    const pathologist = emptyBreakdown();
    const radiologist = emptyBreakdown();
    const knownDepartmentIds = new Set(departments.map((d) => d.departmentId));
    for (const row of resolvedSums) {
      if (row.departmentId && knownDepartmentIds.has(row.departmentId)) {
        const bucket = breakdownByDepartmentId.get(row.departmentId) ?? emptyBreakdown();
        addToBreakdown(bucket, row.referenceType, row.total);
        breakdownByDepartmentId.set(row.departmentId, bucket);
      } else if (row.referenceType === PaymentReferenceType.PATHOLOGY_REQUEST) {
        addToBreakdown(pathologist, row.referenceType, row.total);
      } else if (row.referenceType === PaymentReferenceType.RADIOLOGY_REQUEST) {
        addToBreakdown(radiologist, row.referenceType, row.total);
      } else {
        addToBreakdown(other, row.referenceType, row.total);
      }
    }

    const departmentEntries: DepartmentRevenueEntry[] = departments.map((d) => ({
      departmentId: d.departmentId,
      name:         d.name,
      ...(breakdownByDepartmentId.get(d.departmentId) ?? emptyBreakdown()),
    }));

    const grandTotal = departmentEntries.reduce((sum, d) => sum + d.total, 0)
      + other.total + pathologist.total + radiologist.total;

    return { departments: departmentEntries, other, pathologist, radiologist, grandTotal };
  }
}

export const paymentService = new PaymentService();
