import { PackageAssignmentModel, IPackageAssignment } from './package-assignment.model';
import { assertDbConnected } from '../../shared/utils/db-guard';

class PackageAssignmentRepository {
  async save(data: Partial<IPackageAssignment>): Promise<IPackageAssignment> {
    assertDbConnected();
    return PackageAssignmentModel.create(data);
  }

  async findById(tenantId: string, assignmentId: string): Promise<IPackageAssignment | null> {
    assertDbConnected();
    return PackageAssignmentModel.findOne({ tenantId, assignmentId });
  }

  async findActiveAssignment(
    tenantId:  string,
    patientId: string,
    packageId: string,
  ): Promise<IPackageAssignment | null> {
    assertDbConnected();
    return PackageAssignmentModel.findOne({ tenantId, patientId, packageId, status: 'ACTIVE' });
  }

  async update(
    tenantId:     string,
    assignmentId: string,
    data:         Partial<IPackageAssignment>,
  ): Promise<IPackageAssignment | null> {
    assertDbConnected();
    return PackageAssignmentModel.findOneAndUpdate(
      { tenantId, assignmentId },
      data,
      { new: true },
    );
  }

  async findByPatient(tenantId: string, patientId: string): Promise<IPackageAssignment[]> {
    assertDbConnected();
    return PackageAssignmentModel.find({ tenantId, patientId }).sort({ assignedDate: -1 }).lean() as unknown as IPackageAssignment[];
  }
}

export const packageAssignmentRepository = new PackageAssignmentRepository();
