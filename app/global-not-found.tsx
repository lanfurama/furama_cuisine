import type { Metadata } from 'next';
import { fontVariables } from '@/lib/fonts';
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import './globals.css';

export const metadata: Metadata = {
  title: 'Page not found — Furama Cuisine',
};

/*
 * URLs that match no route. This page bypasses every layout, so it brings its
 * own document, styles and fonts (not-found.md:51); without the font classes
 * the page falls back to Times.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
          <h1>Page not found</h1>
          <p>
            <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
          </p>
        </main>
      </body>
    </html>
  );
}
