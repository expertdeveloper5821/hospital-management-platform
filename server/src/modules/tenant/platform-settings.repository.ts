import mongoose from 'mongoose';
import { PlatformSettingsModel, IPlatformSettings } from './platform-settings.model';

const SINGLETON_ID = new mongoose.Types.ObjectId('000000000000000000000001');

export interface PlatformSettingsUpdate {
  logoUrl?:       string | null;
  faviconUrl?:    string | null;
  platformTitle?: string;
  updatedBy?:     string;
}

export interface PlatformSettingsDoc {
  logoUrl:       string | null;
  faviconUrl:    string | null;
  platformTitle: string;
  updatedAt:     Date | null;
  updatedBy:     string | null;
}

class PlatformSettingsRepository {
  async get(): Promise<PlatformSettingsDoc> {
    const doc = await PlatformSettingsModel.findById(SINGLETON_ID).lean();
    if (!doc) {
      return {
        logoUrl:       null,
        faviconUrl:    null,
        platformTitle: 'MediCore HMS',
        updatedAt:     null,
        updatedBy:     null,
      };
    }
    return {
      logoUrl:       (doc as IPlatformSettings).logoUrl,
      faviconUrl:    (doc as IPlatformSettings).faviconUrl,
      platformTitle: (doc as IPlatformSettings).platformTitle,
      updatedAt:     (doc as IPlatformSettings).updatedAt,
      updatedBy:     (doc as IPlatformSettings).updatedBy,
    };
  }

  async upsert(fields: PlatformSettingsUpdate): Promise<void> {
    await PlatformSettingsModel.findByIdAndUpdate(
      SINGLETON_ID,
      { $set: fields },
      { upsert: true, new: true },
    );
  }
}

export const platformSettingsRepository = new PlatformSettingsRepository();
