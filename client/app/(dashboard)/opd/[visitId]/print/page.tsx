'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useGetOPDVisitByIdQuery } from '@/store/api/opd.api';
import { useGetPatientByIdQuery } from '@/store/api/patient.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { RichTextDisplay } from '@/components/ui/rich-text-display';

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

// Mirrors server/src/shared/services/pdf.service.ts calculateAge — kept in
// sync manually since the client has no shared date-math utility yet.
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
    <div className={span ? 'col-span-3 break-words' : 'min-w-0 break-words'}>
      <span className="text-black">{label}: </span>
      <span className={mono ? 'font-mono' : 'font-medium text-black'}>{value}</span>
    </div>
  );
}

// One labelled Vitals line in the left-side column — "Label - value" on one
// row, no underline. A reading the app never collected leaves the space
// after the "-" blank so it can still be filled in by hand.
// Spacing between rows comes from the parent's `space-y-*` (see the Vitals
// column below), not a per-row margin.
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

// A labelled clinical block on the right — renders the saved value when
// present, or a blank ruled line (same "fill in by hand" affordance as
// Vitals) when the visit doesn't have one yet.
function ClinicalField({
  label, value, minHeight, children,
}: { label: string; value?: string | null; minHeight: string; children?: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-black mb-0.5">{label}</p>
      {children ?? (
        <p
          className="whitespace-pre-wrap text-[13px] text-black border-b border-gray-300"
          style={{ minHeight }}
        >
          {value ?? ''}
        </p>
      )}
    </div>
  );
}

/**
 * Printable A4 OPD Parcha for a single visit. Deliberately lives outside the
 * OPD list/panel — a dedicated route keeps the print output limited to this
 * page's own content (no table/filters/modal chrome to hide), while still
 * rendering inside the (dashboard) layout so the existing auth guard applies.
 * The dashboard layout hides its sidebar/header via `print:hidden` so only
 * the .parcha-sheet below reaches the printer.
 */
export default function OPDParchaPrintPage({ params }: { params: { visitId: string } }) {
  const { visitId } = params;
  const branding = useAppSelector((s) => s.auth.branding);

  const { data: visit, isLoading: visitLoading, isError: visitError } = useGetOPDVisitByIdQuery(visitId);
  const { data: patient, isLoading: patientLoading, isError: patientError } = useGetPatientByIdQuery(
    visit?.patientId ?? '',
    { skip: !visit },
  );
  const { data: departments } = useListDepartmentsQuery();
  const { data: usersData } = useListUsersQuery({ role: 'DOCTOR', isActive: true, limit: 100 });
  const doctors = usersData?.data ?? [];

  const ready = !visitLoading && !patientLoading && !!visit && !!patient;
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

  // Auto-open the browser print dialog once the parcha has real data painted
  // — mirrors clicking "Print" so the OPD list's action truly "opens the
  // printable parcha" without a redundant extra click. The manual button
  // below remains as a fallback/re-print.
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

  if (visitLoading || patientLoading) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-sm text-muted-foreground print:hidden">
        Preparing 
      </div>
    );
  }

  if (visitError || patientError || !visit || !patient) {
    return (
      <div className="max-w-lg mx-auto py-12 space-y-4 print:hidden">
        <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to OPD
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Visit not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  const departmentName = departments?.find((d) => d.departmentId === visit.departmentId)?.name ?? null;
  const doctorNames = (visit.doctorIds ?? [])
    .map((id) => doctors.find((d) => d.userId === id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(', ');

  const hospitalName    = branding?.displayName || 'Hospital';
  const hospitalAddress = [branding?.addressLine, branding?.city, branding?.state, branding?.pincode]
    .filter(Boolean)
    .join(', ');

  // The on-screen preview IS the printed slip: the same plain sheet, with the
  // same 3.5 cm top / 2 cm bottom blank space, on screen and on paper. No
  // uploaded hospital parcha template (PDF or image) is shown or printed
  // here, so whatever triggers printing from this page always prints exactly
  // what the preview shows.
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
          {/* Hospital header — never shown on the slip (the 3.5 cm top space
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

          {/* Patient + Visit details */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 text-[13.5px]">
            {/* Row 1 */}
            <Field label="Patient Name" value={patient.fullName} />
            <Field label="UHID"         value={patient.patientId} mono />
            <Field label="Visit Date"   value={formatDate(visit.visitDate)} />

            {/* Row 2 */}
            <Field label="Age / Gender"  value={`${patient.age ?? (patient.dateOfBirth ? calculateAge(patient.dateOfBirth) : '—')} years / ${toDisplay(patient.gender)}`} />
            <Field label="Mobile Number" value={patient.mobileNumber} />
            <Field label="Valid Till"    value={formatDate(computeValidTill(patient.createdAt))} />

            {/* Row 3 — always rendered (blank when unassigned) so the
                Address row below keeps its own line. */}
            <Field label="Doctor"     value={doctorNames} />
            <Field label="Department" value={departmentName ?? ''} />
            <div aria-hidden="true" />

            {/* Row 4 */}
            {patient.address && <Field label="Address" value={patient.address} span />}
          </div>

          <div className="mt-3 border-b border-gray-300" />

          {/* Vitals (left) + Diagnosis/Prescription/Notes (right) — replaces
              the previous blank writing box. `visit` comes straight from
              useGetOPDVisitByIdQuery, which the OPD Edit/Complete mutations
              invalidate (see opd.api.ts's 'OPD' tag), so this always paints
              whatever was most recently saved, on every load of this page. A
              vital never recorded renders as a blank ruled line rather than a
              placeholder, so the printed sheet can still be filled in by hand
              for exactly the readings the app never collected. */}
          {/* Vitals + clinical column, then the signature, in one block that grows
              to the bottom of the content area — i.e. exactly where the
              sheet's 2 cm bottom padding begins. The dark vertical line beside
              Vitals runs the full height of this block, so it always stops
              2 cm above the bottom of the slip. A border (not a background)
              so it prints even with "Background graphics" turned off. */}
          <div className="relative mt-4 flex flex-1 flex-col">
          <div aria-hidden="true" className="absolute top-0 bottom-0 left-[32mm] border-l border-gray-800" />
          <div className="flex break-inside-avoid">
            {/* Vitals stays compact/top-aligned. */}
            <div className="w-[32mm] shrink-0 pr-3">
              <p className="text-[15px] font-bold uppercase tracking-wide text-black mb-2">Vitals</p>
              <div className="space-y-1.5">
                <VitalRow label="SpO2"   value={visit.vitals?.spo2            != null ? String(visit.vitals.spo2)            : ''} />
                <VitalRow label="Temp"   value={visit.vitals?.bodyTemperature != null ? String(visit.vitals.bodyTemperature) : ''} />
                <VitalRow label="BP"     value={visit.vitals?.bloodPressure   ?? ''} />
                <VitalRow label="Pulse"  value={visit.vitals?.pulse           != null ? String(visit.vitals.pulse)           : ''} />
                <VitalRow label="Sugar"  value={visit.vitals?.sugar           != null ? String(visit.vitals.sugar)           : ''} />
                <VitalRow label="Height" value={visit.vitals?.height          != null ? String(visit.vitals.height)          : ''} />
                <VitalRow label="Weight" value={visit.vitals?.weight          != null ? String(visit.vitals.weight)          : ''} />
              </div>
            </div>

            <div
              className="parcha-fill flex-1 pl-4"
              style={{ minHeight: hasText(visit.diagnosis) || hasText(visit.prescription) || hasText(visit.notes) ? '150mm' : undefined }}
            >
              {hasText(visit.diagnosis) && (
                <ClinicalField label="Diagnosis"    value={visit.diagnosis}    minHeight="10mm" />
              )}
              {hasText(visit.prescription) && (
                <ClinicalField label="Prescription" value={visit.prescription} minHeight="60mm" />
              )}
              {hasText(visit.notes) && (
                <ClinicalField label="Notes" minHeight="40mm">
                  <div className="min-h-[40mm]">
                    <RichTextDisplay value={visit.notes} fallback="" className="text-[13px]" />
                  </div>
                </ClinicalField>
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

          {/* Footer — not part of the slip, on screen or in print */}
          <div className="hidden">
            This is valid for 15 days.
          </div>
          </div>
        </div>
    </>
  );

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
      {/* Screen-only toolbar */}
      <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between px-2 print:hidden">
        <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to OPD
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
