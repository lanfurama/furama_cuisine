import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import { fontVariables } from '@/lib/fonts';
import '@/styles/admin.css';

/*
 * The admin's root layout (the guest site has its own under app/(site)/[lang]).
 * Moving between the two is a full page load, by design (spec §6.1).
 *
 * Every admin page renders at request time (spec §11):
 * - `await connection()` comes before <html>, so the prerender stops at once
 *   and there is no static shell to ship. A static shell could not carry the
 *   per-request CSP nonce (content-security-policy.md:397).
 * - `instant = false` tells Cache Components this tree is allowed to block, so
 *   it does not ask for a static shell or flag the session reads below it
 *   (instant.md:66-88).
 *
 * Response codes: the build still records an empty shell for each admin route
 * (prerender-manifest: response "empty", compute "blocking"), and next start
 * sends that shell's status, 200, before the resumed render runs
 * (next/dist/build/templates/app-page-runtime.js:1211-1213, 1388-1440). So
 * redirect(), notFound() and forbidden() inside an admin page do not change the
 * status: they reach the browser in the RSC payload and act there. Only the
 * proxy's cookie check is a real 307.
 */
export const instant = false;

export const metadata: Metadata = {
  title: { template: '%s · Quản trị Furama Cuisine', default: 'Quản trị Furama Cuisine' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14201c' };

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="vi" className={fontVariables}>
      <body className="admin">{children}</body>
    </html>
  );
}
