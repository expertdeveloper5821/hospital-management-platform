import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { staffDocumentService } from './staff-documents.service';
import { DocumentCategory } from './staff-documents.model';
import { ValidationError } from '../../shared/middleware/error-handler';

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 + 1 },
});

export const uploadMiddleware = upload.single('file');

const uploadBodySchema = z.object({
  category:     z.enum(Object.values(DocumentCategory) as [string, ...string[]]),
  documentName: z.string().min(1).max(200),
});

export async function uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw new ValidationError('No file uploaded');

    const body = uploadBodySchema.safeParse(req.body);
    if (!body.success) throw new ValidationError('Invalid request', { errors: body.error.flatten() });

    const { document, presignedUrl } = await staffDocumentService.uploadDocument(
      req.user!.tenantId!,
      req.params.userId,
      req.file,
      {
        category:     body.data.category as typeof DocumentCategory[keyof typeof DocumentCategory],
        documentName: body.data.documentName,
      },
      req.user!.userId,
    );

    res.status(201).json({ status: 'success', data: { ...document.toObject(), presignedUrl } });
  } catch (err) { next(err); }
}

export async function listDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const docs = await staffDocumentService.listDocuments(
      req.user!.tenantId!,
      req.params.userId,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: docs });
  } catch (err) { next(err); }
}

export async function getOnboardingChecklist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checklist = await staffDocumentService.getOnboardingChecklist(
      req.user!.tenantId!,
      req.params.userId,
    );
    res.status(200).json({ status: 'success', data: checklist });
  } catch (err) { next(err); }
}

export async function softDeleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const doc = await staffDocumentService.softDeleteDocument(
      req.user!.tenantId!,
      req.params.documentId,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: doc });
  } catch (err) { next(err); }
}
