import { InventoryItemModel, IInventoryItem } from './inventory.model';
import { ListInventoryQuery } from './inventory.types';
import { PaginatedResult } from '../../shared/types/common.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class InventoryRepository {
  async findById(itemId: string, tenantId: string): Promise<IInventoryItem | null> {
    assertDbConnected();
    return InventoryItemModel.findOne({ itemId, tenantId });
  }

  async findAll(
    tenantId: string,
    query:    ListInventoryQuery,
  ): Promise<PaginatedResult<IInventoryItem>> {
    assertDbConnected();
    const { category, lowStock, page, limit } = query;
    const skip   = (page - 1) * limit;
    const filter: Record<string, unknown> = { tenantId };
    if (category) filter['category'] = category;

    let q = InventoryItemModel.find(filter);

    // lowStock filter: items where quantity < lowStockThreshold and threshold > 0
    if (lowStock === true) {
      q = InventoryItemModel.find({
        ...filter,
        $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] },
      });
    }

    const [data, total] = await Promise.all([
      q.sort({ name: 1 }).skip(skip).limit(limit),
      InventoryItemModel.countDocuments(lowStock === true
        ? {
            ...filter,
            $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] },
          }
        : filter),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async save(data: Partial<IInventoryItem>): Promise<IInventoryItem> {
    assertDbConnected();
    return InventoryItemModel.create(data);
  }

  // Atomically apply a quantityChange and return the updated document.
  // Uses $inc to avoid race conditions; Mongoose min:0 constraint prevents negative.
  async updateStock(
    itemId:         string,
    tenantId:       string,
    quantityChange: number,
  ): Promise<IInventoryItem | null> {
    assertDbConnected();
    return InventoryItemModel.findOneAndUpdate(
      { itemId, tenantId },
      { $inc: { quantity: quantityChange } },
      { new: true, runValidators: true },
    );
  }

  async updateThreshold(
    itemId:            string,
    tenantId:          string,
    lowStockThreshold: number,
  ): Promise<IInventoryItem | null> {
    assertDbConnected();
    return InventoryItemModel.findOneAndUpdate(
      { itemId, tenantId },
      { $set: { lowStockThreshold } },
      { new: true },
    );
  }
}

export const inventoryRepository = new InventoryRepository();
