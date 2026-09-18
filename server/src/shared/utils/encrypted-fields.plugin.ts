import { Schema, Model } from 'mongoose';
import {
  encryptField,
  decryptField,
  isEncryptedField,
  EncryptionKeyPurpose,
} from './field-encryption';

// ─── Transparent field-level encryption at the model layer ────────────────────
// Wires AES-256-GCM encryption/decryption into a schema's write and read paths
// so ciphertext is the only form that ever reaches MongoDB, while every
// repository/service/controller keeps handling plaintext. No call site changes.
//
//   writes: save, insertMany, updateOne, updateMany, findOneAndUpdate,
//           replaceOne, findOneAndReplace (all via Mongoose middleware) and
//           Model.bulkWrite (via wrapModelBulkWrite — see below)
//   reads:  find, findOne, findOneAndUpdate/findOneAndReplace (returned doc),
//           save (returned doc)
//
// Every update shape is covered: `{ $set: {...} }`, `{ $setOnInsert: {...} }`
// (upsert), and a bare replacement object with no operator.
//
// `arrayFields` extends this to embedded arrays of subdocuments — only the
// named string sub-paths of each element are encrypted (see
// EncryptedArrayFieldSpec). It additionally covers `$push` / `$addToSet`
// (single element or `$each: [...]`) and indexed / positional `$set` targets
// (`progressNotes.0.note`, `progressNotes.$.note`, `progressNotes.$[].note`).
//
// `objectFields` extends this to a single nested (non-array) subdocument —
// e.g. `OPDVisit.vitals` — encrypting named string and number sub-paths in
// place (see EncryptedObjectFieldSpec). A numeric sub-path's schema type must
// be `Schema.Types.Mixed`, not `Number` (CastError on ciphertext) or `String`
// (a hydrated document's compiled setter would silently re-cast the
// decrypted `number` back to a string) — see the comment above
// `decryptNumberFieldsOn`.
//
// Legacy plaintext rows written before a field was encrypted are passed through
// untouched on read (decryptField only unwraps the "enc:v1:" envelope), so
// enabling this on an existing collection is safe with no migration — see
// scripts/encrypt-medical-fields.ts to convert them at rest.
//
// Not covered: raw aggregation pipelines ($merge/$out) and the native driver
// collection (mongoose.connection.collection(...)), both of which bypass
// Mongoose entirely. Never $match/$group/$project an encrypted field's
// *content* — the stored value is ciphertext and a new random IV per write
// means equal plaintexts don't produce equal ciphertexts. Filtering/searching
// on these fields must happen after decryption (see OPDRepository.findByPatient).

/**
 * An embedded array-of-subdocuments whose named string sub-fields are
 * encrypted per element (e.g. `IPDAdmission.progressNotes[].note`). Only the
 * listed `fields` on each element are touched — sibling scalars such as ids and
 * timestamps stay plaintext so they remain queryable/sortable.
 */
export interface EncryptedArrayFieldSpec {
  /** Top-level array path on this schema. */
  path:   string;
  /** String sub-paths within each array element to encrypt. */
  fields: string[];
}

/**
 * A single nested (non-array) subdocument whose named sub-fields are
 * encrypted (e.g. `OPDVisit.vitals` / `IPDAdmission.vitals`). Unlike
 * `EncryptedArrayFieldSpec` there is no array to iterate — `path` names one
 * embedded-object path and its listed sub-fields are encrypted in place.
 */
export interface EncryptedObjectFieldSpec {
  /** Top-level single-nested-subdocument path on this schema. */
  path: string;
  /** String sub-paths within the object to encrypt as-is (e.g. `bloodPressure`). */
  stringFields?: string[];
  /**
   * Numeric sub-paths within the object. Ciphertext can't live in a `Number`
   * path, so give these schema paths `type: Schema.Types.Mixed` (not
   * `Number`) — see the note on `encryptNumberFieldsOn` for why `String`
   * doesn't work either. A value is serialised with `String(value)` before
   * encryption and parsed back to a `number` on decrypt, so callers keep
   * seeing `number | null`, never a string.
   */
  numberFields?: string[];
}

export interface EncryptedFieldsOptions {
  /** Top-level string paths on this schema to encrypt. */
  fields:  string[];
  /** Which configured key these fields are encrypted under. */
  purpose: EncryptionKeyPurpose;
  /**
   * Subset of `fields` that hold a date. These are stored (and returned) as an
   * ISO-8601 string: a `Date` value is serialised before encryption, and a
   * legacy value still stored as a BSON `Date` (or a non-ISO date string) is
   * normalised to ISO on read so the API response shape never changes. Give the
   * schema path `type: String`, not `Date`.
   */
  dateFields?: string[];
  /**
   * Embedded arrays of subdocuments to encrypt per element. Same key
   * (`purpose`) and same guarantees as the top-level `fields`: ciphertext is
   * all that reaches MongoDB, callers only ever see plaintext, and legacy
   * plaintext elements are passed through untouched on read.
   */
  arrayFields?: EncryptedArrayFieldSpec[];
  /**
   * Single nested (non-array) subdocuments whose named sub-fields are
   * encrypted per object — see `EncryptedObjectFieldSpec`. Same guarantees as
   * `fields`/`arrayFields`.
   */
  objectFields?: EncryptedObjectFieldSpec[];
}

type MutableRecord = Record<string, unknown>;

function toIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? value : new Date(t).toISOString();
  }
  return null;
}

// Encrypts the target fields on a single object, in place. Skips null/undefined,
// non-strings, and values already in the "enc:v1:" envelope (guards against
// double-encryption when a decrypted doc is re-saved or a migration writes
// through the model). A `Date` in a declared `dateFields` path is serialised to
// ISO-8601 first.
function encryptFieldsOn(
  target:     unknown,
  fields:     string[],
  purpose:    EncryptionKeyPurpose,
  dateFields: string[] = [],
): void {
  if (!target || typeof target !== 'object') return;
  const record = target as MutableRecord;
  for (const field of fields) {
    let value = record[field];
    if (dateFields.includes(field) && value instanceof Date) value = toIso(value) ?? value;
    if (typeof value === 'string' && value.length > 0 && !isEncryptedField(value)) {
      record[field] = encryptField(value, purpose);
    }
  }
}

// Encrypts an update / write payload of any supported shape: a bare replacement
// object, `$set`, and `$setOnInsert`. Called for every query-update operator
// and for each operation inside a bulkWrite.
function encryptWritePayload(
  payload:    unknown,
  fields:     string[],
  purpose:    EncryptionKeyPurpose,
  dateFields: string[] = [],
): void {
  if (!payload || typeof payload !== 'object') return;
  const p = payload as MutableRecord;
  encryptFieldsOn(p, fields, purpose, dateFields);                // bare replacement / no-operator update
  encryptFieldsOn(p.$set, fields, purpose, dateFields);           // { $set: { ... } }
  encryptFieldsOn(p.$setOnInsert, fields, purpose, dateFields);   // { $setOnInsert: { ... } } (upsert)
}

// ─── Array-of-subdocument field encryption ───────────────────────────────────
// `progressNotes`-style embedded arrays: encrypt only the named string
// sub-paths of each element, leaving ids/timestamps and every other scalar
// untouched. Same guarantees as a top-level path — ciphertext is all that
// reaches MongoDB and callers only ever see plaintext.

/** Encrypts `fields` on every object element of `arr`, in place. */
function encryptArrayElements(
  arr:     unknown,
  fields:  string[],
  purpose: EncryptionKeyPurpose,
): void {
  if (!Array.isArray(arr)) return;
  for (const element of arr) encryptFieldsOn(element, fields, purpose);
}

// Encrypts array-subdocument fields in a write payload of any supported shape:
// a bare replacement object, `$set` / `$setOnInsert` (whole array, an indexed
// or positional element object, or a dotted leaf field), and `$push` /
// `$addToSet` (a single element or a `$each: [...]` batch, with or without
// `$sort` / `$slice`).
function encryptArrayWritePayload(
  payload:     unknown,
  arrayFields: EncryptedArrayFieldSpec[],
  purpose:     EncryptionKeyPurpose,
): void {
  if (!payload || typeof payload !== 'object' || arrayFields.length === 0) return;
  const p = payload as MutableRecord;

  for (const { path, fields } of arrayFields) {
    // bare replacement / no-operator update: { progressNotes: [ ... ] }
    encryptArrayElements(p[path], fields, purpose);

    for (const setKey of ['$set', '$setOnInsert'] as const) {
      const setObj = p[setKey];
      if (!setObj || typeof setObj !== 'object') continue;
      const s = setObj as MutableRecord;

      // whole-array replacement: { $set: { progressNotes: [ ... ] } }
      encryptArrayElements(s[path], fields, purpose);

      // indexed / positional targets: { $set: { 'progressNotes.0': {...} } },
      // { $set: { 'progressNotes.0.note': '...' } }, '$' / '$[]' forms too.
      const prefix = `${path}.`;
      for (const key of Object.keys(s)) {
        if (!key.startsWith(prefix)) continue;
        const segments = key.slice(prefix.length).split('.');
        if (segments.length === 1) {
          encryptFieldsOn(s[key], fields, purpose);        // element object
        } else {
          const leaf = segments[segments.length - 1];
          if (leaf && fields.includes(leaf)) encryptFieldsOn(s, [key], purpose); // dotted leaf
        }
      }
    }

    for (const pushKey of ['$push', '$addToSet'] as const) {
      const pushObj = p[pushKey];
      if (!pushObj || typeof pushObj !== 'object') continue;
      const spec = (pushObj as MutableRecord)[path];
      if (!spec || typeof spec !== 'object') continue;
      const specRecord = spec as MutableRecord;
      if (Array.isArray(specRecord.$each)) {
        encryptArrayElements(specRecord.$each, fields, purpose);   // { $each: [ ... ] }
      } else if (!('$each' in specRecord)) {
        encryptFieldsOn(spec, fields, purpose);                    // single pushed element
      }
    }
  }
}

/** Decrypts array-subdocument fields on a doc returned from a read/write. */
function decryptArrayFieldsOn(
  doc:         unknown,
  arrayFields: EncryptedArrayFieldSpec[],
  purpose:     EncryptionKeyPurpose,
): void {
  if (!doc || typeof doc !== 'object' || arrayFields.length === 0) return;
  const record = doc as MutableRecord;
  for (const { path, fields } of arrayFields) {
    const arr = record[path];
    if (!Array.isArray(arr)) continue;
    for (const element of arr) decryptFieldsOn(element, fields, purpose);
  }
}

// ─── Single-nested-object field encryption ───────────────────────────────────
// `vitals`-style embedded single subdocuments (not arrays): encrypt named
// string and number sub-paths of the one object at `path`, leaving any other
// sibling untouched.
//
// Numbers need a schema-type workaround the string/date paths don't: MongoDB
// can't hold ciphertext in a `Number` path (CastError on assignment), so a
// numeric leaf's schema path must be `Schema.Types.Mixed`, not `String` —
// `String` would round-trip correctly on disk, but a *hydrated Mongoose
// document*'s compiled setter would silently re-cast our decrypted `number`
// back into a `"string"` the instant `decryptNumberFieldsOn` assigns it
// (`doc.vitals.weight = 75` through a `String` path setter becomes `"75"`),
// which a `.lean()` read (a plain object, no compiled setters) would *not* do
// — the same code would behave inconsistently depending on `.lean()`. `Mixed`
// performs no cast on get or set, so a plain assignment stores exactly the
// JS value handed to it (ciphertext string while encrypted, real number once
// decrypted) identically for hydrated and `.lean()` reads. Range/type
// validation for these fields already happens at the Zod layer before the
// value ever reaches Mongoose (same reasoning as `Patient.bloodGroup`
// dropping its schema-level enum once encrypted — see patient.model.ts).

/** Parses a decrypted/legacy vitals value back to a finite `number`, or `null`. */
function toNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Encrypts `fields` (numeric leaves) on a single object, in place. */
function encryptNumberFieldsOn(
  target:  unknown,
  fields:  string[],
  purpose: EncryptionKeyPurpose,
): void {
  if (!target || typeof target !== 'object') return;
  const record = target as MutableRecord;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value)) {
      record[field] = encryptField(String(value), purpose);
    } else if (
      typeof value === 'string' && value.length > 0 &&
      !isEncryptedField(value) && Number.isFinite(Number(value))
    ) {
      // Defensive: a numeric-string value that isn't ciphertext yet.
      record[field] = encryptField(value, purpose);
    }
  }
}

/** Decrypts `fields` (numeric leaves) on a doc returned from a read/write, normalising back to `number`. */
function decryptNumberFieldsOn(
  doc:     unknown,
  fields:  string[],
  purpose: EncryptionKeyPurpose,
): void {
  if (!doc || typeof doc !== 'object') return;
  const record = doc as MutableRecord;
  for (const field of fields) {
    const value = record[field];
    if (value == null) continue;
    if (typeof value === 'string' && value.length > 0 && isEncryptedField(value)) {
      record[field] = toNum(decryptField(value, purpose));
      continue;
    }
    // Legacy plaintext written before this field was encrypted — normalise to
    // a real number regardless of the BSON shape it was stored under.
    const n = toNum(value);
    if (n !== null) record[field] = n;
  }
}

/** Encrypts `spec`'s string/number sub-fields on a single nested object, in place. */
function encryptObjectFieldsOn(
  target:  unknown,
  spec:    EncryptedObjectFieldSpec,
  purpose: EncryptionKeyPurpose,
): void {
  if (!target || typeof target !== 'object') return;
  encryptFieldsOn(target, spec.stringFields ?? [], purpose);
  encryptNumberFieldsOn(target, spec.numberFields ?? [], purpose);
}

/** Decrypts object-subdocument fields on a doc returned from a read/write. */
function decryptObjectFieldsOn(
  doc:          unknown,
  objectFields: EncryptedObjectFieldSpec[],
  purpose:      EncryptionKeyPurpose,
): void {
  if (!doc || typeof doc !== 'object' || objectFields.length === 0) return;
  const record = doc as MutableRecord;
  for (const spec of objectFields) {
    const obj = record[spec.path];
    if (!obj || typeof obj !== 'object') continue;
    decryptFieldsOn(obj, spec.stringFields ?? [], purpose);
    decryptNumberFieldsOn(obj, spec.numberFields ?? [], purpose);
  }
}

// Encrypts single-nested-object fields in a write payload of any supported
// shape: a bare replacement object, `$set` / `$setOnInsert` (whole object or
// a dotted leaf field, e.g. `vitals.weight`).
function encryptObjectWritePayload(
  payload:      unknown,
  objectFields: EncryptedObjectFieldSpec[],
  purpose:      EncryptionKeyPurpose,
): void {
  if (!payload || typeof payload !== 'object' || objectFields.length === 0) return;
  const p = payload as MutableRecord;

  for (const spec of objectFields) {
    const { path } = spec;
    const stringFields = spec.stringFields ?? [];
    const numberFields = spec.numberFields ?? [];

    // bare replacement / no-operator update: { vitals: { ... } }
    encryptObjectFieldsOn(p[path], spec, purpose);

    for (const setKey of ['$set', '$setOnInsert'] as const) {
      const setObj = p[setKey];
      if (!setObj || typeof setObj !== 'object') continue;
      const s = setObj as MutableRecord;

      // whole-object replacement: { $set: { vitals: { ... } } }
      encryptObjectFieldsOn(s[path], spec, purpose);

      // dotted leaf targets: { $set: { 'vitals.weight': 75 } }
      const prefix = `${path}.`;
      for (const key of Object.keys(s)) {
        if (!key.startsWith(prefix)) continue;
        const leaf = key.slice(prefix.length);
        if (stringFields.includes(leaf)) encryptFieldsOn(s, [key], purpose);
        else if (numberFields.includes(leaf)) encryptNumberFieldsOn(s, [key], purpose);
      }
    }
  }
}

function decryptFieldsOn(
  doc:        unknown,
  fields:     string[],
  purpose:    EncryptionKeyPurpose,
  dateFields: string[] = [],
): void {
  if (!doc || typeof doc !== 'object') return;
  const record = doc as MutableRecord;
  for (const field of fields) {
    const value = record[field];
    if (value == null) continue;

    if (typeof value === 'string' && value.length > 0 && isEncryptedField(value)) {
      record[field] = decryptField(value, purpose);
      continue;
    }
    // Legacy plaintext (written before this field was encrypted). Date fields
    // are normalised to ISO-8601 so a value still stored as a BSON Date, or as
    // a locale/date string, matches what the encrypted path now returns; every
    // other field is passed through untouched.
    if (dateFields.includes(field)) {
      const iso = toIso(value);
      if (iso) record[field] = iso;
    }
  }
}

export function encryptedFieldsPlugin(schema: Schema, options: EncryptedFieldsOptions): void {
  const { fields, purpose } = options;
  const dateFields   = options.dateFields ?? [];
  const arrayFields  = options.arrayFields ?? [];
  const objectFields = options.objectFields ?? [];

  // ── Writes: document path ─────────────────────────────────────────────────

  schema.pre('save', function (next) {
    const doc = this as unknown as MutableRecord & { isModified(path: string): boolean };
    for (const field of fields) {
      if (doc.isModified(field)) encryptFieldsOn(doc, [field], purpose, dateFields);
    }
    for (const { path, fields: subFields } of arrayFields) {
      if (doc.isModified(path)) encryptArrayElements(doc[path], subFields, purpose);
    }
    for (const spec of objectFields) {
      if (doc.isModified(spec.path)) encryptObjectFieldsOn(doc[spec.path], spec, purpose);
    }
    next();
  });

  // Hand the in-memory document back to the caller (e.g. a repository's
  // create()/save() return value) with the plaintext restored.
  schema.post('save', function (doc: unknown) {
    decryptFieldsOn(doc, fields, purpose, dateFields);
    decryptArrayFieldsOn(doc, arrayFields, purpose);
    decryptObjectFieldsOn(doc, objectFields, purpose);
  });

  schema.pre('insertMany', function (next, docs: unknown) {
    if (Array.isArray(docs)) docs.forEach((doc) => {
      encryptWritePayload(doc, fields, purpose, dateFields);
      encryptArrayWritePayload(doc, arrayFields, purpose);
      encryptObjectWritePayload(doc, objectFields, purpose);
    });
    next();
  });

  // ── Writes: query path ────────────────────────────────────────────────────
  // Every operator that can carry field values into the collection. `this` is
  // the Query; getUpdate() returns the live update/replacement object, so
  // mutating it in place is what persists.
  function encryptUpdate(this: { getUpdate(): unknown }, next: (err?: Error) => void): void {
    const update = this.getUpdate();
    encryptWritePayload(update, fields, purpose, dateFields);
    encryptArrayWritePayload(update, arrayFields, purpose);
    encryptObjectWritePayload(update, objectFields, purpose);
    next();
  }

  schema.pre('updateOne',         encryptUpdate);
  schema.pre('updateMany',        encryptUpdate);
  schema.pre('findOneAndUpdate',  encryptUpdate);
  schema.pre('replaceOne',        encryptUpdate);
  schema.pre('findOneAndReplace', encryptUpdate);

  // ── Reads ─────────────────────────────────────────────────────────────────

  schema.post(['find'], function (docs: unknown) {
    if (Array.isArray(docs)) docs.forEach((doc) => {
      decryptFieldsOn(doc, fields, purpose, dateFields);
      decryptArrayFieldsOn(doc, arrayFields, purpose);
      decryptObjectFieldsOn(doc, objectFields, purpose);
    });
  });

  schema.post(['findOne', 'findOneAndUpdate', 'findOneAndReplace'], function (doc: unknown) {
    decryptFieldsOn(doc, fields, purpose, dateFields);
    decryptArrayFieldsOn(doc, arrayFields, purpose);
    decryptObjectFieldsOn(doc, objectFields, purpose);
  });
}

// Model.bulkWrite() does not run query middleware and, in this Mongoose
// version, its pre('bulkWrite') hook cannot reach the operations array to
// mutate it. Wrapping the model method is the only reliable way to keep bulk
// operations from writing plaintext. Call once, immediately after
// mongoose.model(). Idempotent — a second call is a no-op.
const BULK_WRITE_WRAPPED = new WeakSet<Model<unknown>>();

export function wrapModelBulkWrite<T>(
  model:   Model<T>,
  options: EncryptedFieldsOptions,
): void {
  const m = model as unknown as Model<unknown>;
  if (BULK_WRITE_WRAPPED.has(m)) return;
  BULK_WRITE_WRAPPED.add(m);

  const { fields, purpose } = options;
  const dateFields   = options.dateFields ?? [];
  const arrayFields  = options.arrayFields ?? [];
  const objectFields = options.objectFields ?? [];
  const original = model.bulkWrite.bind(model) as (...args: unknown[]) => unknown;

  const encryptOp = (payload: unknown): void => {
    encryptWritePayload(payload, fields, purpose, dateFields);
    encryptArrayWritePayload(payload, arrayFields, purpose);
    encryptObjectWritePayload(payload, objectFields, purpose);
  };

  (model as unknown as { bulkWrite: (...args: unknown[]) => unknown }).bulkWrite = function (
    ...args: unknown[]
  ) {
    const ops = args[0];
    if (Array.isArray(ops)) {
      for (const op of ops) {
        if (!op || typeof op !== 'object') continue;
        const o = op as MutableRecord;
        if (o.insertOne)  encryptOp((o.insertOne  as MutableRecord).document);
        if (o.updateOne)  encryptOp((o.updateOne  as MutableRecord).update);
        if (o.updateMany) encryptOp((o.updateMany as MutableRecord).update);
        if (o.replaceOne) encryptOp((o.replaceOne as MutableRecord).replacement);
      }
    }
    return original(...args);
  };
}
