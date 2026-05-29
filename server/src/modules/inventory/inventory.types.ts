import { z } from 'zod';

// ─── Create Item ──────────────────────────────────────────────────────────────
export const CreateInventoryItemSchema = z.object({
  name:              z.string().min(1, 'name is required').max(200).trim(),
  category:          z.string().min(1, 'category is required').max(100).trim(),
  unit:              z.string().min(1, 'unit is required').max(50).trim(),
  quantity:          z.number().int().min(0, 'Initial quantity cannot be negative'),
  lowStockThreshold: z.number().int().min(0, 'Threshold cannot be negative'),
  description:       z.string().max(1000).trim().optional(),
});

export type CreateInventoryItemInput = z.infer<typeof CreateInventoryItemSchema>;

// ─── Update Stock ─────────────────────────────────────────────────────────────
export const UpdateStockSchema = z.object({
  quantityChange: z
    .number()
    .int('quantityChange must be an integer')
    .refine((v) => v !== 0, { message: 'quantityChange must be non-zero' }),
  reason: z.string().min(1, 'reason is required').max(500).trim(),
});

export type UpdateStockInput = z.infer<typeof UpdateStockSchema>;

// ─── Update Item Metadata ─────────────────────────────────────────────────────
export const UpdateInventoryItemSchema = z.object({
  name:              z.string().min(1).max(200).trim().optional(),
  category:          z.string().min(1).max(100).trim().optional(),
  unit:              z.string().min(1).max(50).trim().optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  description:       z.string().max(1000).trim().nullable().optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided' },
);

export type UpdateInventoryItemInput = z.infer<typeof UpdateInventoryItemSchema>;

// ─── Update Threshold ─────────────────────────────────────────────────────────
export const UpdateThresholdSchema = z.object({
  lowStockThreshold: z.number().int().min(0, 'Threshold cannot be negative'),
});

export type UpdateThresholdInput = z.infer<typeof UpdateThresholdSchema>;

// ─── List query ───────────────────────────────────────────────────────────────
export const ListInventoryQuerySchema = z.object({
  category:  z.string().min(1).optional(),
  lowStock:  z.coerce.boolean().optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(20),
});

export type ListInventoryQuery = z.infer<typeof ListInventoryQuerySchema>;

// ─── Response shape ───────────────────────────────────────────────────────────
export interface InventoryItemResponse {
  itemId:            string;
  tenantId:          string;
  name:              string;
  category:          string;
  unit:              string;
  quantity:          number;
  lowStockThreshold: number;
  description:       string | null;
  isLowStock:        boolean;
  createdAt:         string;
  updatedAt:         string;
}
