import mongoose, { Schema, Document } from 'mongoose';

export interface IInventoryItem extends Document {
  itemId:            string;
  tenantId:          string;
  name:              string;
  category:          string;
  unit:              string;
  quantity:          number;
  lowStockThreshold: number;
  description:       string | null;
  isDeleted:         boolean;
  deletedAt:         Date | null;
  createdAt:         Date;
  updatedAt:         Date;
}

const inventoryItemSchema = new Schema<IInventoryItem>(
  {
    itemId:            { type: String, required: true, unique: true },
    tenantId:          { type: String, required: true },
    name:              { type: String, required: true, trim: true, maxlength: 200 },
    category:          { type: String, required: true, trim: true, maxlength: 100 },
    unit:              { type: String, required: true, trim: true, maxlength: 50 },
    quantity:          { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, required: true, min: 0, default: 0 },
    description:       { type: String, default: null, trim: true, maxlength: 1000 },
    isDeleted:         { type: Boolean, default: false },
    deletedAt:         { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'inventory_items',
  },
);

// tenantId first on all compound indexes (NFR-01)
inventoryItemSchema.index({ tenantId: 1, category: 1 });
inventoryItemSchema.index({ tenantId: 1, name: 1 });

export const InventoryItemModel = mongoose.model<IInventoryItem>(
  'InventoryItem',
  inventoryItemSchema,
);
