'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useGetOPDVisitByIdQuery, useGetOPDParchaPdfMutation } from '@/store/api/opd.api';
import { useGetPatientByIdQuery } from '@/store/api/patient.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';
import { RichTextDisplay } from '@/components/ui/rich-text-display';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
    <div className={span ? 'col-span-2' : undefined}>
      <span className="text-gray-500">{label}: </span>
      <span className={mono ? 'font-mono' : 'font-medium text-gray-900'}>{value}</span>
    </div>
  );
}

// One labelled Vitals line in the left-side column — value on top of a ruled
// line so a reading the app never collected can still be filled in by hand
// on the printed sheet, exactly like the blank box this section replaced.
// Spacing between rows comes from the parent's `space-y-*` (see the Vitals
// column below), not a per-row margin.
function VitalRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-gray-500 leading-tight">{label}</p>
      <p className="min-h-[3.2mm] border-b border-gray-300 text-[11px] font-medium text-gray-900 leading-tight">
        {value}
      </p>
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
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">{label}</p>
      {children ?? (
        <p
          className="whitespace-pre-wrap text-[11px] text-gray-900 border-b border-gray-300"
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

  // A PDF template is rendered server-side (the uploaded PDF page merged
  // with this visit's data — see server/src/shared/services/parcha-template
  // .service.ts) and previewed/printed via an <iframe>, not the HTML layout
  // below. An image template keeps using the existing <img>-background
  // overlay; no template falls through to the default HTML header/layout.
  const hasPdfTemplate = !!branding?.parchaTemplateUrl && /\.pdf(\?|$)/i.test(branding.parchaTemplateUrl);

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
  const pdfPrintedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [fetchParchaPdf] = useGetOPDParchaPdfMutation();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  // true once the merged-PDF fetch has failed (404 = no PDF template
  // actually available server-side despite the URL looking like one, or a
  // network/render error) — falls back to the default HTML layout rather
  // than leaving the page stuck on "Preparing…".
  const [pdfError, setPdfError] = useState(false);

  useEffect(() => {
    if (!hasPdfTemplate || !ready || pdfUrl || pdfError) return;
    let cancelled = false;
    fetchParchaPdf(visitId).then((result) => {
      if (cancelled) return;
      if ('data' in result && result.data) {
        setPdfUrl(result.data);
      } else {
        setPdfError(true);
      }
    });
    return () => { cancelled = true; };
  }, [hasPdfTemplate, ready, pdfUrl, pdfError, fetchParchaPdf, visitId]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const showPdfTemplate = hasPdfTemplate && !pdfError;

  // Auto-open the browser print dialog once the parcha has real data painted
  // — mirrors clicking "Print" so the OPD list's action truly "opens the
  // printable parcha" without a redundant extra click. The manual button
  // below remains as a fallback/re-print. Skipped for a PDF template — that
  // path prints via the iframe's own onLoad below instead.
  useEffect(() => {
    if (ready && !showPdfTemplate && !printedRef.current) {
      printedRef.current = true;
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [ready, showPdfTemplate]);

  function handlePrintClick() {
    if (showPdfTemplate) {
      iframeRef.current?.contentWindow?.print();
    } else {
      window.print();
    }
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

  // A hospital-supplied image parcha template already carries the hospital
  // name, logo, address, etc. as a full-page background — skip the app's own
  // header block on top of it, and reserve extra top space for it instead of
  // the default header's own vertical footprint. A PDF template is handled
  // entirely above (showPdfTemplate) and never reaches this HTML layout.
  const hasImageTemplate = !!branding?.parchaTemplateUrl && !hasPdfTemplate;

  if (showPdfTemplate) {
    return (
      <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
        <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between px-2 print:hidden">
          <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> Back to OPD
          </Link>
          <Button size="sm" onClick={handlePrintClick} disabled={!pdfUrl}>
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </div>

        {pdfUrl ? (
          <iframe
            ref={iframeRef}
            src={pdfUrl}
            title="OPD Parcha"
            className="parcha-sheet block mx-auto border-0 bg-white w-[210mm] h-[297mm] print:w-full print:h-screen"
            onLoad={() => {
              if (!pdfPrintedRef.current) {
                pdfPrintedRef.current = true;
                setTimeout(() => iframeRef.current?.contentWindow?.print(), 300);
              }
            }}
          />
        ) : (
          <div className="max-w-3xl mx-auto py-12 text-center text-sm text-muted-foreground print:hidden">
            Preparing printable slip…
          </div>
        )}
      </div>
    );
  }

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

      {/* A4 sheet — the only thing meant to reach the printer */}
      <div
        className={`parcha-sheet relative px-[16mm] ${hasImageTemplate ? 'pt-[42mm] pb-[14mm]' : 'py-[14mm]'} text-[12px] leading-snug`}
      >
        {hasImageTemplate && (
          // Real <img>, not a CSS background — prints reliably without the
          // browser's "background graphics" print option being enabled.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={branding!.parchaTemplateUrl!}
            alt=""
            aria-hidden="true"
            className="absolute top-0 left-0 w-[210mm] h-[297mm] object-cover z-0"
          />
        )}
        <div className="relative z-10">
        {!hasImageTemplate && (
          <>
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
          </>
        )}

        {/* Patient + Visit details */}
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11.5px]">
          <Field label="Patient Name" value={patient.fullName} />
          <Field label="Patient ID"   value={patient.patientId} mono />
          <Field label="Age / Gender" value={`${calculateAge(patient.dateOfBirth)} years / ${toDisplay(patient.gender)}`} />
          <Field label="Mobile"       value={patient.mobileNumber} />
          {patient.address && <Field label="Address" value={patient.address} span />}
          {patient.bloodGroup && <Field label="Blood Group" value={patient.bloodGroup} />}

          <Field label="Visit ID"   value={visit.visitId} mono />
          <Field label="Visit Date" value={formatDate(visit.visitDate)} />
          {departmentName && <Field label="Department" value={departmentName} />}
          {doctorNames && <Field label="Doctor" value={doctorNames} />}
          <Field label="Registered On" value={formatDate(visit.createdAt)} />
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
        {/* No box borders — a single vertical divider (border-r on the
            Vitals column) separates the two columns instead. `items-stretch`
            (the flex default) makes both columns match the taller side's
            height, so the divider always runs from the top of this section
            to the bottom of the clinical column, whatever that height ends
            up being. */}
        <div className="mt-4 flex break-inside-avoid">
          {/* Vitals stays compact/top-aligned — only the divider (not the
              row spacing) extends down to match the clinical column. */}
          <div className="w-[42mm] shrink-0 pr-3 border-r border-gray-300">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Vitals</p>
            <div className="space-y-1.5">
              <VitalRow label="Weight" value={visit.vitals?.weight          != null ? String(visit.vitals.weight)          : ''} />
              <VitalRow label="Height" value={visit.vitals?.height          != null ? String(visit.vitals.height)          : ''} />
              <VitalRow label="BP"     value={visit.vitals?.bloodPressure   ?? ''} />
              <VitalRow label="Sugar"  value={visit.vitals?.sugar           != null ? String(visit.vitals.sugar)           : ''} />
              <VitalRow label="Temp"   value={visit.vitals?.bodyTemperature != null ? String(visit.vitals.bodyTemperature) : ''} />
            </div>
          </div>

          <div className="flex-1 pl-4" style={{ minHeight: '150mm' }}>
            <ClinicalField label="Diagnosis"    value={visit.diagnosis}    minHeight="10mm" />
            <ClinicalField label="Prescription" value={visit.prescription} minHeight="60mm" />
            <ClinicalField label="Notes" minHeight="40mm">
              <div className="min-h-[40mm] border-b border-gray-300">
                <RichTextDisplay value={visit.notes} fallback="" className="text-[11px]" />
              </div>
            </ClinicalField>
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
          This is valid for 15 days.
        </div>
        </div>
      </div>
    </div>
  );
}
