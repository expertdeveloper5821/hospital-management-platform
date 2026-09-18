'use client';

import { useEffect, useRef } from 'react';
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Mirrors server/src/shared/services/pdf.service.ts calculateAge — kept in
// sync manually since the client has no shared date-math utility yet (same
// duplication the OPD print page already carries).
function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return Math.max(0, age);
}

function toDisplay(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function Field({ label, value, span, mono }: { label: string; value: string; span?: boolean; mono?: boolean }) {
  return (
    <div className={span ? 'col-span-2' : undefined}>
      <span className="text-gray-500">{label}: </span>
      <span className={mono ? 'font-mono' : 'font-medium text-gray-900'}>{value}</span>
    </div>
  );
}

// One labelled Vitals line in the left-side box — value on top of a ruled
// line so a reading the app never collected can still be filled in by hand
// on the printed sheet. Mirrors the OPD parcha's VitalRow exactly.
function VitalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-[9px] text-gray-500 leading-tight">{label}</p>
      <p className="min-h-[3.2mm] border-b border-gray-300 text-[11px] font-medium text-gray-900 leading-tight">
        {value}
      </p>
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
      <p className="text-[9px] text-gray-500">
        {formatDateTime(note.timestamp)}
        {' — '}
        <span className="font-medium text-gray-700">{note.staffName ?? 'Staff'}</span>
      </p>
      <RichTextDisplay value={note.note} fallback="" className="text-[11px] text-gray-900" />
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
  const printedRef = useRef(false);

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

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
      {/* Screen-only toolbar */}
      <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between px-2 print:hidden">
        <Link href="/ipd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to IPD
        </Link>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" />
          Print
        </Button>
      </div>

      {/* A4 sheet — the only thing meant to reach the printer */}
      <div className="parcha-sheet px-[16mm] py-[14mm] text-[12px] leading-snug">
        {/* Hospital header */}
        <div className="flex items-start gap-4">
          {branding?.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt="" className="h-16 w-16 object-contain shrink-0" />
          )}
          <div className="flex-1 min-w-0 text-center">
            <h1 className="text-xl font-bold tracking-tight">{hospitalName}</h1>
            {hospitalAddress && <p className="text-[11px] text-gray-600 mt-0.5">{hospitalAddress}</p>}
            {branding?.contactEmail && <p className="text-[11px] text-gray-600">{branding.contactEmail}</p>}
          </div>
          {branding?.logoUrl && <div className="h-16 w-16 shrink-0" aria-hidden="true" />}
        </div>
        <div className="mt-3 border-b-2 border-gray-800" />

        {/* Patient + Admission details */}
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11.5px]">
          <Field label="Patient Name" value={patient.fullName} />
          <Field label="Patient ID"   value={patient.patientId} mono />
          <Field label="Age / Gender" value={`${calculateAge(patient.dateOfBirth)} years / ${toDisplay(patient.gender)}`} />
          <Field label="Mobile"       value={patient.mobileNumber} />
          {patient.address && <Field label="Address" value={patient.address} span />}
          {patient.bloodGroup && <Field label="Blood Group" value={patient.bloodGroup} />}

          <Field label="Admission ID"   value={admission.admissionId} mono />
          <Field label="Status"         value={toDisplay(admission.status)} />
          <Field label="Ward / Bed"     value={`${admission.wardName} / Bed ${admission.bedNumber}`} />
          {departmentName && <Field label="Department" value={departmentName} />}
          {doctorNames && <Field label="Doctor(s)" value={doctorNames} />}
          <Field label="Admission Date" value={formatDate(admission.admissionDate)} />
          {admission.dischargeDate && <Field label="Discharge Date" value={formatDate(admission.dischargeDate)} />}
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
        <div className="mt-4 flex gap-4 items-start">
          <div className="w-[42mm] shrink-0 border border-gray-300 rounded-sm p-2.5 break-inside-avoid" style={{ minHeight: '80mm' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Vitals</p>
            <VitalRow label="Weight (kg)"           value={admission.vitals?.weight          != null ? String(admission.vitals.weight)          : ''} />
            <VitalRow label="Height (cm)"            value={admission.vitals?.height          != null ? String(admission.vitals.height)          : ''} />
            <VitalRow label="Blood Pressure (mmHg)"  value={admission.vitals?.bloodPressure   ?? ''} />
            <VitalRow label="Sugar (mg/dL)"          value={admission.vitals?.sugar           != null ? String(admission.vitals.sugar)           : ''} />
            <VitalRow label="Body Temperature (°F)"  value={admission.vitals?.bodyTemperature != null ? String(admission.vitals.bodyTemperature) : ''} />
          </div>

          <div className="flex-1 border border-gray-300 rounded-sm p-2.5" style={{ minHeight: '80mm' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Progress Notes</p>
            {sortedNotes.length === 0 ? (
              <p className="text-[11px] text-gray-400 italic">No progress notes recorded.</p>
            ) : (
              sortedNotes.map((note) => <ProgressNoteEntry key={note.noteId} note={note} />)
            )}
          </div>
        </div>

        {/* Signature */}
        <div className="mt-6 flex justify-end break-inside-avoid">
          <div className="w-56 text-center">
            <div className="border-t border-gray-500 pt-1 text-[11px] text-gray-600">Doctor&apos;s Signature</div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-2 border-t border-gray-200 text-center text-[10px] text-gray-500">
          Generated on {formatDateTime(new Date().toISOString())}
        </div>
      </div>
    </div>
  );
}
