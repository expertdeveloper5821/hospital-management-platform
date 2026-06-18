import { StaffIdCardModel, IStaffIdCard } from './staff-id-card.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

class StaffIdCardRepository {
  async findByUserId(tenantId: string, userId: string): Promise<IStaffIdCard | null> {
    assertDbConnected();
    return StaffIdCardModel.findOne({ tenantId, userId });
  }

  async upsert(
    tenantId: string,
    userId:   string,
    data:     Partial<IStaffIdCard>,
  ): Promise<IStaffIdCard> {
    assertDbConnected();
    const record = await StaffIdCardModel.findOneAndUpdate(
      { tenantId, userId },
      { ...data, tenantId, userId },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    return record!;
  }
}

export const staffIdCardRepository = new StaffIdCardRepository();
