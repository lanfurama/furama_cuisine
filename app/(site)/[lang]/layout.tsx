import type { Metadata, Viewport } from 'next';
import { lang } from 'next/root-params';
import { fontVariables } from '@/lib/fonts';
import { SCRIPT_FONTS } from '@/lib/fonts/scripts';
import { catalogLanguage } from '@/lib/i18n/catalog';
import { DEFAULT_LOCALE, LOCALE_CODE_RE, toBcp47 } from '@/lib/i18n/locales';
import { MotionProvider } from '@/lib/motion';
import { getEnabledLocales } from '@/lib/server/content/locales';
import '../../globals.css';

/*
 * Only the pages that render without the database (the not-found and error
 * pages of this segment, R8) keep this title: every page below
 * (guarded)/layout.tsx names itself from the SEO screen's words (seo.*).
 */
export const metadata: Metadata = { title: 'Furama Cuisine' };

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#14201c',
};

/**
 * Every language enabled at build time is prerendered (the default one always:
 * Cache Components needs at least one). This runs at build only; rendering the
 * layout still reads no database.
 */
export async function generateStaticParams() {
  const codes = (await getEnabledLocales()).map((l) => l.code);
  return (codes.includes(DEFAULT_LOCALE) ? codes : [DEFAULT_LOCALE, ...codes]).map((code) => ({ lang: code }));
}

/*
 * Sets [data-motion] before first paint so reveal elements can start hidden
 * without flashing, while a visitor without JS still gets everything visible.
 */
const MOTION_BOOTSTRAP = `try{document.documentElement.dataset.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?'off':'on'}catch(e){}`;

/**
 * The script stylesheet of a URL code, or null for Latin and Vietnamese. This
 * layout reads no database (R38), so the script comes from the catalogue, the
 * only place /admin/locales adds a language from; a code outside it gets the
 * site's fonts alone.
 */
function scriptStylesheet(code: string): string | null {
  const language = catalogLanguage(code);
  return language ? SCRIPT_FONTS[language.script] : null;
}

/*
 * The guest root layout: the document, fonts and motion only. It reads no
 * database and never calls notFound(): neither an error nor a notFound() thrown
 * here has a layout to render into (error.md:96), so the language check and the
 * data reads live in (guarded)/layout.tsx.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // string | undefined: app/admin has a root layout of its own with no [lang] (next-root-params.md:286-313).
  const code = (await lang()) ?? DEFAULT_LOCALE;
  const scriptCss = scriptStylesheet(code);

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
        {scriptCss && <link rel="stylesheet" href={scriptCss} precedence="default" />}
      </head>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
