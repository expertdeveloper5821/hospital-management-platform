import { StaffIdCardModel, IStaffIdCard } from './staff-id-card.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

export interface IssuedCardFields {
  s3Key:                 string;
  issuedAt:              Date;
  expiresAt:             Date;
  verificationTokenHash: string;
}

export interface VerifiableCard {
  tenantId:  string;
  userId:    string;
  issuedAt:  Date;
  expiresAt: Date;
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

class StaffIdCardRepository {
  async findByUserId(tenantId: string, userId: string): Promise<IStaffIdCard | null> {
    assertDbConnected();
    return StaffIdCardModel.findOne({ tenantId, userId });
  }

  /**
   * Atomically points the card record at a freshly issued PDF and its token
   * hash in ONE write, so the stored (s3Key, verificationTokenHash) pair always
   * comes from the same generate call — concurrent regenerations resolve to
   * last-writer-wins, never to a mismatched pair.
   *
   * Returns the record as it was BEFORE this write (null when newly inserted),
   * so the caller can clean up the superseded PDF.
   */
  async replaceIssuedCard(
    tenantId: string,
    userId:   string,
    fields:   IssuedCardFields,
  ): Promise<IStaffIdCard | null> {
    assertDbConnected();
    const run = () => StaffIdCardModel.findOneAndUpdate(
      { tenantId, userId },
      { $set: { ...fields, tenantId, userId } },
      { new: false, upsert: true, setDefaultsOnInsert: true },
    );
    try {
      return await run();
    } catch (err) {
      // Two first-time generations racing on the unique (tenantId, userId)
      // index: the loser retries as a plain update of the winner's row.
      if (!isDuplicateKeyError(err)) throw err;
      return run();
    }
  }

  /**
   * Public QR verification lookup. INTENTIONAL tenant-scoping exception: the
   * caller is unauthenticated, so the 256-bit token itself is what resolves the
   * tenant. Every follow-up read MUST use the tenantId returned here. Never add
   * a userId-based variant of this method.
   */
  async findByVerificationTokenHash(tokenHash: string): Promise<VerifiableCard | null> {
    assertDbConnected();
    return StaffIdCardModel
      .findOne({ verificationTokenHash: tokenHash })
      .select({ _id: 0, tenantId: 1, userId: 1, issuedAt: 1, expiresAt: 1 })
      .lean<VerifiableCard>();
  }
}

export const staffIdCardRepository = new StaffIdCardRepository();
