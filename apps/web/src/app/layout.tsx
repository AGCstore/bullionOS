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
        {/*
         * Privacy policy link — kept on every page at the root level so
         * Google's OAuth consent-screen verifier (which crawls the app's
         * "Application home page") can discover it. Must be a real,
         * crawlable anchor — `display: none`, `visibility: hidden`, and
         * aria-hidden are all treated as cloaking by Google and will fail
         * verification. Small gray text in a fixed-position footer is the
         * standard unobtrusive-but-visible pattern.
         */}
        <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-0 flex justify-end px-3 py-1 text-[10px] leading-none text-ink-300">
          <a
            href="https://atlantagoldandcoin.com/privacy-policy-2/"
            rel="noopener"
            className="pointer-events-auto hover:text-ink-500 hover:underline"
          >
            Privacy policy
          </a>
        </footer>
      </body>
    </html>
  );
}
