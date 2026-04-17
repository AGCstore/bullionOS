import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'AGC Portal',
  description: 'AGC CRM + Client Portal',
  // Point browsers at the API favicon endpoint. Vercel rewrites /api/* to
  // the Railway origin, so the favicon survives deploys along with the
  // logo (both stored in the DB as BYTEA). The ?v=1 lets admins force a
  // refresh by bumping it on the upload response; cache headers hold the
  // browser to 60s otherwise.
  icons: {
    icon: '/api/v1/public/branding/favicon',
    shortcut: '/api/v1/public/branding/favicon',
    apple: '/api/v1/public/branding/favicon',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
