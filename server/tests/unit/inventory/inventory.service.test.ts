jest.mock('../../../src/modules/inventory/inventory.repository');
jest.mock('../../../src/modules/notification/notification.service');
jest.mock('../../../src/shared/services/audit.service');

import { inventoryRepository } from '../../../src/modules/inventory/inventory.repository';
import { notificationService } from '../../../src/modules/notification/notification.service';
import { InventoryService }    from '../../../src/modules/inventory/inventory.service';
import { IInventoryItem }      from '../../../src/modules/inventory/inventory.model';

const mockRepo    = inventoryRepository as jest.Mocked<typeof inventoryRepository>;
const mockNotifSvc = notificationService as jest.Mocked<typeof notificationService>;

const TENANT = 'tenant-001';
const ADMIN  = 'admin-001';

function makeItem(overrides: Partial<IInventoryItem> = {}): IInventoryItem {
  return {
    itemId:            'item-001',
    tenantId:          TENANT,
    name:              'Paracetamol 500mg',
    category:          'Medication',
    unit:              'tablets',
    quantity:          100,
    lowStockThreshold: 20,
    description:       null,
    createdAt:         new Date(),
    updatedAt:         new Date(),
    ...overrides,
  } as unknown as IInventoryItem;
}

describe('InventoryService — createItem', () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService();
  });

  test('creates and returns an inventory item', async () => {
    mockRepo.save = jest.fn().mockResolvedValue(makeItem());

    const result = await service.createItem(
      { name: 'Paracetamol 500mg', category: 'Medication', unit: 'tablets', quantity: 100, lowStockThreshold: 20 },
      TENANT,
      ADMIN,
    );

    expect(result.name).toBe('Paracetamol 500mg');
    expect(result.quantity).toBe(100);
    expect(result.isLowStock).toBe(false);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });

  test('isLowStock is true when initial quantity is below threshold', async () => {
    mockRepo.save = jest.fn().mockResolvedValue(
      makeItem({ quantity: 5, lowStockThreshold: 20 }),
    );

    const result = await service.createItem(
      { name: 'Saline Solution', category: 'Fluids', unit: 'bags', quantity: 5, lowStockThreshold: 20 },
      TENANT,
      ADMIN,
    );

    expect(result.isLowStock).toBe(true);
  });
});

describe('InventoryService — updateStock', () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService();
    mockNotifSvc.sendToRole = jest.fn().mockResolvedValue(undefined);
  });

  test('rejects a quantityChange that would make stock negative', async () => {
    mockRepo.findById = jest.fn().mockResolvedValue(makeItem({ quantity: 10 }));

    await expect(
      service.updateStock('item-001', TENANT, ADMIN, { quantityChange: -11, reason: 'dispense' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('negative'),
    });

    expect(mockRepo.updateStock).not.toHaveBeenCalled();
  });

  test('rejects when resulting quantity would be exactly negative', async () => {
    mockRepo.findById = jest.fn().mockResolvedValue(makeItem({ quantity: 5 }));

    await expect(
      service.updateStock('item-001', TENANT, ADMIN, { quantityChange: -6, reason: 'dispense' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('allows exact depletion to zero', async () => {
    const afterUpdate = makeItem({ quantity: 0 });
    mockRepo.findById    = jest.fn().mockResolvedValue(makeItem({ quantity: 10 }));
    mockRepo.updateStock = jest.fn().mockResolvedValue(afterUpdate);

    const result = await service.updateStock(
      'item-001', TENANT, ADMIN, { quantityChange: -10, reason: 'dispense' },
    );

    expect(result.quantity).toBe(0);
    expect(mockRepo.updateStock).toHaveBeenCalledWith('item-001', TENANT, -10);
  });

  test('sends low-stock notification when stock crosses threshold boundary', async () => {
    // Before: quantity = 21 (above threshold 20); after: quantity = 19 (below threshold)
    const before = makeItem({ quantity: 21, lowStockThreshold: 20 });
    const after  = makeItem({ quantity: 19, lowStockThreshold: 20 });

    mockRepo.findById    = jest.fn().mockResolvedValue(before);
    mockRepo.updateStock = jest.fn().mockResolvedValue(after);

    await service.updateStock('item-001', TENANT, ADMIN, { quantityChange: -2, reason: 'dispense' });

    expect(mockNotifSvc.sendToRole).toHaveBeenCalledWith(
      'MANAGER',
      TENANT,
      expect.stringContaining('Low Stock'),
      expect.any(String),
      'INVENTORY_ITEM',
      'item-001',
    );
  });

  test('does NOT send notification when stock was already below threshold', async () => {
    // Before: already at 15 (< threshold 20); after: 13 — already low, no crossing event
    const before = makeItem({ quantity: 15, lowStockThreshold: 20 });
    const after  = makeItem({ quantity: 13, lowStockThreshold: 20 });

    mockRepo.findById    = jest.fn().mockResolvedValue(before);
    mockRepo.updateStock = jest.fn().mockResolvedValue(after);

    await service.updateStock('item-001', TENANT, ADMIN, { quantityChange: -2, reason: 'dispense' });

    expect(mockNotifSvc.sendToRole).not.toHaveBeenCalled();
  });

  test('does NOT send notification when threshold is zero', async () => {
    const before = makeItem({ quantity: 5, lowStockThreshold: 0 });
    const after  = makeItem({ quantity: 3, lowStockThreshold: 0 });

    mockRepo.findById    = jest.fn().mockResolvedValue(before);
    mockRepo.updateStock = jest.fn().mockResolvedValue(after);

    await service.updateStock('item-001', TENANT, ADMIN, { quantityChange: -2, reason: 'dispense' });

    expect(mockNotifSvc.sendToRole).not.toHaveBeenCalled();
  });

  test('allows stock additions (positive quantityChange)', async () => {
    const after = makeItem({ quantity: 150 });
    mockRepo.findById    = jest.fn().mockResolvedValue(makeItem({ quantity: 100 }));
    mockRepo.updateStock = jest.fn().mockResolvedValue(after);

    const result = await service.updateStock(
      'item-001', TENANT, ADMIN, { quantityChange: 50, reason: 'restock' },
    );

    expect(result.quantity).toBe(150);
  });
});

describe('InventoryService — updateThreshold', () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService();
  });

  test('updates the low-stock threshold', async () => {
    const before = makeItem({ lowStockThreshold: 20 });
    const after  = makeItem({ lowStockThreshold: 30 });

    mockRepo.findById         = jest.fn().mockResolvedValue(before);
    mockRepo.updateThreshold  = jest.fn().mockResolvedValue(after);

    const result = await service.updateThreshold(
      'item-001', TENANT, ADMIN, { lowStockThreshold: 30 },
    );

    expect(result.lowStockThreshold).toBe(30);
    expect(mockRepo.updateThreshold).toHaveBeenCalledWith('item-001', TENANT, 30);
  });

  test('throws NotFoundError for unknown item', async () => {
    mockRepo.findById = jest.fn().mockResolvedValue(null);

    await expect(
      service.updateThreshold('no-such-item', TENANT, ADMIN, { lowStockThreshold: 10 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('InventoryService — updateMetadata', () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService();
    mockNotifSvc.sendToRole = jest.fn().mockResolvedValue(undefined);
  });

  test('updates metadata fields and returns updated item', async () => {
    const before  = makeItem({ name: 'Old Name', category: 'Old Cat' });
    const updated = makeItem({ name: 'New Name', category: 'New Cat' });

    mockRepo.findById        = jest.fn().mockResolvedValue(before);
    mockRepo.updateMetadata  = jest.fn().mockResolvedValue(updated);

    const result = await service.updateMetadata(
      'item-001', TENANT, ADMIN,
      { name: 'New Name', category: 'New Cat' },
    );

    expect(result.name).toBe('New Name');
    expect(result.category).toBe('New Cat');
    expect(mockRepo.updateMetadata).toHaveBeenCalledWith('item-001', TENANT, { name: 'New Name', category: 'New Cat' });
  });

  test('throws NotFoundError when item does not exist', async () => {
    mockRepo.findById = jest.fn().mockResolvedValue(null);

    await expect(
      service.updateMetadata('no-item', TENANT, ADMIN, { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockRepo.updateMetadata).not.toHaveBeenCalled();
  });

  test('sends low-stock notification when raising threshold causes boundary crossing', async () => {
    // Before: qty=50 threshold=20 (not low); After: qty=50 threshold=60 (now low)
    const before  = makeItem({ quantity: 50, lowStockThreshold: 20 });
    const updated = makeItem({ quantity: 50, lowStockThreshold: 60 });

    mockRepo.findById        = jest.fn().mockResolvedValue(before);
    mockRepo.updateMetadata  = jest.fn().mockResolvedValue(updated);

    await service.updateMetadata('item-001', TENANT, ADMIN, { lowStockThreshold: 60 });

    expect(mockNotifSvc.sendToRole).toHaveBeenCalledWith(
      'MANAGER',
      TENANT,
      expect.stringContaining('Low Stock'),
      expect.any(String),
      'INVENTORY_ITEM',
      'item-001',
    );
  });

  test('does NOT send notification when item was already low-stock before update', async () => {
    // Before: qty=10 threshold=20 (already low); After: qty=10 threshold=30 (still low)
    const before  = makeItem({ quantity: 10, lowStockThreshold: 20 });
    const updated = makeItem({ quantity: 10, lowStockThreshold: 30 });

    mockRepo.findById        = jest.fn().mockResolvedValue(before);
    mockRepo.updateMetadata  = jest.fn().mockResolvedValue(updated);

    await service.updateMetadata('item-001', TENANT, ADMIN, { lowStockThreshold: 30 });

    expect(mockNotifSvc.sendToRole).not.toHaveBeenCalled();
  });

  test('does NOT send notification when threshold is lowered', async () => {
    const before  = makeItem({ quantity: 50, lowStockThreshold: 60 });
    const updated = makeItem({ quantity: 50, lowStockThreshold: 10 });

    mockRepo.findById        = jest.fn().mockResolvedValue(before);
    mockRepo.updateMetadata  = jest.fn().mockResolvedValue(updated);

    await service.updateMetadata('item-001', TENANT, ADMIN, { lowStockThreshold: 10 });

    expect(mockNotifSvc.sendToRole).not.toHaveBeenCalled();
  });
});

describe('InventoryService — softDelete', () => {
  let service: InventoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InventoryService();
  });

  test('soft-deletes an existing item', async () => {
    mockRepo.findById   = jest.fn().mockResolvedValue(makeItem());
    mockRepo.softDelete = jest.fn().mockResolvedValue(makeItem({ isDeleted: true }));

    await expect(service.softDelete('item-001', TENANT, ADMIN)).resolves.toBeUndefined();
    expect(mockRepo.softDelete).toHaveBeenCalledWith('item-001', TENANT);
  });

  test('throws NotFoundError when item does not exist', async () => {
    mockRepo.findById = jest.fn().mockResolvedValue(null);

    await expect(
      service.softDelete('no-item', TENANT, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockRepo.softDelete).not.toHaveBeenCalled();
  });
});
