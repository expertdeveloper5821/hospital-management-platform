import { v4 as uuidv4 } from 'uuid';
import { inventoryRepository } from './inventory.repository';
import { IInventoryItem } from './inventory.model';
import {
  CreateInventoryItemInput,
  UpdateStockInput,
  UpdateThresholdInput,
  ListInventoryQuery,
  InventoryItemResponse,
} from './inventory.types';
import { notificationService } from '../notification/notification.service';
import { auditService } from '../../shared/services/audit.service';
import { AuditEntityType, PaginatedResult, UserRole } from '../../shared/types/common.types';
import { AppError, ConflictError, NotFoundError } from '../../shared/middleware/error-handler';

// ─── Helper ───────────────────────────────────────────────────────────────────

function toResponse(doc: IInventoryItem): InventoryItemResponse {
  return {
    itemId:            doc.itemId,
    tenantId:          doc.tenantId,
    name:              doc.name,
    category:          doc.category,
    unit:              doc.unit,
    quantity:          doc.quantity,
    lowStockThreshold: doc.lowStockThreshold,
    description:       doc.description,
    isLowStock:        doc.lowStockThreshold > 0 && doc.quantity < doc.lowStockThreshold,
    createdAt:         doc.createdAt.toISOString(),
    updatedAt:         doc.updatedAt.toISOString(),
  };
}

// ─── InventoryService ─────────────────────────────────────────────────────────

export class InventoryService {
  async createItem(
    input:    CreateInventoryItemInput,
    tenantId: string,
    userId:   string,
  ): Promise<InventoryItemResponse> {
    const doc = await inventoryRepository.save({
      itemId:            uuidv4(),
      tenantId,
      name:              input.name,
      category:          input.category,
      unit:              input.unit,
      quantity:          input.quantity,
      lowStockThreshold: input.lowStockThreshold,
      description:       input.description ?? null,
    });

    try {
      await auditService.log({
        entityType: AuditEntityType.INVENTORY_ITEM,
        entityId:   doc.itemId,
        action:     'CREATE',
        userId,
        tenantId,
        newValue:   { name: input.name, category: input.category, quantity: input.quantity },
      });
    } catch { /* swallow */ }

    return toResponse(doc);
  }

  async updateStock(
    itemId:   string,
    tenantId: string,
    userId:   string,
    input:    UpdateStockInput,
  ): Promise<InventoryItemResponse> {
    const current = await inventoryRepository.findById(itemId, tenantId);
    if (!current) throw new NotFoundError('Inventory item not found');

    const newQuantity = current.quantity + input.quantityChange;
    if (newQuantity < 0) {
      throw new AppError(
        `Stock cannot go negative. Current stock: ${current.quantity}, requested change: ${input.quantityChange}`,
        400,
      );
    }

    const updated = await inventoryRepository.updateStock(itemId, tenantId, input.quantityChange);
    if (!updated) throw new NotFoundError('Inventory item not found');

    // Send low-stock notification when stock drops to or below the threshold
    if (
      updated.lowStockThreshold > 0 &&
      updated.quantity < updated.lowStockThreshold &&
      current.quantity >= current.lowStockThreshold
    ) {
      try {
        await notificationService.sendToRole(
          UserRole.MANAGER,
          tenantId,
          'Low Stock Alert',
          `"${updated.name}" stock is low: ${updated.quantity} ${updated.unit} remaining (threshold: ${updated.lowStockThreshold})`,
          'INVENTORY_ITEM',
          itemId,
        );
        await notificationService.sendToRole(
          UserRole.HOSPITAL_ADMIN,
          tenantId,
          'Low Stock Alert',
          `"${updated.name}" stock is low: ${updated.quantity} ${updated.unit} remaining (threshold: ${updated.lowStockThreshold})`,
          'INVENTORY_ITEM',
          itemId,
        );
      } catch { /* swallow */ }
    }

    try {
      await auditService.log({
        entityType:    AuditEntityType.INVENTORY_ITEM,
        entityId:      itemId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { quantity: current.quantity },
        newValue:      { quantity: updated.quantity, reason: input.reason },
      });
    } catch { /* swallow */ }

    return toResponse(updated);
  }

  async updateThreshold(
    itemId:   string,
    tenantId: string,
    userId:   string,
    input:    UpdateThresholdInput,
  ): Promise<InventoryItemResponse> {
    const current = await inventoryRepository.findById(itemId, tenantId);
    if (!current) throw new NotFoundError('Inventory item not found');

    const updated = await inventoryRepository.updateThreshold(
      itemId,
      tenantId,
      input.lowStockThreshold,
    );
    if (!updated) throw new NotFoundError('Inventory item not found');

    try {
      await auditService.log({
        entityType:    AuditEntityType.INVENTORY_ITEM,
        entityId:      itemId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: { lowStockThreshold: current.lowStockThreshold },
        newValue:      { lowStockThreshold: updated.lowStockThreshold },
      });
    } catch { /* swallow */ }

    return toResponse(updated);
  }

  async listItems(
    tenantId: string,
    query:    ListInventoryQuery,
  ): Promise<PaginatedResult<InventoryItemResponse>> {
    const result = await inventoryRepository.findAll(tenantId, query);
    return { ...result, data: result.data.map(toResponse) };
  }

  async getItemById(itemId: string, tenantId: string): Promise<InventoryItemResponse> {
    const doc = await inventoryRepository.findById(itemId, tenantId);
    if (!doc) throw new NotFoundError('Inventory item not found');
    return toResponse(doc);
  }
}

export const inventoryService = new InventoryService();
