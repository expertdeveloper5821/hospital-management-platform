import { TenantModel, ITenant } from './tenant.model';
import { TenantStatus, PaginatedResult } from '../../shared/types/common.types';
import { BrandingConfig } from './tenant.types';
import { assertDbConnected } from '../../shared/utils/db-guard';

export class TenantRepository {
  async findById(tenantId: string): Promise<ITenant | null> {
    assertDbConnected();
    return TenantModel.findById(tenantId);
  }

  async findAll(page: number, limit: number): Promise<PaginatedResult<ITenant>> {
    assertDbConnected();
    const skip  = (page - 1) * limit;
    const [data, total] = await Promise.all([
      TenantModel.find().skip(skip).limit(limit).lean(),
      TenantModel.countDocuments(),
    ]);
    return { data: data as ITenant[], total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async save(tenant: Partial<ITenant>): Promise<ITenant> {
    assertDbConnected();
    return TenantModel.create(tenant);
  }

  async updateStatus(tenantId: string, status: TenantStatus): Promise<void> {
    assertDbConnected();
    await TenantModel.findByIdAndUpdate(tenantId, { status });
  }

  async updateBranding(tenantId: string, branding: Partial<BrandingConfig>): Promise<void> {
    assertDbConnected();
    const update: Record<string, unknown> = {};
    if (branding.logoUrl)     update['branding.logoUrl']     = branding.logoUrl;
    if (branding.displayName) update['branding.displayName'] = branding.displayName;
    if (branding.primaryColor) update['branding.primaryColor'] = branding.primaryColor;
    await TenantModel.findByIdAndUpdate(tenantId, { $set: update });
  }

  async saveInviteToken(tenantId: string, token: string, expiry: Date): Promise<void> {
    assertDbConnected();
    await TenantModel.findByIdAndUpdate(tenantId, {
      inviteToken:       token,
      inviteTokenExpiry: expiry,
    });
  }

  async consumeInviteToken(token: string): Promise<ITenant | null> {
    assertDbConnected();
    return TenantModel.findOneAndUpdate(
      { inviteToken: token, inviteTokenExpiry: { $gt: new Date() } },
      { inviteToken: null, inviteTokenExpiry: null },
      { new: true },
    );
  }
}

export const tenantRepository = new TenantRepository();
