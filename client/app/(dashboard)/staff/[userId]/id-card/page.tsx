'use client';

import { useParams, useRouter } from 'next/navigation';
import { useAppSelector } from '@/store/hooks';
import { useGenerateStaffIdCardMutation } from '@/store/api/staffIdCards.api';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function StaffIdCardPage() {
  const params   = useParams<{ userId: string }>();
  const router   = useRouter();
  const profile  = useAppSelector((s) => s.auth.profile);

  const allowedRoles = ['HOSPITAL_ADMIN', 'HR'];
  if (profile && !allowedRoles.includes(profile.role)) {
    router.replace('/dashboard');
    return null;
  }

  const [generate, { data, isLoading, error }] = useGenerateStaffIdCardMutation();

  const handleGenerate = () => generate(params.userId);

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Staff ID Card</h1>

      {data && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              ID Card Details
              <Badge variant="outline">{data.isNew ? 'New' : 'Regenerated'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="font-medium">User ID:</span> {data.userId}</p>
            <p><span className="font-medium">Issued:</span> {data.issuedAt.slice(0, 10)}</p>
            <p><span className="font-medium">Expires:</span> {data.cardExpiresAt.slice(0, 10)}</p>
            <a
              href={data.presignedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-blue-600 underline font-medium"
            >
              Download ID Card PDF
            </a>
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="text-red-600 text-sm">Failed to generate ID card. Please try again.</p>
      )}

      <Button onClick={handleGenerate} disabled={isLoading}>
        {isLoading ? 'Generating…' : data ? 'Regenerate ID Card' : 'Generate ID Card'}
      </Button>
    </div>
  );
}
