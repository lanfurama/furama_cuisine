import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/** notFound() from (guarded)/layout.tsx: a language that is not enabled. No chrome: the guard stopped before it. */
export default function LanguageNotFound() {
  return (
    <main className="shell page-message">
      <h1>Page not found</h1>
      <p>
        <a href={homeHref(DEFAULT_LOCALE)} className="page-message-home">
          Back to Furama Cuisine
        </a>
      </p>
    </main>
  );
}
