'use client';

import { useEffect } from 'react';
import { CONTACT } from '@/lib/data';

/*
 * A guest page failed to render, for example a request-time render while the
 * database is down. It sits above (guarded)/layout.tsx, so it also catches a
 * failed catalogue read. Never show error.message: in production it is a
 * minified React message; the digest matches the server log line.
 */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('page_render_failed', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
      <h1>We could not load this page.</h1>
      <p>
        Please try again, or call us to book: <a href={`tel:${CONTACT.resortPhone}`}>{CONTACT.resortPhoneLabel}</a>
      </p>
      <button type="button" className="btn-slab" onClick={() => retry()}>
        TRY AGAIN
      </button>
    </main>
  );
}
