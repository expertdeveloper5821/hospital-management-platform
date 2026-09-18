import { v4 as uuidv4 } from 'uuid';
import { inventoryRepository } from './inventory.repository';
import { IInventoryItem } from './inventory.model';
import {
  CreateInventoryItemInput,
  UpdateStockInput,
  UpdateThresholdInput,
  UpdateInventoryItemInput,
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
  private async notifyLowStockIfCrossed(
    wasLowStock:   boolean,
    isNowLowStock: boolean,
    updated:       IInventoryItem,
    itemId:        string,
    tenantId:      string,
  ): Promise<void> {
    if (wasLowStock || !isNowLowStock) return;
    try {
      const message = `"${updated.name}" stock is low: ${updated.quantity} ${updated.unit} remaining (threshold: ${updated.lowStockThreshold})`;
      await notificationService.sendToRole(UserRole.MANAGER, tenantId, 'Low Stock Alert', message, 'INVENTORY_ITEM', itemId);
      await notificationService.sendToRole(UserRole.HOSPITAL_ADMIN, tenantId, 'Low Stock Alert', message, 'INVENTORY_ITEM', itemId);
      await notificationService.sendToRole(UserRole.ADMIN, tenantId, 'Low Stock Alert', message, 'INVENTORY_ITEM', itemId);
    } catch { /* swallow */ }
  }

  // Persists the low-stock-crossing timestamp whenever the boundary actually
  // changed: stamps "now" the moment an item newly drops below its threshold,
  // clears it back to null once restocked above it. No-op (returns `updated`
  // unchanged) when the low-stock status didn't change on this write.
  private async syncLowStockSince(
    wasLowStock:   boolean,
    isNowLowStock: boolean,
    updated:       IInventoryItem,
    itemId:        string,
    tenantId:      string,
  ): Promise<IInventoryItem> {
    if (wasLowStock === isNowLowStock) return updated;
    const synced = await inventoryRepository.setLowStockSince(itemId, tenantId, isNowLowStock ? new Date() : null);
    return synced ?? updated;
  }

  async createItem(
    input:    CreateInventoryItemInput,
    tenantId: string,
    userId:   string,
  ): Promise<InventoryItemResponse> {
    const isLowAtCreation = input.lowStockThreshold > 0 && input.quantity < input.lowStockThreshold;
    const doc = await inventoryRepository.save({
      itemId:            uuidv4(),
      tenantId,
      name:              input.name,
      category:          input.category,
      unit:              input.unit,
      quantity:          input.quantity,
      lowStockThreshold: input.lowStockThreshold,
      lowStockSince:     isLowAtCreation ? new Date() : null,
      description:       input.description ?? null,
    });

    // A brand new item can be created already below its own threshold — there's
    // no "previous" state to cross from, so notify directly off the current one.
    await this.notifyLowStockIfCrossed(
      false,
      isLowAtCreation,
      doc,
      doc.itemId,
      tenantId,
    );

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

    let updated = await inventoryRepository.updateStock(itemId, tenantId, input.quantityChange);
    if (!updated) throw new NotFoundError('Inventory item not found');

    const wasLowStock   = current.lowStockThreshold > 0 && current.quantity < current.lowStockThreshold;
    const isNowLowStock = updated.lowStockThreshold > 0 && updated.quantity < updated.lowStockThreshold;

    // Send low-stock notification when stock drops to or below the threshold
    await this.notifyLowStockIfCrossed(wasLowStock, isNowLowStock, updated, itemId, tenantId);
    updated = await this.syncLowStockSince(wasLowStock, isNowLowStock, updated, itemId, tenantId);

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

    let updated = await inventoryRepository.updateThreshold(
      itemId,
      tenantId,
      input.lowStockThreshold,
    );
    if (!updated) throw new NotFoundError('Inventory item not found');

    const wasLowStock   = current.lowStockThreshold > 0 && current.quantity < current.lowStockThreshold;
    const isNowLowStock = updated.lowStockThreshold > 0 && updated.quantity < updated.lowStockThreshold;

    // Raising the threshold (or lowering stock elsewhere) can newly cross the
    // low-stock boundary — this endpoint previously never checked for that.
    await this.notifyLowStockIfCrossed(wasLowStock, isNowLowStock, updated, itemId, tenantId);
    updated = await this.syncLowStockSince(wasLowStock, isNowLowStock, updated, itemId, tenantId);

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

  async updateMetadata(
    itemId:   string,
    tenantId: string,
    userId:   string,
    input:    UpdateInventoryItemInput,
  ): Promise<InventoryItemResponse> {
    const current = await inventoryRepository.findById(itemId, tenantId);
    if (!current) throw new NotFoundError('Inventory item not found');

    let updated = await inventoryRepository.updateMetadata(itemId, tenantId, input);
    if (!updated) throw new NotFoundError('Inventory item not found');

    const wasLowStock   = current.lowStockThreshold > 0 && current.quantity < current.lowStockThreshold;
    const isNowLowStock = updated.lowStockThreshold > 0 && updated.quantity < updated.lowStockThreshold;

    // Trigger low-stock notification when raising threshold causes item to cross the boundary
    await this.notifyLowStockIfCrossed(wasLowStock, isNowLowStock, updated, itemId, tenantId);
    updated = await this.syncLowStockSince(wasLowStock, isNowLowStock, updated, itemId, tenantId);

    try {
      await auditService.log({
        entityType:    AuditEntityType.INVENTORY_ITEM,
        entityId:      itemId,
        action:        'UPDATE',
        userId,
        tenantId,
        previousValue: {
          name:              current.name,
          category:          current.category,
          unit:              current.unit,
          lowStockThreshold: current.lowStockThreshold,
          description:       current.description,
        },
        newValue: input as Record<string, unknown>,
      });
    } catch { /* swallow */ }

    return toResponse(updated);
  }

  async softDelete(
    itemId:   string,
    tenantId: string,
    userId:   string,
  ): Promise<void> {
    const current = await inventoryRepository.findById(itemId, tenantId);
    if (!current) throw new NotFoundError('Inventory item not found');

    await inventoryRepository.softDelete(itemId, tenantId);

    try {
      await auditService.log({
        entityType:    AuditEntityType.INVENTORY_ITEM,
        entityId:      itemId,
        action:        'DELETE',
        userId,
        tenantId,
        previousValue: { name: current.name, category: current.category, quantity: current.quantity },
      });
    } catch { /* swallow */ }
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
