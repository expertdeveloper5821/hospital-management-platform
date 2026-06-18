import { StaffDocumentModel, IStaffDocument } from './staff-documents.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

class StaffDocumentRepository {
  async save(data: Partial<IStaffDocument>): Promise<IStaffDocument> {
    assertDbConnected();
    return StaffDocumentModel.create(data);
  }

  async findById(tenantId: string, documentId: string): Promise<IStaffDocument | null> {
    assertDbConnected();
    return StaffDocumentModel.findOne({ tenantId, documentId });
  }

  async findByUser(tenantId: string, userId: string): Promise<IStaffDocument[]> {
    assertDbConnected();
    return StaffDocumentModel.find({ tenantId, userId, isDeleted: false }).sort({ createdAt: -1 }).lean() as unknown as IStaffDocument[];
  }

  async countByCategory(tenantId: string, userId: string, category: string): Promise<number> {
    assertDbConnected();
    return StaffDocumentModel.countDocuments({ tenantId, userId, category, isDeleted: false });
  }

  async softDelete(
    tenantId:   string,
    documentId: string,
    deletedBy:  string,
  ): Promise<IStaffDocument | null> {
    assertDbConnected();
    return StaffDocumentModel.findOneAndUpdate(
      { tenantId, documentId },
      { isDeleted: true, deletedBy, deletedAt: new Date() },
      { new: true },
    );
  }
}

export const staffDocumentRepository = new StaffDocumentRepository();
