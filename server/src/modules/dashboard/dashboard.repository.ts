import { PatientModel }          from '../patient/patient.model';
import { OPDVisitModel }         from '../opd/opd.model';
import { IPDAdmissionModel }     from '../ipd/ipd.model';
import { BedModel }              from '../ipd/bed.model';
import { PathologyRequestModel, RadiologyRequestModel } from '../lab/lab.model';
import { InventoryItemModel }    from '../inventory/inventory.model';
import { PaymentModel }          from '../payment/payment.model';
import { UserModel }             from '../user/user.model';
import { PaymentStatus }         from '../payment/payment.types';
import { LabRequestStatus }      from '../lab/lab.types';

// All dashboard MongoDB access lives here (no business logic). The service owns
// date-range computation, timezone handling, caching and series-building, and
// passes the resolved parameters into these methods.
class DashboardRepository {
  // ── Patients ──────────────────────────────────────────────────────────────
  async countPatients(tenantId: string): Promise<number> {
    // Exclude soft-deleted patients so this matches the Patients list count.
    return (await PatientModel.countDocuments({ tenantId, isDeleted: { $ne: true } })) ?? 0;
  }

  async countPatientsCreatedBetween(tenantId: string, start: Date, end: Date): Promise<number> {
    return PatientModel.countDocuments({
      tenantId,
      isDeleted: { $ne: true },
      createdAt: { $gte: start, $lte: end },
    });
  }

  // ── OPD ───────────────────────────────────────────────────────────────────
  async countOpdVisitsBetween(tenantId: string, start: Date, end: Date): Promise<number> {
    return OPDVisitModel.countDocuments({ tenantId, visitDate: { $gte: start, $lte: end } });
  }

  async opdVisitsGroupedByDay(
    tenantId: string,
    since:    Date,
    until:    Date,
    timezone: string,
  ): Promise<Array<{ _id: string; count: number }>> {
    return OPDVisitModel.aggregate([
      { $match: { tenantId, visitDate: { $gte: since, $lte: until } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$visitDate', timezone } }, count: { $sum: 1 } } },
    ]);
  }

  // ── IPD ───────────────────────────────────────────────────────────────────
  async countActiveIpd(tenantId: string): Promise<number> {
    return IPDAdmissionModel.countDocuments({ tenantId, status: 'ADMITTED' });
  }

  async bedStats(tenantId: string): Promise<{ total: number; occupied: number }> {
    const [total, occupied] = await Promise.all([
      BedModel.countDocuments({ tenantId }),
      BedModel.countDocuments({ tenantId, isOccupied: true }),
    ]);
    return { total, occupied };
  }

  // ── Lab ───────────────────────────────────────────────────────────────────
  async countPendingLabRequests(tenantId: string): Promise<{ pathology: number; radiology: number }> {
    const [pathology, radiology] = await Promise.all([
      PathologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.PENDING, isDeleted: { $ne: true } }),
      RadiologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.PENDING, isDeleted: { $ne: true } }),
    ]);
    return { pathology, radiology };
  }

  async countCompletedLabRequestsBetween(
    tenantId: string,
    start:    Date,
    end:      Date,
  ): Promise<{ pathology: number; radiology: number }> {
    const [pathology, radiology] = await Promise.all([
      PathologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.COMPLETED, updatedAt: { $gte: start, $lte: end }, isDeleted: { $ne: true } }),
      RadiologyRequestModel.countDocuments({ tenantId, status: LabRequestStatus.COMPLETED, updatedAt: { $gte: start, $lte: end }, isDeleted: { $ne: true } }),
    ]);
    return { pathology, radiology };
  }

  // ── Payments ──────────────────────────────────────────────────────────────
  async sumCompletedPaymentsBetween(tenantId: string, start: Date, end: Date): Promise<number> {
    const result = await PaymentModel.aggregate([
      { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return result[0]?.total ?? 0;
  }

  async sumCompletedPaymentsSince(tenantId: string, since: Date): Promise<number> {
    const result = await PaymentModel.aggregate([
      { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return result[0]?.total ?? 0;
  }

  async countPendingPayments(tenantId: string): Promise<number> {
    return PaymentModel.countDocuments({ tenantId, status: PaymentStatus.PENDING });
  }

  async paymentsGroupedByDay(
    tenantId: string,
    since:    Date,
    timezone: string,
  ): Promise<Array<{ _id: string; amount: number }>> {
    return PaymentModel.aggregate([
      { $match: { tenantId, status: PaymentStatus.COMPLETED, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone } }, amount: { $sum: '$amount' } } },
    ]);
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  async countLowStock(tenantId: string): Promise<number> {
    const result = await InventoryItemModel.aggregate([
      {
        $match: {
          tenantId,
          isDeleted: { $ne: true },
          $expr: { $and: [{ $gt: ['$lowStockThreshold', 0] }, { $lt: ['$quantity', '$lowStockThreshold'] }] },
        },
      },
      { $count: 'total' },
    ]);
    return result[0]?.total ?? 0;
  }

  async countOutOfStock(tenantId: string): Promise<number> {
    return InventoryItemModel.countDocuments({ tenantId, isDeleted: { $ne: true }, quantity: 0 });
  }

  async countInventoryItems(tenantId: string): Promise<number> {
    return InventoryItemModel.countDocuments({ tenantId, isDeleted: { $ne: true } });
  }

  // ── Staff ─────────────────────────────────────────────────────────────────
  async countActiveStaff(tenantId: string): Promise<number> {
    return UserModel.countDocuments({ tenantId, isActive: true });
  }

  // ── Doctor-scoped (Doctor dashboard) ─────────────────────────────────────
  // Every query here filters by the doctor's own userId (OPDVisit.doctorIds /
  // IPDAdmission.assignedDoctorIds / lab request.requestedBy), never tenant-wide.

  async countOpdVisitsForDoctorBetween(
    tenantId: string, doctorId: string, start: Date, end: Date,
  ): Promise<number> {
    return OPDVisitModel.countDocuments({ tenantId, doctorIds: doctorId, visitDate: { $gte: start, $lte: end } });
  }

  async countActiveIpdForDoctor(tenantId: string, doctorId: string): Promise<number> {
    return IPDAdmissionModel.countDocuments({ tenantId, status: 'ADMITTED', assignedDoctorIds: doctorId });
  }

  // Distinct patients this doctor has treated — via an OPD visit assigned to
  // them or an IPD admission under their care. Backs "Total Patients" and
  // scopes the doctor's lab-report queries to their own patients.
  async findPatientIdsForDoctor(tenantId: string, doctorId: string): Promise<string[]> {
    const [opdPatientIds, ipdPatientIds] = await Promise.all([
      OPDVisitModel.distinct('patientId', { tenantId, doctorIds: doctorId }),
      IPDAdmissionModel.distinct('patientId', { tenantId, assignedDoctorIds: doctorId }),
    ]);
    return [...new Set([...opdPatientIds, ...ipdPatientIds])] as string[];
  }

  async countPendingLabRequestsForDoctor(
    tenantId: string, doctorId: string, patientIds: string[],
  ): Promise<{ pathology: number; radiology: number }> {
    const filter = {
      tenantId, status: LabRequestStatus.PENDING, isDeleted: { $ne: true },
      $or: [{ requestedBy: doctorId }, { patientId: { $in: patientIds } }],
    };
    const [pathology, radiology] = await Promise.all([
      PathologyRequestModel.countDocuments(filter),
      RadiologyRequestModel.countDocuments(filter),
    ]);
    return { pathology, radiology };
  }

  async countCompletedLabRequestsForDoctorBetween(
    tenantId: string, doctorId: string, patientIds: string[], start: Date, end: Date,
  ): Promise<{ pathology: number; radiology: number }> {
    const filter = {
      tenantId, status: LabRequestStatus.COMPLETED, updatedAt: { $gte: start, $lte: end }, isDeleted: { $ne: true },
      $or: [{ requestedBy: doctorId }, { patientId: { $in: patientIds } }],
    };
    const [pathology, radiology] = await Promise.all([
      PathologyRequestModel.countDocuments(filter),
      RadiologyRequestModel.countDocuments(filter),
    ]);
    return { pathology, radiology };
  }
}

export const dashboardRepository = new DashboardRepository();
