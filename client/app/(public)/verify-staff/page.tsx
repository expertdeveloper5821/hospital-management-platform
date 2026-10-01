import type { Metadata } from 'next';
import { StaffVerificationView } from '@/components/public/StaffVerificationView';

// Public QR landing page — outside (auth)/(dashboard), whose layouts redirect
// unauthenticated and authenticated visitors respectively.
export const metadata: Metadata = {
  title:    'Staff ID Verification',
  robots:   { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'no-referrer',
};

export default function VerifyStaffPage() {
  return <StaffVerificationView />;
}
