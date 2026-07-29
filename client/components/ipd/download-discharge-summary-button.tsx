'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useDownloadDischargeSummaryMutation } from '@/store/api/ipd.api';
import { Button } from '@/components/ui/button';

interface DownloadDischargeSummaryButtonProps {
  admissionId: string;
  variant?:    'default' | 'outline';
  className?:  string;
}

// Generates and downloads the discharge-summary PDF fresh on each click (never
// pre-stored) — only meaningful once an admission has been discharged. Reused
// in the IPD admission panel, the post-discharge success modal, and the
// standalone admission detail page.
export function DownloadDischargeSummaryButton({ admissionId, variant = 'outline', className }: DownloadDischargeSummaryButtonProps) {
  const [downloadSummary, { isLoading }] = useDownloadDischargeSummaryMutation();
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    const result = await downloadSummary(admissionId);
    if ('data' in result && result.data) {
      const a = document.createElement('a');
      a.href = result.data;
      a.download = `discharge-summary-${admissionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(result.data!), 100);
    } else {
      setError('Failed to download discharge summary. Please try again.');
    }
  }

  return (
    <div className={className}>
      <Button type="button" variant={variant} className="w-full" onClick={handleDownload} disabled={isLoading}>
        <Download className="h-4 w-4 mr-2" />
        {isLoading ? 'Preparing…' : 'Download Discharge Summary'}
      </Button>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
