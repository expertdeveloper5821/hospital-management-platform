import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { patientService, DuplicateWarningError } from './patient.service';
import { IPatient } from './patient.model';
import { ValidationError } from '../../shared/middleware/error-handler';
import { patientIdSchema, searchSchema } from '../../shared/utils/validation';
import { paymentService } from '../payment/payment.service';
import { PaymentMethod } from '../payment/payment.types';

const GENDER_VALUES       = ['MALE', 'FEMALE', 'OTHER']              as const;
const BLOOD_GROUP_VALUES  = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

const createPatientSchema = z.object({
  fullName:                  z.string().min(1).max(200).trim(),
  dateOfBirth:               z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  gender:                    z.enum(GENDER_VALUES),
  mobileNumber:              z.string().min(7).max(15).regex(/^\+?[0-9]+$/, 'Invalid mobile number'),
  address:                   z.string().min(1).max(500).trim(),
  aadhaarNumber:             z.string().length(12).regex(/^[0-9]+$/).optional(),
  emergencyContactName:      z.string().min(1).max(200).optional(),
  emergencyContactMobile:    z.string().min(7).max(15).regex(/^\+?[0-9]+$/).optional(),
  bloodGroup:                z.enum(BLOOD_GROUP_VALUES).optional(),
  departmentId:              z.string().min(1).optional(),
  registrationFee:           z.number().positive().optional(),
  registrationPaymentMethod: z.enum([PaymentMethod.CASH, PaymentMethod.UPI, PaymentMethod.CARD]).optional(),
  forceCreate:               z.boolean().optional(),
});

const updatePatientSchema = z.object({
  fullName:               z.string().min(1).max(200).trim().optional(),
  dateOfBirth:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender:                 z.enum(GENDER_VALUES).optional(),
  mobileNumber:           z.string().min(7).max(15).regex(/^\+?[0-9]+$/).optional(),
  address:                z.string().min(1).max(500).trim().optional(),
  aadhaarNumber:          z.string().length(12).regex(/^[0-9]+$/).optional(),
  emergencyContactName:   z.string().min(1).max(200).optional(),
  emergencyContactMobile: z.string().min(7).max(15).regex(/^\+?[0-9]+$/).optional(),
  bloodGroup:             z.enum(BLOOD_GROUP_VALUES).optional(),
  departmentId:           z.string().min(1).nullable().optional(),
});

function toResponse(p: IPatient) {
  return {
    patientId:                 p.patientId,
    fullName:                  p.fullName,
    dateOfBirth:               p.dateOfBirth,
    gender:                    p.gender,
    mobileNumber:              p.mobileNumber,
    address:                   p.address,
    aadhaarNumber:             p.aadhaarNumber             ?? null,
    emergencyContactName:      p.emergencyContactName      ?? null,
    emergencyContactMobile:    p.emergencyContactMobile    ?? null,
    bloodGroup:                p.bloodGroup                ?? null,
    departmentId:              p.departmentId              ?? null,
    registrationFee:           p.registrationFee           ?? null,
    registrationPaymentMethod: p.registrationPaymentMethod ?? null,
    tenantId:                  p.tenantId,
    createdAt:                 p.createdAt,
    updatedAt:                 p.updatedAt,
  };
}

export async function createPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createPatientSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const userId   = req.user!.userId;

    const patient = await patientService.createPatient(
      tenantId,
      body.data as Parameters<typeof patientService.createPatient>[1],
      userId,
    );

    // Create payment record when registration fee is provided
    if (body.data.registrationFee && body.data.registrationPaymentMethod) {
      try {
        await paymentService.createManualPayment(
          {
            patientId:     patient.patientId,
            amount:        body.data.registrationFee,
            paymentMethod: body.data.registrationPaymentMethod as typeof PaymentMethod[keyof typeof PaymentMethod],
            description:   'Patient Registration Fee',
          },
          tenantId,
          userId,
        );
      } catch { /* payment failure must not roll back patient creation */ }
    }

    res.status(201).json({ status: 'success', data: toResponse(patient) });
  } catch (err) {
    if (err instanceof DuplicateWarningError) {
      res.status(409).json({
        status:  'error',
        message: err.message,
        data:    { isDuplicateWarning: true, existingPatientId: err.existingPatientId },
      });
      return;
    }
    next(err);
  }
}

export async function searchPatients(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = searchSchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');
    const { q, page, limit } = query.data;

    const result = await patientService.searchPatients(req.user!.tenantId!, q, page, limit);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { patientId } = z.object({ patientId: patientIdSchema }).parse(req.params);
    const patient = await patientService.getPatientById(req.user!.tenantId!, patientId);
    res.status(200).json({ status: 'success', data: toResponse(patient) });
  } catch (err) { next(err); }
}

export async function updatePatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { patientId } = z.object({ patientId: patientIdSchema }).parse(req.params);
    const body = updatePatientSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });
    const patient = await patientService.updatePatient(
      req.user!.tenantId!,
      patientId,
      body.data,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: toResponse(patient) });
  } catch (err) { next(err); }
}

export async function deletePatient(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { patientId } = z.object({ patientId: patientIdSchema }).parse(req.params);
    await patientService.deletePatient(req.user!.tenantId!, patientId, req.user!.userId);
    res.status(200).json({ status: 'success', message: 'Patient record deleted.' });
  } catch (err) { next(err); }
}

export async function getMedicalCard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { patientId } = z.object({ patientId: patientIdSchema }).parse(req.params);
    const pdfBuffer = await patientService.generateMedicalCard(
      req.user!.tenantId!,
      patientId,
      req.user!.userId,
    );
    res.status(200)
      .set({
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="medical-card-${patientId}.pdf"`,
        'Content-Length':      pdfBuffer.length.toString(),
      })
      .send(pdfBuffer);
  } catch (err) { next(err); }
}
