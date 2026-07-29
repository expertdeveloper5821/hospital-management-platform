import crypto   from 'crypto';
import Razorpay from 'razorpay';
import { v4 as uuidv4 } from 'uuid';

import { paymentRepository }  from './payment.repository';
import { IPayment }            from './payment.model';
import {
  PaymentStatus,
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
} from './payment.types';

import { patientRepository }    from '../patient/patient.repository';
import { tenantRepository }     from '../tenant/tenant.repository';
import { departmentRepository } from '../department/department.repository';
import { pdfService }        from '../../shared/services/pdf.service';
import { s3Service }         from '../../shared/services/s3.service';
import { auditService }      from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult } from '../../shared/types/common.types';
import { AppError, NotFoundError }          from '../../shared/middleware/error-handler';
import config from '../../shared/config/env';

// Pre-signed URL expiry: 1 hour
const RECEIPT_URL_EXPIRY_SECONDS = 3600;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveReceiptUrl(s3Key: string | null): Promise<string | null> {
  if (!s3Key) return null;
  // A presign failure (e.g. transient S3 issue) must not break payment creation/listing —
  // the receipt link is secondary to the payment record itself.
  return s3Service.getPresignedUrl(s3Key, RECEIPT_URL_EXPIRY_SECONDS).catch(() => null);
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
  ): Promise<PaymentResponse> {
    const patient = await patientRepository.findByPatientId(tenantId, input.patientId);
    if (!patient) throw new NotFoundError('Patient not found');

    const tenant = await tenantRepository.findById(tenantId);

    const paymentId = uuidv4();

    // Generate receipt PDF and upload to S3 (SECURITY: receipt linked only to this payment).
    // Receipt failure must not fail the payment — same non-fatal handling as the Razorpay webhook.
    let receiptS3Key: string | null = null;
    try {
      const receiptBuffer = await pdfService.generateReceipt({
        receiptNumber:  paymentId,
        patientName:    patient.fullName,
        patientId:      patient.patientId,
        paymentDate:    new Date(),
        amountInr:      input.amount,
        paymentMethod:  input.paymentMethod,
        description:    input.description,
        hospitalName:   tenant?.branding.displayName || tenant?.name || 'Hospital',
        primaryColor:   tenant?.branding.primaryColor || '#1A73E8',
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

    const payment = await paymentRepository.save({
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
      createdBy:     userId,
    });

    try {
      await auditService.log({
        entityType: AuditEntityType.PAYMENT_RECORD,
        entityId:   paymentId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   { patientId: input.patientId, amount: input.amount, method: input.paymentMethod },
      });
    } catch { /* swallow — audit must not block payment */ }

    return toResponse(payment);
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
    const tenant  = await tenantRepository.findById(record.tenantId);
    const patient = await patientRepository.findByPatientId(record.tenantId, record.patientId);

    let receiptS3Key: string | null = null;
    if (patient) {
      try {
        const receiptBuffer = await pdfService.generateReceipt({
          receiptNumber: record.paymentId,
          patientName:   patient.fullName,
          patientId:     patient.patientId,
          paymentDate:   new Date(),
          amountInr:     record.amount,
          paymentMethod: record.paymentMethod,
          description:   record.description,
          hospitalName:  tenant?.branding.displayName || tenant?.name || 'Hospital',
          primaryColor:  tenant?.branding.primaryColor || '#1A73E8',
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
  // Every active department is included (₹0 if it has no matching revenue);
  // revenue that couldn't be mapped to a department (or maps to a department
  // that no longer exists) is folded into `otherTotal` so `grandTotal`
  // always equals the sum of the whole breakdown — never computed separately.

  async getDepartmentRevenue(
    tenantId: string,
    query:    DepartmentRevenueQuery,
  ): Promise<DepartmentRevenueResponse> {
    const [departments, resolvedSums] = await Promise.all([
      departmentRepository.findAll(tenantId),
      paymentRepository.sumByResolvedDepartment(tenantId, query),
    ]);

    const totalByDepartmentId = new Map<string, number>();
    let otherTotal = 0;
    for (const row of resolvedSums) {
      if (row.departmentId) {
        totalByDepartmentId.set(row.departmentId, (totalByDepartmentId.get(row.departmentId) ?? 0) + row.total);
      } else {
        otherTotal += row.total;
      }
    }

    const knownDepartmentIds = new Set(departments.map((d) => d.departmentId));
    const departmentEntries: DepartmentRevenueEntry[] = departments.map((d) => ({
      departmentId: d.departmentId,
      name:         d.name,
      total:        totalByDepartmentId.get(d.departmentId) ?? 0,
    }));

    // Revenue resolved to a departmentId that isn't (or no longer is) an
    // active department — e.g. it was deleted after the payment was made.
    for (const [departmentId, total] of totalByDepartmentId) {
      if (!knownDepartmentIds.has(departmentId)) otherTotal += total;
    }

    const grandTotal = departmentEntries.reduce((sum, d) => sum + d.total, 0) + otherTotal;

    return { departments: departmentEntries, otherTotal, grandTotal };
  }
}

export const paymentService = new PaymentService();
