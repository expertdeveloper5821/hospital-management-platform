import { z } from 'zod';

// ─── PaymentMethod ────────────────────────────────────────────────────────────
export const PaymentMethod = {
  CASH:   'CASH',
  CHEQUE: 'CHEQUE',
  UPI:    'UPI',
  CARD:   'CARD',
} as const;

export type PaymentMethod = typeof PaymentMethod[keyof typeof PaymentMethod];

// ─── PaymentStatus ────────────────────────────────────────────────────────────
export const PaymentStatus = {
  PENDING:   'PENDING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

// ─── PaymentReferenceType ─────────────────────────────────────────────────────
// What this payment was collected for — lets a caller look up "the payment for
// visit X" by exact reference instead of guessing from patientId + date. Every
// reference type here that carries its own departmentId (OPD visit, IPD
// admission, pathology/radiology request) is also registered in
// REFERENCE_DEPARTMENT_SOURCES (payment.repository.ts) so department-wise
// revenue resolves it automatically — see that file for how to add a new one.
// CHARGE (Billing → Charges "Mark Paid") is deliberately NOT registered there:
// it has no department of its own, so it falls back to Patient.departmentId
// (null for any patient registered after department-scoping moved off
// Patient — see CLAUDE.md) and lands in "Other Revenue", same as REGISTRATION.
export const PaymentReferenceType = {
  OPD_VISIT:          'OPD_VISIT',
  IPD_ADMISSION:      'IPD_ADMISSION',
  REGISTRATION:       'REGISTRATION',
  PATHOLOGY_REQUEST:  'PATHOLOGY_REQUEST',
  RADIOLOGY_REQUEST:  'RADIOLOGY_REQUEST',
  CHARGE:             'CHARGE',
} as const;

export type PaymentReferenceType = typeof PaymentReferenceType[keyof typeof PaymentReferenceType];

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const MAX_AMOUNT_DIGITS = 10;

// Amount must be a positive number with at most 2 decimal places (paise/cents) —
// rejects garbage like 500.505 that would silently round differently on save vs. display.
// Also capped at 10 total digits to match the frontend's input limit.
const amountSchema = z.number({ invalid_type_error: 'amount must be a number' })
  .positive('Amount must be greater than zero')
  .refine((val) => Math.round(val * 100) === val * 100, 'Amount cannot have more than 2 decimal places')
  .refine(
    (val) => String(val).replace(/[^0-9]/g, '').length <= MAX_AMOUNT_DIGITS,
    'Amount cannot exceed 10 digits.',
  );

export const CreateManualPaymentSchema = z.object({
  patientId:     z.string().min(1, 'patientId is required'),
  amount:        amountSchema,
  paymentMethod: z.enum([PaymentMethod.CASH, PaymentMethod.CHEQUE, PaymentMethod.UPI, PaymentMethod.CARD], {
    errorMap: () => ({ message: 'paymentMethod must be CASH, CHEQUE, UPI, or CARD for manual payments' }),
  }),
  description:   z.string().min(1, 'description is required').max(500, 'description cannot exceed 500 characters').trim(),
  referenceType: z.enum([
    PaymentReferenceType.OPD_VISIT,
    PaymentReferenceType.IPD_ADMISSION,
    PaymentReferenceType.REGISTRATION,
    PaymentReferenceType.PATHOLOGY_REQUEST,
    PaymentReferenceType.RADIOLOGY_REQUEST,
    PaymentReferenceType.CHARGE,
  ]).optional(),
  referenceId:   z.string().min(1).optional(),
  // Optional UPI/Card reference number — never required, regardless of
  // paymentMethod; the frontend only surfaces the field for UPI/Card.
  transactionId: z.string().max(100, 'Transaction ID cannot exceed 100 characters').trim().optional(),
});

export type CreateManualPaymentInput = z.infer<typeof CreateManualPaymentSchema>;

export const CreateRazorpayOrderSchema = z.object({
  patientId:     z.string().min(1, 'patientId is required'),
  amount:        amountSchema,
  paymentMethod: z.enum([PaymentMethod.UPI, PaymentMethod.CARD], {
    errorMap: () => ({ message: 'paymentMethod must be UPI or CARD for Razorpay payments' }),
  }),
  description:   z.string().min(1, 'description is required').max(500, 'description cannot exceed 500 characters').trim(),
});

export type CreateRazorpayOrderInput = z.infer<typeof CreateRazorpayOrderSchema>;

export const ListPaymentsQuerySchema = z.object({
  patientId:     z.string().min(1).optional(),
  dateFrom:      z.string().datetime({ offset: true }).optional(),
  dateTo:        z.string().datetime({ offset: true }).optional(),
  paymentMethod: z.enum(['CASH', 'CHEQUE', 'UPI', 'CARD']).optional(),
  status:        z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  referenceType: z.enum([
    PaymentReferenceType.OPD_VISIT,
    PaymentReferenceType.IPD_ADMISSION,
    PaymentReferenceType.REGISTRATION,
    PaymentReferenceType.PATHOLOGY_REQUEST,
    PaymentReferenceType.RADIOLOGY_REQUEST,
    PaymentReferenceType.CHARGE,
  ]).optional(),
  referenceId:   z.string().min(1).optional(),
  page:          z.coerce.number().int().min(1).default(1),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;

export const PaymentSummaryQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo:   z.string().datetime({ offset: true }).optional(),
});

export type PaymentSummaryQuery = z.infer<typeof PaymentSummaryQuerySchema>;

// Same filter set as the payments list (dateFrom/dateTo/method/status) so the
// Department-wise Revenue section can mirror whatever the Payments page table
// is currently filtered to. When `status` is omitted, revenue defaults to
// COMPLETED-only (successfully collected revenue); an explicit status narrows
// the breakdown to that status instead.
export const DepartmentRevenueQuerySchema = z.object({
  dateFrom:      z.string().datetime({ offset: true }).optional(),
  dateTo:        z.string().datetime({ offset: true }).optional(),
  paymentMethod: z.enum(['CASH', 'CHEQUE', 'UPI', 'CARD']).optional(),
  status:        z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
});

export type DepartmentRevenueQuery = z.infer<typeof DepartmentRevenueQuerySchema>;

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface PaymentResponse {
  paymentId:         string;
  tenantId:          string;
  patientId:         string;
  fullName:          string | null;
  amount:            number;
  paymentMethod:     PaymentMethod;
  description:       string;
  status:            PaymentStatus;
  receiptUrl:        string | null;
  razorpayOrderId:   string | null;
  razorpayPaymentId: string | null;
  referenceType:     PaymentReferenceType | null;
  referenceId:       string | null;
  transactionId:     string | null;
  createdBy:         string;
  createdAt:         string;
  updatedAt:         string;
}

export interface RazorpayOrderResponse {
  paymentId:       string;
  razorpayOrderId: string;
  amountPaise:     number;
  currency:        string;
  keyId:           string;
}

export interface PaymentSummaryResponse {
  CASH:   number;
  CHEQUE: number;
  UPI:    number;
  CARD:   number;
  total:  number;
}

// Revenue for one bucket (a department, or the "other/unassigned" bucket),
// split by where it was collected. `directPayment` covers registration fees,
// pathology/radiology payments, and any other payment not tied to an OPD
// visit or IPD admission — the *department* those still resolve to (via
// REFERENCE_DEPARTMENT_SOURCES in payment.repository.ts) is correct even
// though they're not broken out into their own column here; only the
// department-vs-other split is normative, not this OPD/IPD/direct split.
// split by where it was collected. `directPayment` covers registration fees,
// pathology/radiology payments, and any other payment not tied to an OPD
// visit or IPD admission — the *department* those still resolve to (via
// REFERENCE_DEPARTMENT_SOURCES in payment.repository.ts) is correct even
// though they're not broken out into their own column here; only the
// department-vs-other split is normative, not this OPD/IPD/direct split.
// `opdRevenue + ipdRevenue + directPayment` always equals `total`.
export interface DepartmentRevenueBreakdown {
  opdRevenue:    number;
  ipdRevenue:    number;
  directPayment: number;
  total:         number;
}

export interface DepartmentRevenueEntry extends DepartmentRevenueBreakdown {
  departmentId: string;
  name:         string;
}

// `other` covers payments that could not be mapped to any active
// department — e.g. registration fees, payments predating department
// tracking, or a payment whose linked OPD visit/IPD admission had no
// department assigned. `grandTotal` is always the sum of the department
// totals plus `other.total`, so the breakdown reconciles with the filtered
// payment total by construction.
export interface DepartmentRevenueResponse {
  departments: DepartmentRevenueEntry[];
  other:       DepartmentRevenueBreakdown;
  grandTotal:  number;
}
