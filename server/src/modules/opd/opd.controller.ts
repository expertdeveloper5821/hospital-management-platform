import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { opdService } from './opd.service';
import { IOPDVisit } from './opd.model';
import { ValidationError, NotFoundError, ForbiddenError } from '../../shared/middleware/error-handler';
import { UserRole } from '../../shared/types/common.types';
import { stripRichTextTags, sanitizeRichTextHtml } from '../../shared/utils/validation';

// Notes are stored as rich-text HTML (Tiptap) — the 2000-character limit
// applies to the visible text a user typed, not the wrapping markup, so the
// raw string is allowed a generous multiple of that for formatting overhead.
// sanitizeRichTextHtml strips any tag/CSS the editor itself would never
// produce, so a direct API request can't store unsupported HTML or CSS.
const notesSchema = z.string()
  .max(12000, 'Notes content is too large.')
  .trim()
  .refine((v) => stripRichTextTags(v).length <= 2000, 'Notes cannot exceed 2000 characters.')
  .transform(sanitizeRichTextHtml)
  .optional();

const createVisitSchema = z.object({
  patientId:      z.string().min(1),
  doctorIds:      z.array(z.string().min(1)).optional(),
  nurseIds:       z.array(z.string().min(1)).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  notes:          notesSchema,
});

// OPD Vitals — recorded only via the Edit form, never at visit creation or
// completion. Every sub-field is independently optional and nullable so a
// caller can send just the one reading they took, or explicitly clear a
// previously-recorded value with `null` — OPDService.updateVisit merges
// whatever arrives here onto the visit's existing vitals rather than
// replacing the whole group. Ranges are generous clinical bounds meant to
// catch fat-fingered entry, not to second-guess a real (if unusual) reading.
const bloodPressureSchema = z.string()
  .trim()
  .regex(/^\d{2,3}\/\d{2,3}$/, 'Blood pressure must be in the format systolic/diastolic, e.g. 120/80.')
  .nullable()
  .optional();

const vitalsSchema = z.object({
  weight:          z.number().min(0.5, 'Weight must be between 0.5 and 500 kg.').max(500, 'Weight must be between 0.5 and 500 kg.').nullable().optional(),
  height:          z.number().min(20, 'Height must be between 20 and 300 cm.').max(300, 'Height must be between 20 and 300 cm.').nullable().optional(),
  bloodPressure:   bloodPressureSchema,
  sugar:           z.number().min(10, 'Sugar must be between 10 and 1000 mg/dL.').max(1000, 'Sugar must be between 10 and 1000 mg/dL.').nullable().optional(),
  bodyTemperature: z.number().min(80, 'Body temperature must be between 80 and 115 °F.').max(115, 'Body temperature must be between 80 and 115 °F.').nullable().optional(),
}).optional();

const updateVisitSchema = z.object({
  doctorIds:      z.array(z.string().min(1)).optional(),
  visitDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD').optional(),
  // No `.min(1)` here (unlike completeVisitSchema below, where a diagnosis is
  // mandatory to finalize a visit) — an OPEN/IN_PROGRESS visit's diagnosis
  // may be intentionally cleared via Edit (e.g. to redo it), and an empty
  // string is how the frontend signals that explicit clear rather than "no
  // change" (see opd/page.tsx's handleUpdate, which always sends this field).
  diagnosis:      z.string().max(2000, 'Diagnosis cannot exceed 2000 characters.').trim().optional(),
  prescription:   z.string().max(5000, 'Prescription cannot exceed 5000 characters.').optional(),
  notes:          notesSchema,
  vitals:         vitalsSchema,
});

const completeVisitSchema = z.object({
  diagnosis:    z.string().min(1, 'Diagnosis is required.').max(2000, 'Diagnosis cannot exceed 2000 characters.').trim(),
  prescription: z.string().max(5000, 'Prescription cannot exceed 5000 characters.').optional(),
  notes:        notesSchema,
});

const queueQuerySchema = z.object({
  date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  doctorId: z.string().optional(),
  search:   z.string().max(200).trim().optional(),
});

const OPD_STATUS_VALUES = ['OPEN', 'COMPLETED'] as const;

const historyQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(50).default(10),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status:    z.enum(OPD_STATUS_VALUES).optional(),
  search:    z.string().max(200).optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) return data.startDate <= data.endDate;
    return true;
  },
  { message: 'startDate must not be after endDate', path: ['startDate'] },
);

function toResponse(v: IOPDVisit) {
  return {
    visitId:        v.visitId,
    tenantId:       v.tenantId,
    patientId:      v.patientId,
    fullName:       v.fullName,
    doctorIds:      v.doctorIds,
    nurseIds:       v.nurseIds ?? [],
    departmentId:   v.departmentId ?? null,
    visitDate:      v.visitDate,
    queueNumber:    v.queueNumber,
    status:         v.status,
    diagnosis:      v.diagnosis,
    prescription:   v.prescription,
    notes:          v.notes,
    // Explicit shape (not a spread of v.vitals) so a Mongoose subdocument
    // never leaks its own internal keys into the API response, and a legacy
    // document hydrated without the field still answers with nulls rather
    // than undefined.
    vitals: {
      weight:          v.vitals?.weight          ?? null,
      height:          v.vitals?.height          ?? null,
      bloodPressure:   v.vitals?.bloodPressure   ?? null,
      sugar:           v.vitals?.sugar           ?? null,
      bodyTemperature: v.vitals?.bodyTemperature ?? null,
    },
    createdAt:      v.createdAt,
    updatedAt:      v.updatedAt,
  };
}

export async function createVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = createVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const visit = await opdService.createVisit(req.user!.tenantId!, body.data, req.user!.userId, req.user!.role);
    res.status(201).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function getQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = queueQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');

    const tenantId = req.user!.tenantId!;
    // Doctors always see only their own visits
    const doctorId = req.user!.role === UserRole.DOCTOR
      ? req.user!.userId
      : query.data.doctorId;
    const nursePatientIds = await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role);
    // Direct visit-level assignment (this visit's own nurseIds) is checked at
    // the query layer via nurseId — see OPDRepository.findByDate — never via
    // nursePatientIds, which is ward-scoped patient-level access only.
    const nurseId = req.user!.role === UserRole.NURSE ? req.user!.userId : undefined;

    const visits = await opdService.getQueue(tenantId, query.data.date, doctorId, query.data.search, nursePatientIds, nurseId);
    res.status(200).json({
      status: 'success',
      data: visits.map((v) => toResponse(v)),
    });
  } catch (err) { next(err); }
}

export async function getVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const visit = await opdService.getVisitById(tenantId, req.params.visitId);

    if (req.user!.role === UserRole.NURSE || req.user!.role === UserRole.DOCTOR) {
      const scopedIds = req.user!.role === UserRole.NURSE
        ? await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role)
        : await opdService.resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role);

      // A Nurse's direct assignment (this exact visit's own nurseIds) is a
      // visit-level grant on top of scopedIds' ward-only patient-level scope
      // — never derived from any other visit for the same patient.
      const isDirectNurseAssignment = req.user!.role === UserRole.NURSE
        && (visit.nurseIds ?? []).includes(req.user!.userId);

      if (!scopedIds?.includes(visit.patientId) && !isDirectNurseAssignment) {
        throw new NotFoundError('OPD visit not found');
      }
    }

    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

// A Nurse's Edit access is notes + vitals only — every other OPD field
// (doctors, department via doctorIds, visit date, diagnosis, prescription) is
// strictly read-only for her, enforced here regardless of what the request
// body contains, not just by the frontend hiding those fields. Vitals are
// otherwise gated purely by the route's role list (DOCTOR, HOSPITAL_ADMIN,
// NURSE) — no other role can reach this endpoint at all, so no further
// per-field check is needed to keep Receptionist/Manager/etc. off vitals.
const NURSE_EDITABLE_FIELDS = new Set(['notes', 'vitals']);

export async function updateVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = updateVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    if (req.user!.role === UserRole.NURSE) {
      const disallowed = Object.keys(body.data).filter((key) => !NURSE_EDITABLE_FIELDS.has(key));
      if (disallowed.length > 0) {
        throw new ForbiddenError('Nurses may only update the notes field for an OPD visit.');
      }
    }

    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.updateVisit(
      tenantId,
      req.params.visitId,
      body.data,
      req.user!.userId,
      req.user!.role,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function completeVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = completeVisitSchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.completeVisit(
      tenantId,
      req.params.visitId,
      body.data,
      req.user!.userId,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function startConsultation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.startConsultation(
      tenantId,
      req.params.visitId,
      req.user!.userId,
      req.user!.role,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

export async function cancelVisit(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId!;
    const scopedPatientIds = await opdService.resolveMutationScopedPatientIds(tenantId, req.user!.userId, req.user!.role);
    const visit = await opdService.cancelVisit(
      tenantId,
      req.params.visitId,
      req.user!.userId,
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: toResponse(visit) });
  } catch (err) { next(err); }
}

// doctorIds is a comma-separated list of currently-selected doctor(s) on the
// New/Edit OPD Visit form — omitted (or empty) before any doctor is chosen,
// in which case validity falls back to the patient's most recent completed
// OPD payment regardless of doctor (see OPDService.getPaymentValidity).
const paymentValidityQuerySchema = z.object({
  doctorIds: z.string().optional(),
});

export async function getPaymentValidity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = paymentValidityQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params');

    const doctorIds = query.data.doctorIds
      ? query.data.doctorIds.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const tenantId = req.user!.tenantId!;
    const result = await opdService.getPaymentValidity(tenantId, req.params.patientId, doctorIds);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getPatientHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = historyQuerySchema.safeParse(req.query);
    if (!query.success) throw new ValidationError('Invalid query params', { errors: query.error.flatten() });

    const tenantId = req.user!.tenantId!;
    const { page, limit, startDate, endDate, status, search } = query.data;
    const scopedPatientIds = (await opdService.resolveNursePatientIds(tenantId, req.user!.userId, req.user!.role))
      ?? (await opdService.resolveDoctorPatientIds(tenantId, req.user!.userId, req.user!.role));
    const result = await opdService.getPatientHistory(
      tenantId,
      req.params.patientId,
      { page, limit, startDate, endDate, status, search },
      scopedPatientIds,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

// GET /api/opd/nurses/available — nurses eligible for OPD duty (excludes
// anyone currently on an IPD ward's roster). Consulted by the New OPD Visit
// form's Assign Nurse dropdown.
export async function getAvailableNurses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const nurses = await opdService.getAvailableOpdNurses(req.user!.tenantId!);
    res.status(200).json({ status: 'success', data: nurses });
  } catch (err) { next(err); }
}

// GET /api/opd/doctors/:doctorId/nurse-assignment — every nurse currently
// mapped to the doctor for OPD duty, so the New OPD Visit form can surface
// "already assigned nurses" when a doctor is selected.
export async function getDoctorNurseAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await opdService.getDoctorNurseAssignments(req.user!.tenantId!, req.params.doctorId);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
