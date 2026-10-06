'use client';

import { useState } from 'react';
import { X, Pencil, Search } from 'lucide-react';
import {
  useListPathologyTestMasterQuery,
  useUpdatePathologyTestMasterMutation,
} from '@/store/api/lab.api';
import type { PathologyTestMasterEntry } from '@/store/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DialogOverlay } from '@/components/ui/dialog-overlay';
import { NavForm } from '@/components/ui/form';

// Mirrors the backend limits (lab.types.ts PATHOLOGY_*_MAX).
const CLINICAL_NOTE_MAX = 2000;
const COMMENT_MAX       = 2000;
const CORRELATE_MAX     = 1000;

const TEXTAREA_CLASS =
  'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Lab → Test Master: each pathology test's Clinical Note, Comment and
 * "Please Correlate Clinically" footer, as printed on its report. Reports
 * always use the currently saved values. Lab staff only (PATHOLOGIST /
 * HOSPITAL_ADMIN) — mirrors the backend's requireRole.
 */
export function PathologyTestMaster() {
  const { data, isLoading, isError, refetch } = useListPathologyTestMasterQuery();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PathologyTestMasterEntry | null>(null);

  const q = search.trim().toLowerCase();
  const rows = (data ?? []).filter((t) => !q || t.testName.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Clinical content printed on each pathology test report. Changes apply to every report generated afterwards.
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tests"
            aria-label="Search tests"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading tests…</p>
      ) : isError ? (
        <div className="py-10 text-center text-sm text-destructive">
          Failed to load the Test Master.{' '}
          <button className="underline" onClick={() => refetch()}>Retry</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" aria-label="Pathology Test Master">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Test</th>
                <th className="px-3 py-2 font-medium">Clinical Note</th>
                <th className="px-3 py-2 font-medium">Comment</th>
                <th className="px-3 py-2 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">No tests match your search.</td></tr>
              ) : rows.map((t) => (
                <tr key={t.templateKey} className="border-t align-top">
                  <td className="px-3 py-2 font-medium break-words min-w-[10rem]">{t.testName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span className="line-clamp-2 break-words">{t.clinicalNote ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2">
                    {t.comment ? <Badge variant="secondary">Configured</Badge> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)} aria-label={`Edit ${t.testName}`}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <TestMasterEditModal entry={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TestMasterEditModal({ entry, onClose }: { entry: PathologyTestMasterEntry; onClose: () => void }) {
  const [update, { isLoading }] = useUpdatePathologyTestMasterMutation();
  const [clinicalNote, setClinicalNote] = useState(entry.clinicalNote ?? '');
  const [comment, setComment] = useState(entry.comment ?? '');
  const [correlate, setCorrelate] = useState(entry.correlateClinically ?? '');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!correlate.trim()) { setError('Please Correlate Clinically text is required.'); return; }
    try {
      await update({
        templateKey:         entry.templateKey,
        clinicalNote:        clinicalNote.trim() || null,
        comment:             comment.trim() || null,
        correlateClinically: correlate.trim(),
      }).unwrap();
      onClose();
    } catch (err: any) {
      setError(err?.data?.message ?? 'Failed to save. Please try again.');
    }
  }

  return (
    <DialogOverlay className="items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Edit ${entry.testName}`}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b p-5 shrink-0">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold break-words">{entry.testName}</h2>
            <p className="text-xs text-muted-foreground">Test Master — report clinical content</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <NavForm onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="tm-clinical-note">Clinical Note</Label>
              <textarea
                id="tm-clinical-note" rows={4} maxLength={CLINICAL_NOTE_MAX} className={TEXTAREA_CLASS}
                value={clinicalNote} onChange={(e) => setClinicalNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Printed under “Clinical Notes”. Leave empty to omit.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-comment">Comment</Label>
              <textarea
                id="tm-comment" rows={4} maxLength={COMMENT_MAX} className={TEXTAREA_CLASS}
                value={comment} onChange={(e) => setComment(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Only for tests that need a test-specific comment. Leave empty to omit.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-correlate">Please Correlate Clinically</Label>
              <textarea
                id="tm-correlate" rows={3} maxLength={CORRELATE_MAX} className={TEXTAREA_CLASS}
                value={correlate} onChange={(e) => setCorrelate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Footer at the bottom of the report. Required.</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t p-5 shrink-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Saving…' : 'Save'}</Button>
          </div>
        </NavForm>
      </div>
    </DialogOverlay>
  );
}
