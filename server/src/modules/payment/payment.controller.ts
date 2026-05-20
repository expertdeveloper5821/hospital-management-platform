import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { paymentService } from './payment.service';
import {
  CreateManualPaymentSchema,
  CreateRazorpayOrderSchema,
  ListPaymentsQuerySchema,
  PaymentSummaryQuerySchema,
} from './payment.types';

const paymentIdSchema = z.string().uuid('paymentId must be a valid UUID');

// ─── Manual payment ───────────────────────────────────────────────────────────

export async function createManualPayment(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateManualPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const result = await paymentService.createManualPayment(
      parsed.data, req.user!.tenantId as string, req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── Razorpay order ───────────────────────────────────────────────────────────

export async function createRazorpayOrder(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateRazorpayOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Validation failed', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const result = await paymentService.createRazorpayOrder(
      parsed.data, req.user!.tenantId as string, req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── List payments ────────────────────────────────────────────────────────────

export async function listPayments(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListPaymentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const result = await paymentService.listPayments(req.user!.tenantId as string, parsed.data);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── Receipt download ─────────────────────────────────────────────────────────

export async function getReceiptUrl(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const id = paymentIdSchema.safeParse(req.params['paymentId']);
    if (!id.success) {
      res.status(400).json({ status: 'error', message: 'Invalid paymentId format' });
      return;
    }
    const url = await paymentService.getReceiptUrl(id.data, req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: { receiptUrl: url } });
  } catch (err) { next(err); }
}

// ─── Payment summary report ───────────────────────────────────────────────────

export async function getPaymentSummary(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = PaymentSummaryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ status: 'error', message: 'Invalid query parameters', details: parsed.error.flatten().fieldErrors });
      return;
    }
    const result = await paymentService.getPaymentSummary(req.user!.tenantId as string, parsed.data);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// ─── Razorpay webhook (public — no auth middleware) ───────────────────────────

export async function handleRazorpayWebhook(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const signature = req.headers['x-razorpay-signature'] as string | undefined;
    if (!signature) {
      res.status(400).json({ status: 'error', message: 'Missing x-razorpay-signature header' });
      return;
    }
    // req.body is a raw Buffer — express.raw() is applied on this route in app.ts
    await paymentService.handleRazorpayWebhook(req.body as Buffer, signature);
    res.status(200).json({ status: 'success' });
  } catch (err) { next(err); }
}
