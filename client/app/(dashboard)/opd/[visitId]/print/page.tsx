'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { useGetOPDVisitByIdQuery } from '@/store/api/opd.api';
import { useGetPatientByIdQuery } from '@/store/api/patient.api';
import { useListDepartmentsQuery } from '@/store/api/department.api';
import { useListUsersQuery } from '@/store/api/user.api';
import { useAppSelector } from '@/store/hooks';
import { Button } from '@/components/ui/button';

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

  return (
    <div className="bg-muted/30 min-h-screen py-6 print:bg-white print:py-0 print:min-h-0">
      {/* Screen-only toolbar */}
      <div className="max-w-[210mm] mx-auto mb-4 flex items-center justify-between px-2 print:hidden">
        <Link href="/opd" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to OPD
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

        {/* Blank writing area — intentionally empty; no labels, headings or
            placeholders. The doctor writes diagnosis/prescription/advice by
            hand on the printed sheet. Do not add content here. */}
        <div className="mt-4 border border-gray-300 rounded-sm" style={{ minHeight: '150mm' }} />

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
  );
}
