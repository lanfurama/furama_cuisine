import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/** notFound() from (guarded)/layout.tsx: a language that is not enabled. No chrome: the guard stopped before it. */
export default function LanguageNotFound() {
  return (
    <main className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
      <h1>Page not found</h1>
      <p>
        <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
      </p>
    </main>
  );
}
