import type { Metadata, Viewport } from 'next';
import { lang } from 'next/root-params';
import { fontVariables } from '@/lib/fonts';
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_CODE_RE, toBcp47 } from '@/lib/i18n/locales';
import { MotionProvider } from '@/lib/motion';
import '../../globals.css';

export const metadata: Metadata = {
  title: 'Furama Cuisine — Many Flavours. Many Destinations.',
  description:
    'From beachfront dining to vibrant city destinations – discover the restaurants, cuisines and people of Furama Cuisine in Da Nang.',
  openGraph: {
    title: 'Furama Cuisine',
    description: 'People · Culture · Great Food — dining across Furama’s Da Nang destinations.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14201c',
};

/** Every enabled locale is prerendered; Cache Components needs at least one. */
export async function generateStaticParams() {
  return ENABLED_LOCALES.map((code) => ({ lang: code }));
}

/*
 * Sets [data-motion] before first paint so reveal elements can start hidden
 * without flashing, while a visitor without JS still gets everything visible.
 */
const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}catch(e){}`;

/*
 * The guest root layout: the document, fonts and motion only. It reads no
 * database and never calls notFound(): neither an error nor a notFound() thrown
 * here has a layout to render into (error.md:96), so the language check and the
 * data reads live in (guarded)/layout.tsx.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const code = await lang();

  /* suppressHydrationWarning: the inline script below stamps data-motion onto
     <html> before React hydrates, so the server markup differs by design. */
  return (
    <html
      lang={LOCALE_CODE_RE.test(code) ? toBcp47(code) : DEFAULT_LOCALE}
      className={fontVariables}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOTSTRAP }} />
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
