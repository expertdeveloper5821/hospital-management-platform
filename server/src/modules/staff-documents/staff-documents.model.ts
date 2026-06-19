import mongoose, { Schema, Document } from 'mongoose';

export const DocumentCategory = {
  IDENTITY_PROOF:           'IDENTITY_PROOF',
  ADDRESS_PROOF:            'ADDRESS_PROOF',
  EDUCATIONAL_CERTIFICATE:  'EDUCATIONAL_CERTIFICATE',
  EXPERIENCE_LETTER:        'EXPERIENCE_LETTER',
  OFFER_LETTER:             'OFFER_LETTER',
  CONTRACT:                 'CONTRACT',
  OTHER:                    'OTHER',
} as const;

export type DocumentCategory = typeof DocumentCategory[keyof typeof DocumentCategory];

export interface IStaffDocument extends Document {
  documentId:   string;
  tenantId:     string;
  userId:       string;
  category:     DocumentCategory;
  documentName: string;
  s3Key:        string;
  uploadedBy:   string;
  isDeleted:    boolean;
  deletedBy:    string | null;
  deletedAt:    Date | null;
  createdAt:    Date;
  updatedAt:    Date;
}

const StaffDocumentSchema = new Schema<IStaffDocument>(
  {
    documentId:   { type: String, required: true },
    tenantId:     { type: String, required: true },
    userId:       { type: String, required: true },
    category:     { type: String, required: true, enum: Object.values(DocumentCategory) },
    documentName: { type: String, required: true, trim: true, maxlength: 200 },
    s3Key:        { type: String, required: true },
    uploadedBy:   { type: String, required: true },
    isDeleted:    { type: Boolean, default: false },
    deletedBy:    { type: String,  default: null },
    deletedAt:    { type: Date,    default: null },
  },
  { timestamps: true, collection: 'staff_documents' },
);

StaffDocumentSchema.index({ tenantId: 1, documentId: 1 }, { unique: true });
StaffDocumentSchema.index({ tenantId: 1, userId: 1, category: 1, isDeleted: 1 });
StaffDocumentSchema.index({ tenantId: 1, userId: 1, isDeleted: 1 });

export const StaffDocumentModel = mongoose.model<IStaffDocument>('StaffDocument', StaffDocumentSchema);
