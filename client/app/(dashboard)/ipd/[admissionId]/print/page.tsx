'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useGetAdmissionByIdQuery } from '@/store/api/ipd.api';
import { useGetPatientByIdQuery } from '@/store/api/patient.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { RichTextDisplay } from '@/components/ui/rich-text-display';
import type { ProgressNote } from '@/store/types';
import { formatPatientResponseAge } from '@/lib/patient-age';
import { getVitalDefinitions, getVitalSlipLabel, getVitalsCategory } from '@/lib/patient-vitals';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// True when a (possibly rich-text) value has visible text. Empty optional
// sections are hidden entirely so the ones below move up with no gap.
function hasText(value: string | null | undefined): boolean {
  return !!value && value.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim() !== '';
}

// Slip validity: 5 calendar days after the patient's registration date.
// setDate() rolls over month/year boundaries using each month's real length
// (e.g. 30 Sep -> 05 Oct, 31 Jan -> 05 Feb), never a naive day-number bump.
const SLIP_VALIDITY_DAYS = 5;
function computeValidTill(registeredAt: string): string {
  const d = new Date(registeredAt);
  d.setDate(d.getDate() + SLIP_VALIDITY_DAYS);
  return d.toISOString();
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function toDisplay(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function Field({ label, value, span, mono }: { label: string; value: string; span?: boolean; mono?: boolean }) {
  return (
    <div className={span ? 'col-span-3 break-words' : 'min-w-0 break-words'}>
      <span className="text-black">{label}: </span>
      <span className={mono ? 'font-mono' : 'font-medium text-black'}>{value}</span>
    </div>
  );
}

// One labelled Vitals line in the left-side column — "Label - value" on one
// row, no underline. A reading the app never collected leaves the space
// after the "-" blank. Mirrors the OPD parcha's VitalRow exactly. Spacing
// between rows comes from the parent's `space-y-*` (see the Vitals column
// below), not a per-row margin.
function VitalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-end gap-1 whitespace-nowrap leading-tight">
      <span className="shrink-0 text-[11px] text-black">{label}</span>
      <span className="shrink-0 text-[11px] text-black" aria-hidden="true">-</span>
      <span className="flex-1 min-w-0 min-h-[3.2mm] text-[13px] font-medium text-black">
        {value}
      </span>
    </div>
  );
}

// A single progress-note entry on the right — author + timestamp above the
// saved rich-text note. `break-inside-avoid` on each entry (not the whole
// list) so a long note list can still span multiple printed pages without
// splitting a single note awkwardly across a page break.
function ProgressNoteEntry({ note }: { note: ProgressNote }) {
  return (
    <div className="mt-3 first:mt-0 break-inside-avoid">
      <p className="text-[11px] text-black">
        {formatDateTime(note.timestamp)}
        {' — '}
        <span className="font-medium text-black">{note.staffName ?? 'Staff'}</span>
      </p>
      <RichTextDisplay value={note.note} fallback="" className="text-[13px] text-black" />
    </div>
  );
}

/**
 * Printable A4 IPD admission sheet for a single admission. Mirrors the OPD
 * parcha print page (client/app/(dashboard)/opd/[visitId]/print/page.tsx)
 * field-for-field wherever the data shapes line up — same hospital
 * letterhead, patient block, and Vitals box — adapted for IPD admission
 * data. Lives outside the IPD list/panel so the print output is limited to
 * this page's own content (no table/filters/modal chrome to hide), while
 * still rendering inside the (dashboard) layout so the existing auth guard
 * applies; the dashboard layout hides its sidebar/header via `print:hidden`
 * so only the .parcha-sheet below reaches the printer.
 *
 * Unlike an OPD visit, an IPDAdmission has no single diagnosis/prescription/
 * notes field — clinical narrative is only ever captured as a list of
 * timestamped progressNotes[]. The OPD parcha's fixed Diagnosis/Prescription/
 * Notes box is therefore replaced here with a chronological Progress Notes
 * list (same data/rendering the discharge-summary PDF already uses).
 */
export default function IPDAdmissionPrintPage({ params }: { params: { admissionId: string } }) {
  const { admissionId } = params;
  const branding = useAppSelector((s) => s.auth.branding);

  const { data: admission, isLoading: admissionLoading, isError: admissionError } = useGetAdmissionByIdQuery(admissionId);
  const { data: patient, isLoading: patientLoading, isError: patientError } = useGetPatientByIdQuery(
    admission?.patientId ?? '',
    { skip: !admission },
  );
  const { data: departments } = useListDepartmentsQuery();
  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = usersData?.data ?? [];

  const ready = !admissionLoading && !patientLoading && !!admission && !!patient;
  // Vitals set follows the department; with none, the patient's age decides
  // (under 18 → pediatric set).
  const vitalsCategory = getVitalsCategory(admission?.departmentId, departments, patient);
  const printedRef = useRef(false);

  // Phones/tablets print through the OS print service (iOS adds its own
  // margins + footer; Android picks the paper size in its dialog), so the
  // usable page is shorter than the full 297mm this sheet fills on desktop.
  // On those devices the sheet switches to a content-height print layout —
  // see `.parcha-mobile` in globals.css. Desktop never gets the class.
  const [mobilePrint, setMobilePrint] = useState(false);
  useEffect(() => {
    setMobilePrint(typeof window.matchMedia === 'function' && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }, []);

  // Auto-open the browser print dialog once the sheet has real data painted
  // — mirrors clicking "Print" so the IPD list's action truly "opens the
  // printable sheet" without a redundant extra click. The manual button
  // below remains as a fallback/re-print. Same 300ms settle delay as OPD's
  // print page.
  useEffect(() => {
    if (ready && !printedRef.current) {
      printedRef.current = true;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [ready]);

  function handlePrintClick() {
    window.print();
  }

  if (admissionLoading || patientLoading) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-sm text-muted-foreground print:hidden">
        Preparing…
      </div>
    );
  }

  if (admissionError || patientError || !admission || !patient) {
    return (
      <div className="max-w-lg mx-auto py-12 space-y-4 print:hidden">
        <Link href="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to IPD
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Admission not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  const departmentName = departments?.find((d) => d.departmentId === admission.departmentId)?.name ?? null;
  const doctorNames = (admission.assignedDoctorIds ?? [])
    .map((id) => doctors.find((d) => d.userId === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');

  const sortedNotes = [...admission.progressNotes].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  const hospitalName    = branding?.displayName || 'Hospital';
  const hospitalAddress = [branding?.addressLine, branding?.city, branding?.state, branding?.pincode]
    .filter(Boolean)
    .join(', ');

  // The on-screen preview IS the printed sheet: the same plain sheet, with
  // the same 3.5 cm top / 2 cm bottom blank space, on screen and on paper. No
  // uploaded hospital parcha template (PDF or image) is shown or printed
  // here, so whatever triggers printing from this page always prints exactly
  // what the preview shows. Mirrors the OPD parcha.
  const sheet = (
    <>
        {/* Plain A4 with no page margin (so the browser adds no
            date/title/URL/page-number header or footer). The 3.5 cm top /
            2 cm bottom space is the sheet's own padding, repeated on every
            printed page via box-decoration-break: clone. */}
        <div
          className={`parcha-sheet relative px-[16mm] pt-[35mm] pb-[20mm] print:box-decoration-clone text-[14px] text-black leading-snug${mobilePrint ? ' parcha-mobile' : ''}`}
        >
          <div className="parcha-content relative z-10 flex flex-col min-h-[242mm]">
          {/* Hospital header — never shown on the sheet (the 3.5 cm top space
              is left blank instead), on screen or in print. */}
          <div className="hidden">
            <div className="flex items-start gap-4">
              {branding?.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={branding.logoUrl} alt="" className="h-16 w-16 object-contain shrink-0" />
              )}
              <div className="flex-1 min-w-0 text-center">
                <h1 className="text-[22px] font-bold tracking-tight">{hospitalName}</h1>
                {hospitalAddress && <p className="text-[13px] text-black mt-0.5">{hospitalAddress}</p>}
                {branding?.contactEmail && <p className="text-[13px] text-black">{branding.contactEmail}</p>}
              </div>
              {branding?.logoUrl && <div className="h-16 w-16 shrink-0" aria-hidden="true" />}
            </div>
            <div className="mt-3 border-b-2 border-gray-800" />
          </div>

          {/* Patient + Admission details */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 text-[13.5px]">
            {/* Row 1 */}
            <Field label="Patient Name" value={patient.fullName} />
            <Field label="UHID"         value={patient.patientId} mono />
            <Field label="Age / Gender" value={`${formatPatientResponseAge(patient) ?? '—'} / ${toDisplay(patient.gender)}`} />

            {/* Row 2 */}
            <Field label="Mobile Number" value={patient.mobileNumber} />
            <Field label="Valid Till"    value={formatDate(computeValidTill(patient.createdAt))} />
            <Field label="Ward / Bed"    value={`${admission.wardName} / ${String(admission.bedNumber).replace(/^\s*bed[\s\-_:#]*/i, '')}`} />

            {/* Row 3 — Doctor/Department always rendered (blank when
                unassigned) so the grid columns stay aligned. */}
            <Field label="Admission Date" value={formatDate(admission.admissionDate)} />
            <Field label="Doctor"         value={doctorNames} />
            <Field label="Department"     value={departmentName ?? ''} />

            {/* Discharged admissions only — its own full-width line above Address. */}
            {admission.dischargeDate && <Field label="Discharge Date" value={formatDate(admission.dischargeDate)} span />}

            {/* Row 4 */}
            {patient.address && <Field label="Address" value={patient.address} span />}
          </div>

          <div className="mt-3 border-b border-gray-300" />

          {/* Vitals (left) + Progress Notes (right). `admission` comes straight
              from useGetAdmissionByIdQuery, which every IPD mutation
              (addProgressNote/updateAdmission/dischargePatient) invalidates
              (see ipd.api.ts's 'IPD' tag), so this always paints whatever was
              most recently saved, on every load of this page. A vital never
              recorded renders as a blank ruled line rather than a placeholder,
              so the printed sheet can still be filled in by hand for exactly
              the readings the app never collected — same convention as OPD. */}
          {/* Vitals + Progress Notes column, then the signature, in one block that grows
              to the bottom of the content area — i.e. exactly where the
              sheet's 2 cm bottom padding begins. The dark vertical line beside
              Vitals runs the full height of this block, so it always stops
              2 cm above the bottom of the slip. A border (not a background)
              so it prints even with "Background graphics" turned off. */}
          <div className="relative mt-4 flex flex-1 flex-col">
          <div aria-hidden="true" className="absolute top-0 bottom-0 left-[32mm] border-l border-gray-800" />
          <div className="flex">
            {/* Vitals stays compact/top-aligned. */}
            <div className="w-[32mm] shrink-0 pr-3 break-inside-avoid">
              <p className="text-[15px] font-bold uppercase tracking-wide text-black mb-2">
                Vitals
              </p>
              <div className="space-y-1.5">
                {getVitalDefinitions(vitalsCategory).map((definition) => (
                  <VitalRow
                    key={definition.key}
                    label={getVitalSlipLabel(definition, vitalsCategory)}
                    value={admission.vitals?.[definition.key] != null ? String(admission.vitals[definition.key]) : ''}
                  />
                ))}
              </div>
            </div>

            <div className="flex-1 pl-4 pb-3" style={{ minHeight: '80mm' }}>
              {sortedNotes.length > 0 && (
                <>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-black mb-1">Progress Notes</p>
                  {sortedNotes.map((note) => <ProgressNoteEntry key={note.noteId} note={note} />)}
                </>
              )}

              {hasText(admission.prescription) && (
                <>
                  <p className={`${sortedNotes.length > 0 ? 'mt-4 ' : ''}text-[12px] font-semibold uppercase tracking-wide text-black mb-1`}>Prescription</p>
                  <p className="text-[13px] text-black whitespace-pre-wrap break-inside-avoid">{admission.prescription}</p>
                </>
              )}
            </div>
          </div>

          {/* Signature */}
          <div className="order-last mt-auto pt-6 flex justify-end break-inside-avoid">
            <div className="w-56 text-center">
              <div className="border-t border-gray-500 pt-1 text-[13px] font-bold text-black">Doctor&apos;s Signature</div>
            </div>
          </div>
          </div>

          {/* Footer — not part of the sheet, on screen or in print */}
          <div className="hidden">
            Generated on {formatDateTime(new Date().toISOString())}
          </div>
          </div>
        </div>
    </>
  );

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
      {/* Screen-only toolbar */}
      <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between px-2 print:hidden">
        <Link href="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to IPD
        </Link>
        <Button size="sm" onClick={handlePrintClick}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      {sheet}
    </div>
  );
}
