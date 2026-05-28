'use client';

import Link from 'next/link';
import { ArrowLeft, User, Phone, MapPin, Droplets, Shield, Calendar } from 'lucide-react';
import { useGetPatientByIdQuery } from '@/store/api/patient.api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className="mt-0.5 text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium break-words">{value ?? <span className="italic text-muted-foreground">—</span>}</p>
      </div>
    </div>
  );
}

export default function PatientDetailPage({ params }: { params: { patientId: string } }) {
  const { patientId } = params;
  const { data: patient, isLoading, isError } = useGetPatientByIdQuery(patientId);

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto space-y-4 animate-pulse">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="rounded-xl border bg-card h-64" />
      </div>
    );
  }

  if (isError || !patient) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Patients
        </Link>
        <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
          Patient not found or you do not have permission to view it.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href="/patients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Patients
      </Link>

      <div>
        <h1 className="text-xl font-semibold">{patient.fullName}</h1>
        <p className="text-sm text-muted-foreground font-mono">{patient.patientId}</p>
      </div>

      <div className="rounded-xl border bg-card divide-y">
        <DetailRow icon={<Calendar className="h-4 w-4" />} label="Date of Birth" value={formatDate(patient.dateOfBirth)} />
        <DetailRow icon={<User className="h-4 w-4" />}     label="Gender"        value={patient.gender} />
        <DetailRow icon={<Phone className="h-4 w-4" />}    label="Mobile"        value={patient.mobileNumber} />
        <DetailRow icon={<MapPin className="h-4 w-4" />}   label="Address"       value={patient.address} />
        <DetailRow icon={<Droplets className="h-4 w-4" />} label="Blood Group"   value={patient.bloodGroup} />
        <DetailRow icon={<Shield className="h-4 w-4" />}   label="Aadhaar"       value={patient.aadhaarNumber} />
      </div>

      {(patient.emergencyContactName || patient.emergencyContactMobile) && (
        <div className="rounded-xl border bg-card divide-y">
          <p className="px-5 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Emergency Contact</p>
          {patient.emergencyContactName   && <DetailRow icon={<User className="h-4 w-4" />}  label="Name"   value={patient.emergencyContactName} />}
          {patient.emergencyContactMobile && <DetailRow icon={<Phone className="h-4 w-4" />} label="Mobile" value={patient.emergencyContactMobile} />}
        </div>
      )}

      <p className="text-xs text-muted-foreground">Registered on {formatDate(patient.createdAt)}</p>
    </div>
  );
}
