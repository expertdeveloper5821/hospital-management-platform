import type { InventoryItemResponse, UpdateInventoryItemRequest } from '@/store/types';

export function buildUpdateInventoryItemPayload(
  item: InventoryItemResponse,
  form: UpdateInventoryItemRequest,
): { itemId: string } & UpdateInventoryItemRequest {
  const payload: { itemId: string } & UpdateInventoryItemRequest = {
    itemId:            item.itemId,
    name:              form.name?.trim(),
    unit:              form.unit?.trim(),
    lowStockThreshold: form.lowStockThreshold,
    description:       form.description?.trim() || null,
  };

  const category = form.category?.trim();
  if (category !== item.category) {
    payload.category = category;
  }

  return payload;
}
