import path from 'path';

require('dotenv-safe').config({
  path:    path.resolve(__dirname, '../.env'),
  example: path.resolve(__dirname, '../.env.example'),
});

import { connectDatabase, disconnectDatabase } from '../src/shared/config/database';
import { OPDVisitModel } from '../src/modules/opd/opd.model';
import { UserModel } from '../src/modules/auth/auth.model';

// One-off backfill: before this fix, OPDService.createVisit copied
// departmentId from patient.departmentId — always null for any patient
// registered after department-scoping moved off Patient (see CLAUDE.md) — so
// every OPD visit created since then has departmentId: null regardless of
// which doctor/department it was actually booked under. That fell into
// "Other Revenue" instead of the correct department on the Revenue page.
//
// This script re-resolves departmentId for existing visits the same way
// OPDService.createVisit/updateVisit now do — the first assigned doctor with
// a departmentIds[0] — and only writes a value when one can be resolved
// unambiguously. Visits with no doctor assigned, or whose doctor(s) have no
// department, are left untouched (they were genuinely departmentless, not
// mis-stamped) and keep landing in "Other Revenue", which is correct.
//
// Safe to re-run: only touches documents still matching departmentId: null.
async function main() {
  await connectDatabase();

  const visits = await OPDVisitModel.find({
    departmentId: null,
    doctorIds:    { $exists: true, $not: { $size: 0 } },
  }).select('_id tenantId doctorIds').lean();

  console.log(`Found ${visits.length} OPD visit(s) with no department and at least one assigned doctor.`);

  // Cache doctor -> departmentId lookups per tenant+doctor so a doctor shared
  // across many visits (the common case) is only fetched once.
  const doctorDeptCache = new Map<string, string | null>();

  async function resolveDoctorDepartment(tenantId: string, doctorId: string): Promise<string | null> {
    const cacheKey = `${tenantId}:${doctorId}`;
    if (doctorDeptCache.has(cacheKey)) return doctorDeptCache.get(cacheKey)!;
    const doctor = await UserModel.findOne({ _id: doctorId, tenantId }).select('departmentIds').lean();
    const departmentId = (doctor?.departmentIds?.[0] as string | undefined) ?? null;
    doctorDeptCache.set(cacheKey, departmentId);
    return departmentId;
  }

  let updated = 0;
  let skipped = 0;

  for (const visit of visits) {
    let resolvedDepartmentId: string | null = null;
    for (const doctorId of (visit.doctorIds as string[])) {
      resolvedDepartmentId = await resolveDoctorDepartment(visit.tenantId as string, doctorId);
      if (resolvedDepartmentId) break;
    }

    if (resolvedDepartmentId) {
      await OPDVisitModel.updateOne(
        { _id: visit._id, departmentId: null }, // re-check departmentId is still null — safe under concurrent writes
        { $set: { departmentId: resolvedDepartmentId } },
      );
      updated++;
    } else {
      skipped++;
    }
  }

  console.log(`Backfilled ${updated} visit(s) with a resolved department.`);
  console.log(`Skipped ${skipped} visit(s) — assigned doctor(s) have no department themselves.`);

  await disconnectDatabase();
  process.exit(0);
}

main().catch((err) => {
  console.error('backfill-opd-department failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
