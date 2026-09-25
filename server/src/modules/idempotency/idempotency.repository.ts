import { IdempotencyRecordModel, IIdempotencyRecord } from './idempotency.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class IdempotencyRepository {
  async findByKey(tenantId: string, idempotencyKey: string): Promise<IIdempotencyRecord | null> {
    assertDbConnected();
    return IdempotencyRecordModel.findOne({ tenantId, idempotencyKey });
  }

  async save(data: Partial<IIdempotencyRecord>): Promise<IIdempotencyRecord> {
    assertDbConnected();
    return IdempotencyRecordModel.create(data);
  }
}

export const idempotencyRepository = new IdempotencyRepository();
