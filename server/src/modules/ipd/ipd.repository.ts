import mongoose from 'mongoose';
import { WardModel, IWard } from './ward.model';
import { BedModel,  IBed  } from './bed.model';
import { assertDbConnected } from '../../shared/utils/db-guard';
import { WardOccupancySummary } from './ipd.types';

export class IpdRepository {

  // ─── Ward ──────────────────────────────────────────────────────────────────

  async createWard(data: { tenantId: string; name: string; floor?: string }): Promise<IWard> {
    assertDbConnected();
    return WardModel.create({
      tenantId: data.tenantId,
      name:     data.name,
      floor:    data.floor ?? null,
    });
  }

  async findWardById(tenantId: string, wardId: string): Promise<IWard | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(wardId)) return null;
    return WardModel.findOne({ tenantId, _id: wardId });
  }

  async findWardByName(tenantId: string, name: string): Promise<IWard | null> {
    assertDbConnected();
    return WardModel.findOne({ tenantId, name: { $regex: new RegExp(`^${name}$`, 'i') } });
  }

  async listWards(tenantId: string): Promise<IWard[]> {
    assertDbConnected();
    return WardModel.find({ tenantId }).sort({ name: 1 });
  }

  // ─── Bed ───────────────────────────────────────────────────────────────────

  async addBed(data: { tenantId: string; wardId: string; bedNumber: string }): Promise<IBed> {
    assertDbConnected();
    return BedModel.create({
      tenantId:           data.tenantId,
      wardId:             data.wardId,
      bedNumber:          data.bedNumber,
      isOccupied:         false,
      currentAdmissionId: null,
    });
  }

  async findBedByNumber(tenantId: string, wardId: string, bedNumber: string): Promise<IBed | null> {
    assertDbConnected();
    return BedModel.findOne({ tenantId, wardId, bedNumber });
  }

  async findBedById(tenantId: string, bedId: string): Promise<IBed | null> {
    assertDbConnected();
    if (!mongoose.isValidObjectId(bedId)) return null;
    return BedModel.findOne({ tenantId, _id: bedId });
  }

  async listBedsInWard(tenantId: string, wardId: string): Promise<IBed[]> {
    assertDbConnected();
    return BedModel.find({ tenantId, wardId }).sort({ bedNumber: 1 });
  }

  async updateBedOccupancy(
    tenantId:    string,
    bedId:       string,
    isOccupied:  boolean,
    admissionId: string | null,
  ): Promise<IBed | null> {
    assertDbConnected();
    return BedModel.findOneAndUpdate(
      { tenantId, _id: bedId },
      { isOccupied, currentAdmissionId: admissionId },
      { new: true },
    );
  }

  // ─── Occupancy summary (FR-08.8) ───────────────────────────────────────────

  async getOccupancySummary(tenantId: string): Promise<WardOccupancySummary[]> {
    assertDbConnected();

    const wards = await this.listWards(tenantId);
    if (wards.length === 0) return [];

    // Aggregate bed counts grouped by wardId in one query
    const counts = await BedModel.aggregate<{
      _id:      string;
      total:    number;
      occupied: number;
    }>([
      { $match: { tenantId } },
      {
        $group: {
          _id:      '$wardId',
          total:    { $sum: 1 },
          occupied: { $sum: { $cond: ['$isOccupied', 1, 0] } },
        },
      },
    ]);

    const countMap = new Map(counts.map((c) => [c._id, c]));

    return wards.map((ward) => {
      const wardId = (ward._id as mongoose.Types.ObjectId).toString();
      const c      = countMap.get(wardId);
      const total    = c?.total    ?? 0;
      const occupied = c?.occupied ?? 0;
      return {
        wardId,
        wardName:  ward.name,
        floor:     ward.floor,
        total,
        occupied,
        available: total - occupied,
      };
    });
  }
}

export const ipdRepository = new IpdRepository();
