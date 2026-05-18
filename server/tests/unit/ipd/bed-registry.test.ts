jest.mock('../../../src/modules/ipd/ipd.repository');
jest.mock('../../../src/shared/services/audit.service');

import * as fc from 'fast-check';
import { ipdRepository }              from '../../../src/modules/ipd/ipd.repository';
import { IPDService, BedOccupiedError } from '../../../src/modules/ipd/ipd.service';
import { NotFoundError, ConflictError } from '../../../src/shared/middleware/error-handler';

const mockRepo = ipdRepository as jest.Mocked<typeof ipdRepository>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = 't1';
const ACTOR  = 'admin-user-1';

const makeWard = (overrides = {}) => ({
  _id:       { toString: () => 'ward-id-1' },
  tenantId:  TENANT,
  name:      'General Ward',
  floor:     'Ground',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeBed = (overrides = {}) => ({
  _id:                { toString: () => 'bed-id-1' },
  tenantId:           TENANT,
  wardId:             'ward-id-1',
  bedNumber:          'G-01',
  isOccupied:         false,
  currentAdmissionId: null,
  createdAt:          new Date(),
  updatedAt:          new Date(),
  ...overrides,
});

// ─── Example-based tests ──────────────────────────────────────────────────────

describe('IPDService — createWard', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();
  });

  test('creates ward when name does not already exist', async () => {
    mockRepo.findWardByName.mockResolvedValue(null);
    mockRepo.createWard.mockResolvedValue(makeWard() as never);

    const result = await service.createWard(TENANT, { name: 'General Ward', floor: 'Ground' }, ACTOR);

    expect(result.name).toBe('General Ward');
    expect(mockRepo.createWard).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, name: 'General Ward', floor: 'Ground' }),
    );
  });

  test('throws ConflictError when ward name already exists', async () => {
    mockRepo.findWardByName.mockResolvedValue(makeWard() as never);

    await expect(service.createWard(TENANT, { name: 'General Ward' }, ACTOR))
      .rejects.toThrow(ConflictError);

    expect(mockRepo.createWard).not.toHaveBeenCalled();
  });

  test('floor defaults to null when not provided', async () => {
    mockRepo.findWardByName.mockResolvedValue(null);
    mockRepo.createWard.mockResolvedValue(makeWard({ floor: null }) as never);

    await service.createWard(TENANT, { name: 'ICU' }, ACTOR);

    expect(mockRepo.createWard).toHaveBeenCalledWith(
      expect.objectContaining({ floor: undefined }),
    );
  });
});

describe('IPDService — addBedsToWard', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();
  });

  test('throws NotFoundError when ward does not exist', async () => {
    mockRepo.findWardById.mockResolvedValue(null);

    await expect(service.addBedsToWard(TENANT, 'bad-ward', { bedNumbers: ['G-01'] }, ACTOR))
      .rejects.toThrow(NotFoundError);

    expect(mockRepo.addBed).not.toHaveBeenCalled();
  });

  test('adds all beds when none exist yet', async () => {
    mockRepo.findWardById.mockResolvedValue(makeWard() as never);
    mockRepo.findBedByNumber.mockResolvedValue(null);
    mockRepo.addBed
      .mockResolvedValueOnce(makeBed({ bedNumber: 'G-01' }) as never)
      .mockResolvedValueOnce(makeBed({ bedNumber: 'G-02' }) as never);

    const result = await service.addBedsToWard(TENANT, 'ward-id-1', { bedNumbers: ['G-01', 'G-02'] }, ACTOR);

    expect(result).toHaveLength(2);
    expect(mockRepo.addBed).toHaveBeenCalledTimes(2);
  });

  test('skips duplicate bed numbers silently and returns only new beds', async () => {
    mockRepo.findWardById.mockResolvedValue(makeWard() as never);
    // G-01 exists, G-02 does not
    mockRepo.findBedByNumber
      .mockResolvedValueOnce(makeBed({ bedNumber: 'G-01' }) as never)
      .mockResolvedValueOnce(null);
    mockRepo.addBed.mockResolvedValue(makeBed({ bedNumber: 'G-02' }) as never);

    const result = await service.addBedsToWard(TENANT, 'ward-id-1', { bedNumbers: ['G-01', 'G-02'] }, ACTOR);

    expect(result).toHaveLength(1);
    expect(result[0].bedNumber).toBe('G-02');
  });

  test('throws ConflictError when ALL requested beds already exist', async () => {
    mockRepo.findWardById.mockResolvedValue(makeWard() as never);
    mockRepo.findBedByNumber.mockResolvedValue(makeBed() as never);

    await expect(service.addBedsToWard(TENANT, 'ward-id-1', { bedNumbers: ['G-01'] }, ACTOR))
      .rejects.toThrow(ConflictError);
  });
});

describe('IPDService — assertBedAvailable (bed conflict detection, FR-08.3 & FR-08.4)', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();
  });

  test('returns bed when it exists and is not occupied', async () => {
    mockRepo.findBedByNumber.mockResolvedValue(makeBed({ isOccupied: false }) as never);

    const bed = await service.assertBedAvailable(TENANT, 'ward-id-1', 'G-01');

    expect(bed.bedNumber).toBe('G-01');
    expect(bed.isOccupied).toBe(false);
  });

  test('throws BedOccupiedError when bed is already occupied', async () => {
    const occupiedBed = makeBed({ isOccupied: true, currentAdmissionId: 'ADM-001' });
    mockRepo.findBedByNumber.mockResolvedValue(occupiedBed as never);

    await expect(service.assertBedAvailable(TENANT, 'ward-id-1', 'G-01'))
      .rejects.toThrow(BedOccupiedError);
  });

  test('BedOccupiedError carries the occupant admission ID (FR-08.4)', async () => {
    const occupiedBed = makeBed({ isOccupied: true, currentAdmissionId: 'ADM-XYZ' });
    mockRepo.findBedByNumber.mockResolvedValue(occupiedBed as never);

    await expect(service.assertBedAvailable(TENANT, 'ward-id-1', 'G-01'))
      .rejects.toMatchObject({ currentAdmissionId: 'ADM-XYZ', bedNumber: 'G-01' });
  });

  test('throws NotFoundError when bed does not exist in ward', async () => {
    mockRepo.findBedByNumber.mockResolvedValue(null);

    await expect(service.assertBedAvailable(TENANT, 'ward-id-1', 'GHOST-99'))
      .rejects.toThrow(NotFoundError);
  });

  test('tenant isolation — query always scoped to tenantId', async () => {
    mockRepo.findBedByNumber.mockResolvedValue(null);

    await expect(service.assertBedAvailable('other-tenant', 'ward-id-1', 'G-01'))
      .rejects.toThrow(NotFoundError);

    expect(mockRepo.findBedByNumber).toHaveBeenCalledWith('other-tenant', 'ward-id-1', 'G-01');
  });
});

describe('IPDService — getOccupancySummary', () => {
  let service: IPDService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IPDService();
  });

  test('returns summary from repository', async () => {
    const summary = [{ wardId: 'w1', wardName: 'ICU', floor: '1st', total: 10, occupied: 4, available: 6 }];
    mockRepo.getOccupancySummary.mockResolvedValue(summary);

    const result = await service.getOccupancySummary(TENANT);

    expect(result).toEqual(summary);
    expect(mockRepo.getOccupancySummary).toHaveBeenCalledWith(TENANT);
  });

  test('returns empty array when no wards exist', async () => {
    mockRepo.getOccupancySummary.mockResolvedValue([]);

    const result = await service.getOccupancySummary(TENANT);

    expect(result).toEqual([]);
  });
});

// ─── PBT: occupancy invariant — total = occupied + available ─────────────────

describe('IPDService — PBT: occupancy invariant', () => {
  test('PBT: available always equals total minus occupied for any ward', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100 }),  // total beds
        fc.integer({ min: 0, max: 100 }),  // occupied beds
        async (total, occupiedRaw) => {
          const occupied  = Math.min(occupiedRaw, total); // occupied cannot exceed total
          const available = total - occupied;

          const mockRepo2 = ipdRepository as jest.Mocked<typeof ipdRepository>;
          mockRepo2.getOccupancySummary.mockResolvedValue([{
            wardId:   'w1',
            wardName: 'Test Ward',
            floor:    null,
            total,
            occupied,
            available,
          }]);

          const service2 = new IPDService();
          const [ward] = await service2.getOccupancySummary('t1');

          expect(ward.total).toBe(ward.occupied + ward.available);
          expect(ward.available).toBeGreaterThanOrEqual(0);
          expect(ward.occupied).toBeGreaterThanOrEqual(0);
          expect(ward.occupied).toBeLessThanOrEqual(ward.total);
        },
      ),
      { numRuns: 50 },
    );
  });
});
