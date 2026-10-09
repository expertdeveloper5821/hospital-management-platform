import { PathologyTestMasterModel, IPathologyTestMaster } from './pathology-test-master.model';
import { PathologyTestMasterSeed } from './pathology-test-master.defaults';
import { assertDbConnected } from '../../shared/utils/db-guard';

export interface PathologyTestMasterUpdate {
  clinicalNote?:        string | null;
  comment?:             string | null;
  correlateClinically?: string;
  isEnabled?:           boolean;
}

export class PathologyTestMasterRepository {
  async findAll(tenantId: string): Promise<IPathologyTestMaster[]> {
    assertDbConnected();
    return PathologyTestMasterModel.find({ tenantId });
  }

  // templateKeys the tenant has disabled. A missing row (never seeded) or a
  // row saved before `isEnabled` existed counts as enabled.
  async findDisabledKeys(tenantId: string): Promise<string[]> {
    assertDbConnected();
    const rows = await PathologyTestMasterModel.find({ tenantId, isEnabled: false }, { templateKey: 1 }).lean();
    return rows.map((r) => r.templateKey);
  }

  async findByKey(tenantId: string, templateKey: string): Promise<IPathologyTestMaster | null> {
    assertDbConnected();
    return PathologyTestMasterModel.findOne({ tenantId, templateKey });
  }

  // Inserts only rows that don't exist yet — never overwrites a saved row. A
  // concurrent seed of the same row is rejected by the unique index and ignored.
  async insertMissing(tenantId: string, seeds: PathologyTestMasterSeed[]): Promise<void> {
    assertDbConnected();
    if (seeds.length === 0) return;
    await PathologyTestMasterModel.bulkWrite(
      seeds.map((seed) => ({
        updateOne: {
          filter: { tenantId, templateKey: seed.templateKey },
          update: { $setOnInsert: { tenantId, ...seed, isEnabled: true, updatedBy: null } },
          upsert: true,
        },
      })),
      { ordered: false },
    ).catch((err: { code?: number }) => {
      if (err?.code !== 11000) throw err;
    });
  }

  async update(
    tenantId:    string,
    templateKey: string,
    changes:     PathologyTestMasterUpdate,
    userId:      string,
  ): Promise<IPathologyTestMaster | null> {
    assertDbConnected();
    return PathologyTestMasterModel.findOneAndUpdate(
      { tenantId, templateKey },
      { $set: { ...changes, updatedBy: userId } },
      { new: true },
    );
  }
}

export const pathologyTestMasterRepository = new PathologyTestMasterRepository();
