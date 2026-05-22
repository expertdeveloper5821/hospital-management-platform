import { z } from 'zod';

// ─── LabRequestStatus ─────────────────────────────────────────────────────────
export const LabRequestStatus = {
  PENDING:     'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED:   'COMPLETED',
} as const;

export type LabRequestStatus = typeof LabRequestStatus[keyof typeof LabRequestStatus];

// ─── Pathology Schemas ────────────────────────────────────────────────────────
export const CreatePathologyRequestSchema = z.object({
  patientId: z.string().min(1, 'patientId is required'),
  testType:  z.string().min(1, 'testType is required').max(200).trim(),
  notes:     z.string().max(2000).trim().optional(),
});

export type CreatePathologyRequestInput = z.infer<typeof CreatePathologyRequestSchema>;

// ─── Radiology Schemas ────────────────────────────────────────────────────────
export const CreateRadiologyRequestSchema = z.object({
  patientId:   z.string().min(1, 'patientId is required'),
  imagingType: z.string().min(1, 'imagingType is required').max(200).trim(),
  notes:       z.string().max(2000).trim().optional(),
});

export type CreateRadiologyRequestInput = z.infer<typeof CreateRadiologyRequestSchema>;

// ─── Status update ────────────────────────────────────────────────────────────
export const UpdateLabStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
});

export type UpdateLabStatusInput = z.infer<typeof UpdateLabStatusSchema>;

// ─── List query ───────────────────────────────────────────────────────────────
export const ListLabRequestsQuerySchema = z.object({
  patientId: z.string().min(1).optional(),
  status:    z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

export type ListLabRequestsQuery = z.infer<typeof ListLabRequestsQuerySchema>;

// ─── Response shapes ──────────────────────────────────────────────────────────
// reportUrl is a fresh pre-signed S3 URL generated at response time (null when no report yet).
export interface PathologyRequestResponse {
  requestId:   string;
  patientId:   string;
  patientName: string;
  tenantId:    string;
  requestedBy: string;
  testType:    string;
  status:      LabRequestStatus;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
}

export interface RadiologyRequestResponse {
  requestId:   string;
  patientId:   string;
  patientName: string;
  tenantId:    string;
  requestedBy: string;
  imagingType: string;
  status:      LabRequestStatus;
  notes:       string | null;
  reportUrl:   string | null;
  requestedAt: string;
  updatedAt:   string;
}

// ─── File size limits (bytes) ─────────────────────────────────────────────────
export const PATHOLOGY_REPORT_MAX_BYTES  = 10 * 1024 * 1024; // 10 MB
export const RADIOLOGY_REPORT_MAX_BYTES  = 20 * 1024 * 1024; // 20 MB
