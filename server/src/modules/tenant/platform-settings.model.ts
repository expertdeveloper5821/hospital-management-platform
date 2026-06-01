import mongoose, { Document, Schema } from 'mongoose';

export interface IPlatformSettings extends Document {
  _id:           mongoose.Types.ObjectId;
  logoUrl:       string | null;
  faviconUrl:    string | null;
  platformTitle: string;
  updatedAt:     Date;
  updatedBy:     string | null;
}

const platformSettingsSchema = new Schema<IPlatformSettings>(
  {
    _id:           { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId('000000000000000000000001') },
    logoUrl:       { type: String, default: null },
    faviconUrl:    { type: String, default: null },
    platformTitle: { type: String, default: 'MediCore HMS' },
    updatedBy:     { type: String, default: null },
  },
  {
    timestamps:  { createdAt: false, updatedAt: 'updatedAt' },
    versionKey:  false,
    collection:  'platform_settings',
  },
);

export const PlatformSettingsModel = mongoose.model<IPlatformSettings>(
  'PlatformSettings',
  platformSettingsSchema,
);
