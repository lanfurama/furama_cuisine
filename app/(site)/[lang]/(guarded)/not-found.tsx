import { ViewMarker } from '@/components/site/ViewMarker';
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/*
 * notFound() from a guest page (an unknown restaurant). It renders inside the
 * site chrome, and its <ViewMarker> tells the chrome that this is not the home
 * page, so the header links and the logo still navigate home.
 */
export default function PageNotFound() {
  return (
    <ViewMarker view="other">
      <section className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
        <h1>Page not found</h1>
        <p>
          <a href={homeHref(DEFAULT_LOCALE)}>Back to Furama Cuisine</a>
        </p>
      </section>
    </ViewMarker>
  );
}
