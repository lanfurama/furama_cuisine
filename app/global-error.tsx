'use client';

import { CONTACT } from '@/lib/data';
import './globals.css';

/*
 * Last-resort error page. It replaces the whole document when the root layout
 * itself throws (an error.tsx only catches errors below its own layout), so it
 * brings its own <html>, styles and copy.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Furama Cuisine</title>
        <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
          <h1>We could not load this page.</h1>
          <p>
            Please try again, or call us to book:{' '}
            <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
          </p>
          <button type="button" className="btn-slab" onClick={() => retry()}>
            TRY AGAIN
          </button>
        </main>
      </body>
    </html>
  );
}
