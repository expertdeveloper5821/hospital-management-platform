import express from 'express';
import { handleRazorpayWebhook } from './payment.controller';

const router = express.Router();

// POST /api/webhooks/razorpay — public; raw body required for HMAC validation (U5-C-04)
// express.raw() is applied in app.ts before this router so req.body is a Buffer here.
router.post('/razorpay', handleRazorpayWebhook);

export default router;
