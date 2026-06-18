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
} as const;

export type PaymentStatus = typeof PaymentStatus[keyof typeof PaymentStatus];

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const CreateManualPaymentSchema = z.object({
  patientId:     z.string().min(1, 'patientId is required'),
  amount:        z.number({ invalid_type_error: 'amount must be a number' })
                  .positive('Amount must be greater than zero'),
  paymentMethod: z.enum([PaymentMethod.CASH, PaymentMethod.CHEQUE, PaymentMethod.UPI, PaymentMethod.CARD], {
    errorMap: () => ({ message: 'paymentMethod must be CASH, CHEQUE, UPI, or CARD for manual payments' }),
  }),
  description:   z.string().min(1, 'description is required').max(500).trim(),
});

export type CreateManualPaymentInput = z.infer<typeof CreateManualPaymentSchema>;

export const CreateRazorpayOrderSchema = z.object({
  patientId:     z.string().min(1, 'patientId is required'),
  amount:        z.number({ invalid_type_error: 'amount must be a number' })
                  .positive('Amount must be greater than zero'),
  paymentMethod: z.enum([PaymentMethod.UPI, PaymentMethod.CARD], {
    errorMap: () => ({ message: 'paymentMethod must be UPI or CARD for Razorpay payments' }),
  }),
  description:   z.string().min(1, 'description is required').max(500).trim(),
});

export type CreateRazorpayOrderInput = z.infer<typeof CreateRazorpayOrderSchema>;

export const ListPaymentsQuerySchema = z.object({
  patientId:     z.string().min(1).optional(),
  dateFrom:      z.string().datetime({ offset: true }).optional(),
  dateTo:        z.string().datetime({ offset: true }).optional(),
  paymentMethod: z.enum(['CASH', 'CHEQUE', 'UPI', 'CARD']).optional(),
  page:          z.coerce.number().int().min(1).default(1),
  limit:         z.coerce.number().int().min(1).max(100).default(20),
});

export type ListPaymentsQuery = z.infer<typeof ListPaymentsQuerySchema>;

export const PaymentSummaryQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo:   z.string().datetime({ offset: true }).optional(),
});

export type PaymentSummaryQuery = z.infer<typeof PaymentSummaryQuerySchema>;

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
