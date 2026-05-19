import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ReduxProvider } from '@/components/shared/ReduxProvider';
import { AuthHydrator } from '@/components/shared/AuthHydrator';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Hospital Management Platform',
  description: 'Multi-tenant hospital management system',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ReduxProvider>
          <AuthHydrator />
          {children}
        </ReduxProvider>
      </body>
    </html>
  );
}
