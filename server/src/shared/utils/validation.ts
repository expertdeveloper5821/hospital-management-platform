import { z } from 'zod';

/**
 * Validates a MongoDB ObjectId string (24-character hex).
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

/**
 * Validates the custom Patient ID format (PAT-XXXXXXXX).
 */
export const patientIdSchema = z
  .string()
  .regex(/^PAT-[0-9A-Z]{8}$/, 'Invalid Patient ID format');

/**
 * Validates a UUID v4 string.
 */
export const uuidSchema = z.string().uuid('Invalid UUID format');

/**
 * Common schema for pagination query parameters.
 */
export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Common schema for search query parameters.
 */
export const searchSchema = paginationSchema.extend({
  q: z.string().max(100).optional(),
});
