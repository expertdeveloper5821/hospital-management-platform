import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { inventoryService } from './inventory.service';
import {
  CreateInventoryItemSchema,
  UpdateStockSchema,
  UpdateThresholdSchema,
  UpdateInventoryItemSchema,
  ListInventoryQuerySchema,
} from './inventory.types';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType } from '../../shared/types/common.types';
import { uuidSchema } from '../../shared/utils/validation';
import { ValidationError } from '../../shared/middleware/error-handler';

const itemIdParamSchema = z.object({
  itemId: uuidSchema,
});

export async function createInventoryItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateInventoryItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', { errors: parsed.error.flatten().fieldErrors });
    }
    const result = await inventoryService.createItem(
      parsed.data,
      req.user!.tenantId as string,
      req.user!.userId,
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function listInventoryItems(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = ListInventoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', { errors: parsed.error.flatten().fieldErrors });
    }
    const result = await inventoryService.listItems(
      req.user!.tenantId as string,
      parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function getInventoryItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    const result = await inventoryService.getItemById(itemId, req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function updateStock(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    const parsed = UpdateStockSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', { errors: parsed.error.flatten().fieldErrors });
    }
    const result = await inventoryService.updateStock(
      itemId,
      req.user!.tenantId as string,
      req.user!.userId,
      parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function updateThreshold(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    const parsed = UpdateThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', { errors: parsed.error.flatten().fieldErrors });
    }
    const result = await inventoryService.updateThreshold(
      itemId,
      req.user!.tenantId as string,
      req.user!.userId,
      parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function updateInventoryItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    if (Object.prototype.hasOwnProperty.call(req.body, 'quantity')) {
      throw new ValidationError('quantity cannot be changed via this endpoint; use PATCH /:itemId/stock');
    }
    const parsed = UpdateInventoryItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', { errors: parsed.error.flatten().fieldErrors });
    }
    const result = await inventoryService.updateMetadata(
      itemId,
      req.user!.tenantId as string,
      req.user!.userId,
      parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function deleteInventoryItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    await inventoryService.softDelete(
      itemId,
      req.user!.tenantId as string,
      req.user!.userId,
    );
    res.status(200).json({ status: 'success', data: { message: 'Item deleted successfully' } });
  } catch (err) { next(err); }
}

const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export async function getStockHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { itemId } = itemIdParamSchema.parse(req.params);
    const { page } = pageQuerySchema.parse(req.query);
    const LIMIT = 20;

    // Verify item exists in this tenant
    const item = await inventoryService.getItemById(itemId, req.user!.tenantId as string);
    if (!item) {
      res.status(404).json({ status: 'error', message: 'Inventory item not found' });
      return;
    }

    const result = await auditService.queryLogs(req.user!.tenantId as string, {
      entityType: AuditEntityType.INVENTORY_ITEM,
      entityId:   itemId,
      page,
      limit:      LIMIT,
    });

    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
