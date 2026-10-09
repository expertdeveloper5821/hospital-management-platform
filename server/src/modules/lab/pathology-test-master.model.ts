import mongoose, { Schema, Document } from 'mongoose';

// ─── Pathology Test Master ────────────────────────────────────────────────────
// Per-tenant, per-test clinical content printed on that test's report:
// `clinicalNote` (the test's Clinical Notes section), `comment` (only where a
// test needs one — null otherwise) and `correlateClinically` (the "Please
// Correlate Clinically" footer at the bottom of the report). One row per
// templateKey (pathology-report-templates.ts; 'GENERIC' covers every test
// outside the catalog). Rows are seeded from pathology-test-master.defaults.ts
// on first read and edited from Lab → Test Master; reports always use the
// currently saved row. `isEnabled` (default true — a row saved before the flag
// existed reads as enabled) controls whether the test can be picked for a new
// pathology request; disabling never touches existing requests or reports.
// Not patient data — stored in plaintext.
export interface IPathologyTestMaster extends Document {
  tenantId:            string;
  templateKey:         string;
  testName:            string;
  clinicalNote:        string | null;
  comment:             string | null;
  correlateClinically: string | null;
  isEnabled:           boolean;
  // null on a seeded row that has never been edited.
  updatedBy:           string | null;
  createdAt:           Date;
  updatedAt:           Date;
}

const pathologyTestMasterSchema = new Schema<IPathologyTestMaster>(
  {
    tenantId:            { type: String, required: true },
    templateKey:         { type: String, required: true },
    testName:            { type: String, required: true },
    clinicalNote:        { type: String, default: null },
    comment:             { type: String, default: null },
    correlateClinically: { type: String, default: null },
    isEnabled:           { type: Boolean, default: true },
    updatedBy:           { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'pathology_test_masters',
  },
);

// One row per test per tenant (also the concurrent-seed backstop).
pathologyTestMasterSchema.index({ tenantId: 1, templateKey: 1 }, { unique: true });

export const PathologyTestMasterModel = mongoose.model<IPathologyTestMaster>(
  'PathologyTestMaster',
  pathologyTestMasterSchema,
);
