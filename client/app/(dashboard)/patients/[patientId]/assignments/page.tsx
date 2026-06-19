'use client';

import { useParams } from 'next/navigation';
import { useListPatientAssignmentsQuery, useCancelAssignmentMutation } from '@/store/api/packages.api';
import { useAppSelector } from '@/store/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function PatientAssignmentsPage() {
  const params  = useParams<{ patientId: string }>();
  const profile = useAppSelector((s) => s.auth.profile);

  const { data: assignments, isLoading, isError } = useListPatientAssignmentsQuery(params.patientId);
  const [cancelAssignment] = useCancelAssignmentMutation();

  const canCancel = ['HOSPITAL_ADMIN', 'ADMIN', 'RECEPTIONIST'].includes(profile?.role ?? '');

  if (isLoading) return <p className="p-6 text-muted-foreground">Loading assignments…</p>;
  if (isError)   return <p className="p-6 text-red-600">Failed to load assignments.</p>;

  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">Package Assignments</h1>
      <p className="text-muted-foreground text-sm">Patient: {params.patientId}</p>

      {assignments && assignments.length === 0 && (
        <p className="text-muted-foreground">No package assignments found for this patient.</p>
      )}

      <div className="space-y-3">
        {assignments?.map((a) => (
          <div key={a.assignmentId} className="border rounded p-4 flex items-start justify-between">
            <div className="space-y-1 text-sm">
              <p className="font-medium">{a.assignmentId}</p>
              <p className="text-muted-foreground">Package: {a.packageId}</p>
              <p className="text-muted-foreground">Assigned: {new Date(a.assignedDate).toLocaleDateString()}</p>
              <p className="text-muted-foreground">By: {a.assignedBy}</p>
              {a.cancelledAt && (
                <p className="text-muted-foreground">Cancelled: {new Date(a.cancelledAt).toLocaleDateString()}</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant={a.status === 'ACTIVE' ? 'default' : 'secondary'}>{a.status}</Badge>
              {canCancel && a.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => cancelAssignment({ packageId: a.packageId, assignmentId: a.assignmentId })}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
