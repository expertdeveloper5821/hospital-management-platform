import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ReduxProvider } from '@/components/shared/ReduxProvider';
import { AuthHydrator } from '@/components/shared/AuthHydrator';
import { Toaster } from '@/components/shared/Toaster';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hospital Management Platform',
  description: 'Multi-tenant hospital management system',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'HMS',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563EB',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ReduxProvider>
          <AuthHydrator />
          {children}
          <Toaster />
        </ReduxProvider>
      </body>
    </html>
  );
}
