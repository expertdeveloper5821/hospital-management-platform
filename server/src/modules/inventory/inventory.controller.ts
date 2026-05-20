import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { inventoryService } from './inventory.service';
import {
  CreateInventoryItemSchema,
  UpdateStockSchema,
  UpdateThresholdSchema,
  ListInventoryQuerySchema,
} from './inventory.types';

const itemIdSchema = z.string().uuid('itemId must be a valid UUID');

export async function createInventoryItem(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = CreateInventoryItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
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
      res.status(400).json({
        status:  'error',
        message: 'Invalid query parameters',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
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
    const id = itemIdSchema.safeParse(req.params['itemId']);
    if (!id.success) {
      res.status(400).json({ status: 'error', message: 'Invalid itemId format' });
      return;
    }
    const result = await inventoryService.getItemById(id.data, req.user!.tenantId as string);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}

export async function updateStock(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = itemIdSchema.safeParse(req.params['itemId']);
    if (!id.success) {
      res.status(400).json({ status: 'error', message: 'Invalid itemId format' });
      return;
    }
    const parsed = UpdateStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const result = await inventoryService.updateStock(
      id.data,
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
    const id = itemIdSchema.safeParse(req.params['itemId']);
    if (!id.success) {
      res.status(400).json({ status: 'error', message: 'Invalid itemId format' });
      return;
    }
    const parsed = UpdateThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        status:  'error',
        message: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
      return;
    }
    const result = await inventoryService.updateThreshold(
      id.data,
      req.user!.tenantId as string,
      req.user!.userId,
      parsed.data,
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
}
