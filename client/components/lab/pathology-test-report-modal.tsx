'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, FileText, Download, Pencil, CheckCircle2, RotateCcw } from 'lucide-react';
import {
  useSubmitPathologyTestReportMutation,
  useGetPathologyTestReportPdfMutation,
} from '@/store/api/lab.api';
import type { PathologyTestReport, PathologyReportField, PathologyResultFlag } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { NavForm } from '@/components/ui/form';
import { cn } from '@/lib/utils';

// Mirrors the backend's numeric result check (lab.service.ts NUMERIC_RESULT).
const NUMERIC_RESULT = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;
// Mirrors the backend's PATHOLOGY_CLINICAL_NOTE_MAX / PATHOLOGY_COMMENT_MAX.
const CLINICAL_TEXT_MAX = 2000;

const FLAG_LABEL: Record<PathologyResultFlag, string> = { HIGH: 'High', LOW: 'Low', ABNORMAL: 'Abnormal' };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

// Consecutive items sharing a section are grouped under one sub-heading.
function groupBySection<T extends { section: string | null }>(items: T[]): Array<{ section: string | null; items: T[] }> {
  const groups: Array<{ section: string | null; items: T[] }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

function pdfFileName(testName: string, patientId: string) {
  const slug = testName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'test';
  return `pathology-report-${slug}-${patientId}.pdf`;
}

const formatCalc = (n: number, digits = 2) => Number(n.toFixed(digits)).toString();
const numberValue = (values: Record<string, string>, key: string): number | null => {
  const raw = values[key]?.trim();
  if (!raw || !NUMERIC_RESULT.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * Recalculates derived fields from source values.
 *
 * `skipKeys` — keys the user has manually overridden. Those fields are never
 * auto-filled or cleared by this function, preserving the user's own value.
 */
function calculateReportValues(
  report:   PathologyTestReport,
  current:  Record<string, string>,
  skipKeys: ReadonlySet<string> = new Set(),
): Record<string, string> {
  const values = { ...current };
  const val = (key: string) => numberValue(values, key);
  // Only write to a key if it has not been manually overridden.
  const set = (key: string, value: number, digits = 2) => {
    if (!skipKeys.has(key)) values[key] = formatCalc(value, digits);
  };
  const clear = (key: string) => {
    if (!skipKeys.has(key)) values[key] = '';
  };

  if (report.templateKey === 'CBC') {
    const hb = val('hemoglobin');
    const rbc = val('rbc');
    const hct = val('hematocrit');
    const mcv = val('mcv');
    if (hb !== null && rbc !== null && rbc > 0) set('mch', (hb * 10) / rbc); else clear('mch');
    if (hb !== null && hct !== null && hct > 0) set('mchc', (hb * 100) / hct); else clear('mchc');
    if (!values.hematocrit?.trim() && rbc !== null && mcv !== null) set('hematocrit', (rbc * mcv) / 10);
  }
  if (report.templateKey === 'HBA1C') {
    const a1c = val('hba1c');
    if (a1c !== null) set('eag', (28.7 * a1c) - 46.7); else clear('eag');
  }
  if (report.templateKey === 'LFT' || report.templateKey === 'BILIRUBIN') {
    const total = val('totalBilirubin');
    const direct = val('directBilirubin');
    if (total !== null && direct !== null && direct <= total) set('indirectBilirubin', total - direct); else clear('indirectBilirubin');
  }
  if (report.templateKey === 'LFT') {
    const totalProtein = val('totalProtein');
    const albumin = val('albumin');
    if (totalProtein !== null && albumin !== null && albumin <= totalProtein) {
      const globulin = totalProtein - albumin;
      set('globulin', globulin);
      if (globulin > 0) set('agRatio', albumin / globulin); else clear('agRatio');
    } else {
      clear('globulin'); clear('agRatio');
    }
  }
  if (report.templateKey === 'KFT') {
    const urea = val('urea');
    if (urea !== null) set('bun', urea * 28 / 60); else clear('bun');
  }
  if (report.templateKey === 'LIPID') {
    const tc = val('totalCholesterol');
    const tg = val('triglycerides');
    const hdl = val('hdl');
    if (tg !== null && tg < 400) set('vldl', tg / 5); else clear('vldl');
    if (!values.ldl?.trim() && tc !== null && hdl !== null && tg !== null && tg < 400) set('ldl', tc - hdl - tg / 5);
    const ldl = val('ldl');
    if (tc !== null && hdl !== null && hdl > 0) set('cholHdlRatio', tc / hdl); else clear('cholHdlRatio');
    if (ldl !== null && hdl !== null && hdl > 0) set('ldlHdlRatio', ldl / hdl); else clear('ldlHdlRatio');
  }
  if (report.templateKey === 'RETIC') clear('absoluteRetic');
  if (report.templateKey === 'IRON_PROFILE') {
    const iron = val('serumIron');
    const tibc = val('tibc');
    const uibc = val('uibc');
    if (iron !== null && tibc !== null && iron <= tibc && !values.uibc?.trim()) set('uibc', tibc - iron);
    else if (iron !== null && uibc !== null && !values.tibc?.trim()) set('tibc', iron + uibc);
    const finalTibc = val('tibc');
    if (iron !== null && finalTibc !== null && finalTibc > 0) set('transferrinSaturation', (iron / finalTibc) * 100);
    else clear('transferrinSaturation');
  }
  return values;
}

/**
 * Compute what a calculated field's value *would be* if the user had not
 * overridden it. Used to show the reset hint and to restore on "↩ Reset".
 */
function getCalculatedValue(report: PathologyTestReport, values: Record<string, string>, key: string): string {
  // Run calculation with an empty skipKeys so this key gets filled normally.
  const computed = calculateReportValues(report, values, new Set());
  return computed[key] ?? '';
}

interface PathologyTestReportModalProps {
  requestId:   string;
  report:      PathologyTestReport;
  patientName: string;
  patientId:   string;
  // Lab staff (PATHOLOGIST / HOSPITAL_ADMIN) — mirrors the backend's
  // PUT /api/lab/pathology/:requestId/reports/:testIndex requireRole.
  canEnterResults: boolean;
  // Results can only be submitted once the request's payment is collected
  // (the backend also rejects an unpaid submission with 409).
  paid:        boolean;
  onClose:     () => void;
}

/**
 * One test of a Pathology request: a structured result-entry form for lab
 * staff, and the submitted report (filled values only) for everyone else —
 * with its own PDF to view/print or download. Each test is independent.
 */
export function PathologyTestReportModal({
  requestId, report, patientName, patientId, canEnterResults, paid, onClose,
}: PathologyTestReportModalProps) {
  const [current, setCurrent] = useState(report);
  const result = current.result;
  const [editing, setEditing] = useState(canEnterResults && paid && !result);
  const [justSubmitted, setJustSubmitted] = useState(false);

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`${current.testName} report`}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5 shrink-0">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold break-words">{current.testName}</h2>
            <p className="text-xs text-muted-foreground">
              {patientName} · <span className="font-mono">{patientId}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={result ? 'success' : 'warning'}>{result ? 'Report Submitted' : 'Pending'}</Badge>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {editing ? (
          <ReportEntryForm
            requestId={requestId}
            report={current}
            onCancel={result ? () => setEditing(false) : onClose}
            onSubmitted={(next) => { setCurrent(next); setEditing(false); setJustSubmitted(true); }}
          />
        ) : (
          <ReportView
            requestId={requestId}
            report={current}
            patientId={patientId}
            justSubmitted={justSubmitted}
            onEdit={canEnterResults && paid ? () => { setJustSubmitted(false); setEditing(true); } : undefined}
            entryBlockedReason={canEnterResults && !paid && !result
              ? 'Results can be entered once payment has been collected.'
              : null}
          />
        )}
      </div>
    </DialogOverlay>
  );
}

// ─── Entry form ───────────────────────────────────────────────────────────────

function ReportEntryForm({
  requestId, report, onCancel, onSubmitted,
}: {
  requestId:   string;
  report:      PathologyTestReport;
  onCancel:    () => void;
  onSubmitted: (next: PathologyTestReport) => void;
}) {
  const [submitReport, { isLoading }] = useSubmitPathologyTestReportMutation();
  // Pre-filled from the submitted report, so an amendment starts from it.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((report.result?.values ?? []).map((v) => [v.key, v.value])));
  // A submitted report reopens with its own saved text; a new one starts from
  // the Test Master defaults. Edits here are saved with this report only.
  const [clinicalNote, setClinicalNote] = useState(() =>
    (report.result ? report.result.clinicalNote : report.clinicalContent?.clinicalNote) ?? '');
  const [comment, setComment] = useState(() =>
    (report.result ? report.result.comment : report.clinicalContent?.comment) ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  // Keys whose `readOnly` flag marks them as auto-calculated by the system.
  const calculatedKeys = useMemo(() =>
    new Set(report.fields.filter((f) => f.readOnly).map((f) => f.key)), [report.fields]);

  // Tracks which calculated fields the user has manually edited. These keys
  // are excluded from auto-recalculation so the user's value is preserved.
  // Pre-populate from the saved report: any calculated field that already has
  // a stored value was either previously overridden or submitted as-is — treat
  // it as a manual value so we don't silently overwrite it on open.
  const [manualOverrides, setManualOverrides] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const f of report.fields) {
      if (f.readOnly && report.result?.values.find((v) => v.key === f.key)) {
        initial.add(f.key);
      }
    }
    return initial;
  });

  // Run initial calculation on mount (skipping already-overridden keys).
  useEffect(() => {
    setValues((prev) => {
      const next = calculateReportValues(report, prev, manualOverrides);
      return Object.keys(next).some((key) => next[key] !== prev[key]) ? next : prev;
    });
    // manualOverrides intentionally omitted — only run on report identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  /**
   * Called whenever any field value changes.
   * - For source fields: recalculate derived fields, honoring manual overrides.
   * - For calculated fields: record as a manual override first, then recalculate
   *   the rest (other derived fields may still depend on this one's new value).
   */
  function setValue(key: string, value: string) {
    setValues((prev) => {
      let overrides = manualOverrides;
      if (calculatedKeys.has(key)) {
        // User is manually editing a calculated field — add it to overrides.
        overrides = new Set(manualOverrides).add(key);
        setManualOverrides(overrides);
        // Apply value directly, then recalculate other derived fields.
        return calculateReportValues(report, { ...prev, [key]: value }, overrides);
      }
      // Source field changed — recalculate derived fields, skip manual ones.
      return calculateReportValues(report, { ...prev, [key]: value }, overrides);
    });
    setFieldErrors((prev) => { const { [key]: _, ...rest } = prev; return rest; });
  }

  /**
   * Resets a manually-overridden calculated field back to its auto-computed
   * value, removing it from the manual overrides set.
   */
  function resetCalculatedField(key: string) {
    setManualOverrides((prev) => {
      const next = new Set(prev);
      next.delete(key);
      setValues((prevValues) => {
        return calculateReportValues(report, prevValues, next);
      });
      return next;
    });
    setFieldErrors((prev) => { const { [key]: _, ...rest } = prev; return rest; });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const errors: Record<string, string> = {};
    for (const f of report.fields) {
      const v = values[f.key]?.trim();
      if (v && f.inputType === 'number' && !NUMERIC_RESULT.test(v)) errors[f.key] = 'Enter a number.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) { setError('Please correct the highlighted fields.'); return; }
    const filled = report.fields.some((f) => values[f.key]?.trim());
    if (!filled) { setError('Enter at least one result before submitting the report.'); return; }

    try {
      const updated = await submitReport({
        requestId,
        testIndex: report.testIndex,
        testName:  report.testName,
        values:    Object.fromEntries(report.fields.map((f) => [f.key, values[f.key]?.trim() || null])),
        // Free-text Remarks were replaced by Clinical Notes / Comment; a legacy
        // report's stored remarks are carried over, never dropped.
        remarks:      report.result?.remarks ?? null,
        clinicalNote: clinicalNote.trim() || null,
        comment:      comment.trim() || null,
      }).unwrap();
      const next = updated.testReports?.find((r) => r.testIndex === report.testIndex);
      onSubmitted(next ?? report);
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to submit the report. Please try again.');
    }
  }

  return (
    <NavForm onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <p className="text-xs text-muted-foreground">
          All fields are optional — enter only the results available. Empty fields are left out of the report.
        </p>
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {groupBySection(report.fields).map((group, gi) => (
          <fieldset key={gi} className="space-y-3">
            {group.section && (
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{group.section}</legend>
            )}
            {group.items.map((field) => (
              <ParameterInput
                key={field.key}
                field={field}
                value={values[field.key] ?? ''}
                error={fieldErrors[field.key]}
                isCalculated={calculatedKeys.has(field.key)}
                isManualOverride={manualOverrides.has(field.key)}
                calculatedValue={
                  calculatedKeys.has(field.key) && manualOverrides.has(field.key)
                    ? getCalculatedValue(report, values, field.key)
                    : undefined
                }
                onReset={
                  calculatedKeys.has(field.key) && manualOverrides.has(field.key)
                    ? () => resetCalculatedField(field.key)
                    : undefined
                }
                onChange={(v) => setValue(field.key, v)}
              />
            ))}
          </fieldset>
        ))}

        <ClinicalTextInput
          id="report-clinical-note"
          label="Clinical Notes"
          value={clinicalNote}
          onChange={setClinicalNote}
          placeholder="Optional clinical notes for this report"
        />
        <ClinicalTextInput
          id="report-comment"
          label="Comment"
          value={comment}
          onChange={setComment}
          placeholder="Optional comment for this report"
        />
      </div>

      <div className="flex justify-end gap-3 border-t p-5 shrink-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>Cancel</Button>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? 'Submitting…' : 'Submit Report'}
        </Button>
      </div>
    </NavForm>
  );
}

function ClinicalTextInput({
  id, label, value, onChange, placeholder,
}: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        value={value}
        maxLength={CLINICAL_TEXT_MAX}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder={placeholder}
      />
    </div>
  );
}

function ParameterInput({
  field, value, error, isCalculated, isManualOverride, calculatedValue, onReset, onChange,
}: {
  field:              PathologyReportField;
  value:              string;
  error?:             string;
  /** True when this field is auto-computed from other inputs. */
  isCalculated:       boolean;
  /** True when the user has manually edited this calculated field. */
  isManualOverride:   boolean;
  /**
   * The value this field would have if auto-calculated (only provided when
   * `isCalculated && isManualOverride`, so the reset hint can show it).
   */
  calculatedValue?:   string;
  /** Callback to revert the field to its auto-calculated value. */
  onReset?:           () => void;
  onChange:           (v: string) => void;
}) {
  const id = `param-${field.key}`;

  // A calculated field that hasn't been manually overridden shows a soft hint.
  // One that has been overridden shows a "reset" affordance so the user can
  // revert to the computed value at any time.
  const showAutoHint     = isCalculated && !isManualOverride && !!value;
  const showOverrideHint = isCalculated && isManualOverride;

  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="break-words">{field.name}</Label>
        {field.referenceRange && (
          <p className="text-xs text-muted-foreground break-words">Ref: {field.referenceRange}</p>
        )}
        {showAutoHint && (
          <p className="mt-0.5 text-[11px] text-blue-600 dark:text-blue-400">Auto-calculated</p>
        )}
        {showOverrideHint && (
          <p className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">Manually edited</p>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {field.inputType === 'select' ? (
            <select
              id={id}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">—</option>
              {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <Input
              id={id}
              value={value}
              inputMode={field.inputType === 'number' ? 'decimal' : undefined}
              maxLength={500}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={isCalculated ? `${id}-hint` : undefined}
              className={cn(
                error && 'border-destructive',
                // Calculated-but-not-overridden: subtle blue tint to signal auto-fill.
                isCalculated && !isManualOverride && value && 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/30',
                // Overridden: amber tint to signal user-modified.
                isCalculated && isManualOverride && 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30',
              )}
            />
          )}
          {field.unit && <span className="w-20 shrink-0 text-xs text-muted-foreground break-words">{field.unit}</span>}
          {/* Reset button — only shown when user has manually overridden a calculated field */}
          {onReset && (
            <button
              type="button"
              onClick={onReset}
              title={calculatedValue ? `Reset to calculated value: ${calculatedValue}` : 'Reset to calculated value'}
              aria-label={`Reset ${field.name} to calculated value`}
              className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        {/* Screen-reader hint */}
        {isCalculated && (
          <p id={`${id}-hint`} className="sr-only">
            {isManualOverride
              ? 'You have manually edited this auto-calculated field. Use the reset button to restore the computed value.'
              : 'This value is automatically calculated from other fields. You may edit it directly.'}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Submitted report view ────────────────────────────────────────────────────

function ReportView({
  requestId, report, patientId, justSubmitted, onEdit, entryBlockedReason,
}: {
  requestId:          string;
  report:             PathologyTestReport;
  patientId:          string;
  justSubmitted:      boolean;
  onEdit?:            () => void;
  entryBlockedReason: string | null;
}) {
  const [getPdf, { isLoading: pdfLoading }] = useGetPathologyTestReportPdfMutation();
  const [pdfError, setPdfError] = useState('');
  const result = report.result;

  async function loadPdf(letterhead = false): Promise<string | null> {
    setPdfError('');
    const res = await getPdf({ requestId, testIndex: report.testIndex, ...(letterhead ? { letterhead: true } : {}) });
    if ('data' in res && res.data) return res.data;
    setPdfError('Could not load the report PDF. Please try again.');
    return null;
  }

  async function handleView() {
    // Opened before the fetch so the browser treats it as user-initiated.
    const win = window.open('', '_blank');
    const url = await loadPdf();
    if (url && win) win.location.href = url;
    else win?.close();
  }

  async function handleDownload() {
    // The downloaded copy carries the hospital letterhead + Doctor Signature.
    const url = await loadPdf(true);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfFileName(report.testName, patientId);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {justSubmitted && (
          <p className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> Report submitted. It is now available to the doctor.
          </p>
        )}
        {!result ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {entryBlockedReason ?? 'The report for this test has not been submitted yet.'}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm" aria-label={`${report.testName} results`}>
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Parameter</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Reference Range</th>
                  </tr>
                </thead>
                <tbody>
                  {groupBySection(result.values).map((group, gi) => (
                    <ResultGroup key={gi} section={group.section} values={group.items} />
                  ))}
                </tbody>
              </table>
            </div>
            <ClinicalContent clinicalNote={result.clinicalNote} comment={result.comment} />
            <p className="text-xs text-muted-foreground">
              Reported by {result.submittedByName} on {formatDateTime(result.submittedAt)}
            </p>
            {pdfError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{pdfError}</p>}
          </>
        )}
      </div>

      {(result || onEdit) && (
        <div className="flex flex-wrap justify-end gap-3 border-t p-5 shrink-0">
          {onEdit && (
            <Button variant="outline" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              {result ? 'Edit Results' : 'Enter Results'}
            </Button>
          )}
          {result && (
            <>
              <Button variant="outline" onClick={handleView} disabled={pdfLoading}>
                <FileText className="h-4 w-4 mr-2" />
                View / Print PDF
              </Button>
              <Button onClick={handleDownload} disabled={pdfLoading}>
                <Download className="h-4 w-4 mr-2" />
                {pdfLoading ? 'Preparing…' : 'Download PDF'}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );
}

// The submitted report's Clinical Notes / Comment, exactly as they print on
// its PDF (each omitted when empty).
function ClinicalContent({ clinicalNote, comment }: { clinicalNote: string | null; comment: string | null }) {
  const sections = [
    { title: 'Clinical Notes', text: clinicalNote },
    { title: 'Comment',        text: comment },
  ].filter((s): s is { title: string; text: string } => !!s.text?.trim());
  if (sections.length === 0) return null;
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function ResultGroup({ section, values }: { section: string | null; values: NonNullable<PathologyTestReport['result']>['values'] }) {
  return (
    <>
      {section && (
        <tr>
          <td colSpan={4} className="border-t px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {section}
          </td>
        </tr>
      )}
      {values.map((v) => (
        <tr key={v.key} className="border-t align-top">
          <td className="px-3 py-2 break-words">{v.name}</td>
          <td className={cn('px-3 py-2 break-words', v.flag && 'font-semibold text-destructive')}>
            {v.value}
            {v.flag && (
              <span className="ml-2 inline-block rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold">
                {FLAG_LABEL[v.flag]}
              </span>
            )}
          </td>
          <td className="px-3 py-2 text-muted-foreground">{v.unit ?? '—'}</td>
          <td className="px-3 py-2 text-muted-foreground break-words">{v.referenceRange ?? '—'}</td>
        </tr>
      ))}
    </>
  );
}
