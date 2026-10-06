'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { useGetAllPathologyTestReportsPdfMutation } from '@/store/api/lab.api';
import type { PathologyTestReport } from '@/store/types';
import { Button } from '@/components/ui/button';

function bulkPdfFileName(patientId: string) {
  return `pathology-reports-${patientId}.pdf`;
}

const BULK_BUTTON = 'h-auto min-h-10 w-full whitespace-normal leading-tight';

interface PathologyReportsBulkActionsProps {
  requestId: string;
  patientId: string;
  reports:   PathologyTestReport[];
}

/**
 * Bulk actions over every submitted test report of a Pathology request: one
 * combined PDF to download (letterhead + Doctor Signature, like the per-test
 * Download) or to print in a single print dialog (Doctor Signature, no
 * letterhead, like the per-test Print). Renders nothing until a report is available.
 */
export function PathologyReportsBulkActions({ requestId, patientId, reports }: PathologyReportsBulkActionsProps) {
  const [getAllPdf, { isLoading }] = useGetAllPathologyTestReportsPdfMutation();
  const [error, setError] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const available = reports.filter((r) => r.result).length;

  useEffect(() => () => { frameRef.current?.remove(); }, []);

  if (available === 0) return null;

  async function loadPdf(letterhead: boolean): Promise<string | null> {
    setError('');
    const res = await getAllPdf({ requestId, ...(letterhead ? { letterhead: true } : {}) });
    if ('data' in res && res.data) return res.data;
    setError('Could not load the reports PDF. Please try again.');
    return null;
  }

  async function handleDownloadAll() {
    const url = await loadPdf(true);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = bulkPdfFileName(patientId);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handlePrintAll() {
    const url = await loadPdf(false);
    if (!url) return;
    // A hidden iframe hosts the combined PDF so one print dialog covers every
    // report; if the browser can't print it in place, open it in a new tab.
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

  return (
    <div className="space-y-1 py-2 border-b" aria-label="All test reports">
      {/* Always one row: two equal-width buttons whose labels wrap on narrow screens. */}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" className={BULK_BUTTON} disabled={isLoading} onClick={handleDownloadAll}>
          <Download className="mr-2 h-4 w-4 shrink-0" /> Download All Reports ({available})
        </Button>
        <Button type="button" variant="outline" className={BULK_BUTTON} disabled={isLoading} onClick={handlePrintAll}>
          <Printer className="mr-2 h-4 w-4 shrink-0" /> Print All Reports ({available})
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
