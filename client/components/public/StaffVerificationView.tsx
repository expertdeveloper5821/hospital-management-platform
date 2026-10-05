'use client';

import { useEffect, useState } from 'react';
import type { StaffVerificationResponse } from '@/store/types';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8001').replace(/\/+$/, '');

type ViewState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { kind: 'result'; data: StaffVerificationResponse };

function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Public, unauthenticated QR landing view. Deliberately does NOT use the RTK
 * Query baseApi: that layer attaches the signed-in user's JWT and runs the
 * offline/auth handling, none of which may apply to a public lookup.
 */
export function StaffVerificationView() {
  const [state, setState] = useState<ViewState>({ kind: 'loading' });

  useEffect(() => {
    // The token lives in the URL fragment, so it was never sent to any server.
    const token = window.location.hash.replace(/^#/, '');
    // Scrub it from the address bar and history entry straight away.
    window.history.replaceState(null, '', window.location.pathname);

    if (!token) {
      setState({ kind: 'missing' });
      return;
    }

    const controller = new AbortController();
    fetch(`${API_URL}/api/public/staff-verification/${encodeURIComponent(token)}`, {
      method:         'GET',
      cache:          'no-store',
      credentials:    'omit',
      referrerPolicy: 'no-referrer',
      signal:         controller.signal,
    })
      .then(async (res) => {
        if (res.status === 429) {
          setState({ kind: 'error', message: 'Too many verification attempts. Please wait a few minutes and try again.' });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data: StaffVerificationResponse };
        setState({ kind: 'result', data: body.data });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setState({ kind: 'error', message: 'Could not reach the verification service. Please try again.' });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-lg border bg-white shadow-sm p-6 space-y-4">
        <h1 className="text-lg font-semibold text-gray-900">Staff ID Verification</h1>

        {state.kind === 'loading' && (
          <p className="text-sm text-gray-500" role="status">Verifying…</p>
        )}

        {state.kind === 'missing' && (
          <p className="text-sm text-gray-600">
            No verification code found. Please scan the QR code on the staff ID card again.
          </p>
        )}

        {state.kind === 'error' && (
          <p className="text-sm text-red-600" role="alert">{state.message}</p>
        )}

        {state.kind === 'result' && !state.data.valid && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4">
            <p className="font-semibold text-red-700">Not valid</p>
            <p className="mt-1 text-sm text-red-700">
              This ID card is not valid. It may have expired, been replaced, or been revoked.
            </p>
          </div>
        )}

        {state.kind === 'result' && state.data.valid && (
          <div className="space-y-4">
            <div className="rounded-md border border-green-200 bg-green-50 p-4">
              <p className="font-semibold text-green-700">Verified — Active staff member</p>
            </div>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-gray-500">Name</dt>
              <dd className="font-medium text-gray-900">{state.data.name}</dd>
              <dt className="text-gray-500">Employee ID</dt>
              <dd className="font-mono text-gray-900">{state.data.employeeId}</dd>
              <dt className="text-gray-500">Role</dt>
              <dd className="text-gray-900">{formatRole(state.data.role)}</dd>
              <dt className="text-gray-500">Hospital</dt>
              <dd className="text-gray-900">{state.data.hospitalName}</dd>
              <dt className="text-gray-500">Issued</dt>
              <dd className="text-gray-900">{state.data.issuedAt}</dd>
              <dt className="text-gray-500">Expires</dt>
              <dd className="text-gray-900">{state.data.expiresAt}</dd>
            </dl>
            <p className="text-xs text-gray-500">
              Employee ID shows only its last 6 characters — compare them with the printed card.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
