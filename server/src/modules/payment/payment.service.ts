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
} from './payment.types';

import { patientRepository } from '../patient/patient.repository';
import { tenantRepository }  from '../tenant/tenant.repository';
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
  return s3Service.getPresignedUrl(s3Key, RECEIPT_URL_EXPIRY_SECONDS);
}

async function toResponse(doc: IPayment): Promise<PaymentResponse> {
  return {
    paymentId:         doc.paymentId,
    tenantId:          doc.tenantId,
    patientId:         doc.patientId,
    amount:            doc.amount,
    paymentMethod:     doc.paymentMethod,
    description:       doc.description,
    status:            doc.status,
    receiptUrl:        await resolveReceiptUrl(doc.receiptS3Key),
    razorpayOrderId:   doc.razorpayOrderId,
    razorpayPaymentId: doc.razorpayPaymentId,
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

    // Generate receipt PDF and upload to S3 (SECURITY: receipt linked only to this payment)
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

    const s3Key = `org/${tenantId}/payments/${paymentId}/receipt.pdf`;
    await s3Service.uploadFile(s3Key, receiptBuffer, 'application/pdf');

    const payment = await paymentRepository.save({
      paymentId,
      tenantId,
      patientId:    input.patientId,
      amount:       input.amount,
      paymentMethod: input.paymentMethod,
      description:  input.description,
      status:       PaymentStatus.COMPLETED,
      receiptS3Key: s3Key,
      razorpayOrderId:   null,
      razorpayPaymentId: null,
      createdBy:    userId,
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
      patientId:      input.patientId,
      amount:         input.amount,
      paymentMethod:  input.paymentMethod,
      description:    input.description,
      status:         PaymentStatus.PENDING,
      receiptS3Key:   null,
      razorpayOrderId: order.id,
      razorpayPaymentId: null,
      createdBy:      userId,
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

    if (payload['event'] !== 'payment.captured') return;

    const entity   = (payload['payload'] as Record<string, unknown>);
    const payment  = ((entity['payment'] as Record<string, unknown>)['entity']) as Record<string, unknown>;
    const orderId  = payment['order_id'] as string;
    const rzpPayId = payment['id']       as string;

    const record = await paymentRepository.findByRazorpayOrderId(orderId);
    if (!record || record.status === PaymentStatus.COMPLETED) return; // idempotent

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
      } catch { /* receipt generation failure must not fail the webhook */ }
    }

    await paymentRepository.update(record.paymentId, record.tenantId, {
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
        previousValue: { status: PaymentStatus.PENDING },
        newValue:      { status: PaymentStatus.COMPLETED, razorpayPaymentId: rzpPayId },
      });
    } catch { /* swallow */ }
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
}

export const paymentService = new PaymentService();
