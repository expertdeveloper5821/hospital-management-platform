import mongoose, { Schema, Document } from 'mongoose';
import { LabRequestStatus, LabRequestPriority, LAB_REFERRED_BY_SELF } from './lab.types';
import { encryptedFieldsPlugin, wrapModelBulkWrite } from '../../shared/utils/encrypted-fields.plugin';
import { EncryptionKeyPurpose } from '../../shared/utils/field-encryption';

// ─── Clinical free-text encryption at rest (AES-256-GCM) ─────────────────────
// `notes` is the free-text clinical note on a pathology/radiology request
// (sanitized rich-text HTML — see lab.types.ts). It is encrypted transparently
// at the model layer via the shared plugin (same mechanism and `MEDICAL` key as
// OPDVisit.diagnosis/.prescription/.notes). Every write path (save,
// create/insertMany, updateOne/updateMany, findOneAndUpdate, replaceOne,
// findOneAndReplace, $setOnInsert upserts, and Model.bulkWrite) persists
// ciphertext; every read path hands callers back the plaintext, so the service,
// controller, discharge-summary PDF and the frontend are all unchanged. Legacy
// plaintext rows are passed through untouched on read.
//
// Safe because `notes` is never used in any filter, sort, search (search.service
// only regex-matches requestId/patientId/testType/imagingType), index,
// aggregation or `distinct()` — verified across lab.repository.ts, search and
// the IPD discharge summary.
const ENCRYPTED_LAB_NOTES = {
  fields:  ['notes'],
  purpose: EncryptionKeyPurpose.MEDICAL,
};

// Pathology additionally encrypts each structured test report's `resultData`
// (the JSON-serialised entered values + remarks — see IPathologyTestReport)
// per array element, same key. `testName`/`templateKey`/`submittedBy`/
// `submittedAt` stay plaintext: testName is already plaintext in `testType`,
// and it is the only sub-field ever used in a filter (the positional update in
// LabRepository.upsertPathologyTestReport) — resultData never is.
const ENCRYPTED_PATHOLOGY_FIELDS = {
  ...ENCRYPTED_LAB_NOTES,
  arrayFields: [{ path: 'testReports', fields: ['resultData'] }],
};

// ─── Structured Pathology test report (one per submitted test) ───────────────
export interface IPathologyTestReport {
  testName:    string;
  templateKey: string;
  // JSON of { values: PathologyResultValue[]; remarks: string | null } —
  // encrypted at rest; plaintext JSON on every read through the model.
  resultData:  string;
  submittedBy: string;
  submittedAt: Date;
}

const pathologyTestReportSchema = new Schema<IPathologyTestReport>(
  {
    testName:    { type: String, required: true },
    templateKey: { type: String, required: true },
    // No `maxlength` — ciphertext is longer than the plaintext; the content
    // limits live in SubmitPathologyTestReportSchema (lab.types.ts).
    resultData:  { type: String, required: true },
    submittedBy: { type: String, required: true },
    submittedAt: { type: Date,   required: true },
  },
  { _id: false },
);

// ─── PathologyRequest ─────────────────────────────────────────────────────────
export interface IPathologyRequest extends Document {
  requestId:    string;
  patientId:    string;
  name?:        string;
  tenantId:     string;
  requestedBy:  string;
  testType:     string;
  referredBy:   string;
  departmentId: string | null;
  status:       LabRequestStatus;
  priority:     LabRequestPriority;
  notes:        string | null;
  reportS3Key:  string | null;
  // Set when the request was created from a Billing LAB_TEST charge — its
  // payment is the charge's Payment (referenceType CHARGE), not a Lab collect.
  chargeId:     string | null;
  // The patient's OPD visit / IPD admission this request was raised during,
  // resolved server-side at creation (lab.service resolveLabEncounterLink).
  // `null` = resolved, no encounter; `undefined` = legacy row created before
  // the link existed (resolved at read time from requestedAt instead).
  opdVisitId?:     string | null;
  ipdAdmissionId?: string | null;
  // Structured per-test reports, at most one per test name in `testType`.
  // Absent/empty on legacy rows and on requests with no submitted report yet.
  testReports:  IPathologyTestReport[];
  isDeleted:    boolean;
  deletedAt:    Date | null;
  requestedAt:  Date;
  createdAt:    Date;
  updatedAt:    Date;
}

const pathologyRequestSchema = new Schema<IPathologyRequest>(
  {
    requestId:   { type: String, required: true, unique: true },
    patientId:   { type: String, required: true },
    tenantId:    { type: String, required: true },
    requestedBy:  { type: String, required: true },
    testType:     { type: String, required: true, trim: true, maxlength: 200 },
    referredBy:   { type: String, required: true, trim: true, maxlength: 120, default: LAB_REFERRED_BY_SELF },
    departmentId: { type: String, default: null },
    status: {
      type:     String,
      enum:     Object.values(LabRequestStatus),
      default:  LabRequestStatus.PENDING,
      required: true,
    },
    priority: {
      type:     String,
      enum:     ['NORMAL', 'URGENT'],
      default:  'NORMAL',
      required: true,
    },
    // No `maxlength` here — the field is encrypted at rest (see below) and the
    // "enc:v1:" ciphertext envelope is longer than the plaintext. The real
    // length/content limit lives in the controller's Zod schema (lab.types.ts:
    // 12000 raw / 2000 tag-stripped chars), which runs on plaintext before it
    // ever reaches the model.
    notes:       { type: String, default: null, trim: true },
    reportS3Key: { type: String, default: null },
    chargeId:    { type: String, default: null },
    // No default — a missing value marks a legacy row (see the interface).
    opdVisitId:     { type: String },
    ipdAdmissionId: { type: String },
    testReports: { type: [pathologyTestReportSchema], default: [] },
    isDeleted:   { type: Boolean, default: false },
    deletedAt:   { type: Date,    default: null },
    requestedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'pathology_requests',
  },
);

// tenantId first (NFR-01)
pathologyRequestSchema.index({ tenantId: 1, status: 1 });
pathologyRequestSchema.index({ tenantId: 1, patientId: 1 });
pathologyRequestSchema.index({ tenantId: 1, isDeleted: 1 });
pathologyRequestSchema.index({ tenantId: 1, departmentId: 1, isDeleted: 1 });
// At most one lab request per Billing charge (duplicate-request backstop).
pathologyRequestSchema.index(
  { tenantId: 1, chargeId: 1 },
  { unique: true, partialFilterExpression: { chargeId: { $type: 'string' } } },
);

pathologyRequestSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_PATHOLOGY_FIELDS);

export const PathologyRequestModel = mongoose.model<IPathologyRequest>(
  'PathologyRequest',
  pathologyRequestSchema,
);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(PathologyRequestModel, ENCRYPTED_PATHOLOGY_FIELDS);

// ─── RadiologyRequest ─────────────────────────────────────────────────────────
export interface IRadiologyRequest extends Document {
  requestId:    string;
  patientId:    string;
  tenantId:     string;
  requestedBy:  string;
  imagingType:  string;
  referredBy:   string;
  departmentId: string | null;
  status:       LabRequestStatus;
  priority:     LabRequestPriority;
  notes:        string | null;
  reportS3Key:  string | null;
  // Set when the request was created from a Billing LAB_TEST charge — its
  // payment is the charge's Payment (referenceType CHARGE), not a Lab collect.
  chargeId:     string | null;
  // The patient's OPD visit / IPD admission this request was raised during,
  // resolved server-side at creation (lab.service resolveLabEncounterLink).
  // `null` = resolved, no encounter; `undefined` = legacy row created before
  // the link existed (resolved at read time from requestedAt instead).
  opdVisitId?:     string | null;
  ipdAdmissionId?: string | null;
  isDeleted:    boolean;
  deletedAt:    Date | null;
  requestedAt:  Date;
  createdAt:    Date;
  updatedAt:    Date;
}

const radiologyRequestSchema = new Schema<IRadiologyRequest>(
  {
    requestId:   { type: String, required: true, unique: true },
    patientId:   { type: String, required: true },
    tenantId:    { type: String, required: true },
    requestedBy:  { type: String, required: true },
    imagingType:  { type: String, required: true, trim: true, maxlength: 200 },
    referredBy:   { type: String, required: true, trim: true, maxlength: 120, default: LAB_REFERRED_BY_SELF },
    departmentId: { type: String, default: null },
    status: {
      type:     String,
      enum:     Object.values(LabRequestStatus),
      default:  LabRequestStatus.PENDING,
      required: true,
    },
    priority: {
      type:     String,
      enum:     ['NORMAL', 'URGENT'],
      default:  'NORMAL',
      required: true,
    },
    // No `maxlength` here — the field is encrypted at rest (see below) and the
    // "enc:v1:" ciphertext envelope is longer than the plaintext. The real
    // length/content limit lives in the controller's Zod schema (lab.types.ts:
    // 12000 raw / 2000 tag-stripped chars), which runs on plaintext before it
    // ever reaches the model.
    notes:       { type: String, default: null, trim: true },
    reportS3Key: { type: String, default: null },
    chargeId:    { type: String, default: null },
    // No default — a missing value marks a legacy row (see the interface).
    opdVisitId:     { type: String },
    ipdAdmissionId: { type: String },
    isDeleted:   { type: Boolean, default: false },
    deletedAt:   { type: Date,    default: null },
    requestedAt: { type: Date, required: true, default: () => new Date() },
  },
  {
    timestamps: true,
    collection: 'radiology_requests',
  },
);

radiologyRequestSchema.index({ tenantId: 1, status: 1 });
radiologyRequestSchema.index({ tenantId: 1, patientId: 1 });
radiologyRequestSchema.index({ tenantId: 1, isDeleted: 1 });
radiologyRequestSchema.index({ tenantId: 1, departmentId: 1, isDeleted: 1 });
// At most one lab request per Billing charge (duplicate-request backstop).
radiologyRequestSchema.index(
  { tenantId: 1, chargeId: 1 },
  { unique: true, partialFilterExpression: { chargeId: { $type: 'string' } } },
);

radiologyRequestSchema.plugin(encryptedFieldsPlugin, ENCRYPTED_LAB_NOTES);

export const RadiologyRequestModel = mongoose.model<IRadiologyRequest>(
  'RadiologyRequest',
  radiologyRequestSchema,
);

// Model.bulkWrite() runs no query middleware — wrap it so bulk operations
// cannot write plaintext either.
wrapModelBulkWrite(RadiologyRequestModel, ENCRYPTED_LAB_NOTES);
