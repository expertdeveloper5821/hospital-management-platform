'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useDownloadDischargeSummaryMutation, usePrintDischargeSummaryMutation } from '@/store/api/ipd.api';
import { Button } from '@/components/ui/button';
import { UserRole } from '@/store/types';

// Roles permitted to download the discharge summary — mirrors the backend's
// GET /api/ipd/admissions/:admissionId/discharge-summary requireRole list.
// Callers must gate rendering of <DownloadDischargeSummaryButton> on this list.
export const DISCHARGE_SUMMARY_DOWNLOAD_ROLES: UserRole[] = [
  UserRole.NURSE,
  UserRole.RECEPTIONIST,
  UserRole.HOSPITAL_ADMIN,
  UserRole.ADMIN,
];

interface DownloadDischargeSummaryButtonProps {
  admissionId: string;
  variant?:    'default' | 'outline';
  className?:  string;
}

// Download + Print for the discharge-summary PDF, generated fresh on each
// click (never pre-stored) — only meaningful once an admission has been
// discharged. Both copies carry the same content: Download has the hospital
// letterhead on every page; Print has none (blank 3.5 cm top / 2 cm bottom
// bands, like the OPD slip). Reused in the IPD admission panel, the
// post-discharge success modal, the standalone admission detail page and the
// patient IPD history.
export function DownloadDischargeSummaryButton({ admissionId, variant = 'outline', className }: DownloadDischargeSummaryButtonProps) {
  const [downloadSummary, { isLoading: downloading }] = useDownloadDischargeSummaryMutation();
  const [printSummary, { isLoading: printing }] = usePrintDischargeSummaryMutation();
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => () => { frameRef.current?.remove(); }, []);

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

  async function handlePrint() {
    setError(null);
    const result = await printSummary(admissionId);
    if (!('data' in result) || !result.data) {
      setError('Failed to load discharge summary for printing. Please try again.');
      return;
    }
    const url = result.data;
    // A hidden iframe hosts the PDF so the browser's print dialog opens in
    // place; if the browser can't print it there, open it in a new tab.
    frameRef.current?.remove();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
    };
    frame.src = url;
    document.body.appendChild(frame);
    frameRef.current = frame;
  }

  const busy = downloading || printing;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant={variant} className="w-full h-auto min-h-9 whitespace-normal" onClick={handleDownload} disabled={busy}>
          <Download className="h-4 w-4 mr-2 shrink-0" />
          {downloading ? 'Preparing…' : 'Download Discharge Summary'}
        </Button>
        <Button type="button" variant="outline" className="w-full h-auto min-h-9 whitespace-normal" onClick={handlePrint} disabled={busy}>
          <Printer className="h-4 w-4 mr-2 shrink-0" />
          {printing ? 'Preparing…' : 'Print Discharge Summary'}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
