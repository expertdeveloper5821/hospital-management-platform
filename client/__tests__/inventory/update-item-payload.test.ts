import { buildUpdateInventoryItemPayload } from '@/app/(dashboard)/inventory/update-item-payload';
import type { InventoryItemResponse, UpdateInventoryItemRequest } from '@/store/types';

const item: InventoryItemResponse = {
  itemId:            'item-001',
  tenantId:          'tenant-001',
  name:              'Legacy item',
  category:          'Legacy Category',
  unit:              'box',
  quantity:          10,
  lowStockThreshold: 2,
  description:       'Old description',
  isLowStock:        false,
  createdAt:         '2026-01-01T00:00:00.000Z',
  updatedAt:         '2026-01-01T00:00:00.000Z',
};

describe('buildUpdateInventoryItemPayload', () => {
  test('omits category when an unchanged legacy category is submitted', () => {
    const form: UpdateInventoryItemRequest = {
      name:              ' Legacy item updated ',
      category:          'Legacy Category',
      unit:              ' box ',
      lowStockThreshold: 3,
      description:       ' Updated description ',
    };

    const payload = buildUpdateInventoryItemPayload(item, form);

    expect(payload).toEqual({
      itemId:            'item-001',
      name:              'Legacy item updated',
      unit:              'box',
      lowStockThreshold: 3,
      description:       'Updated description',
    });
    expect(payload).not.toHaveProperty('category');
  });

  test('includes category when the user changes it', () => {
    const form: UpdateInventoryItemRequest = {
      name:              'Legacy item',
      category:          'Equipment',
      unit:              'box',
      lowStockThreshold: 2,
      description:       '',
    };

    expect(buildUpdateInventoryItemPayload(item, form)).toEqual(
      expect.objectContaining({ category: 'Equipment', description: null }),
    );
  });
});
