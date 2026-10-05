'use client';

import { useSite } from '@/components/site/SiteProvider';
import { ViewMarker } from '@/components/site/ViewMarker';
import { homeHref } from '@/lib/i18n/href';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';

/*
 * notFound() from a guest page (an unknown restaurant). It renders inside the
 * site chrome, and its <ViewMarker> tells the chrome that this is not the home
 * page, so the header links and the logo still navigate home. Its words are
 * common.not_found and common.back_home (ui-text screen), which the (guarded)
 * layout already hands to SiteProvider (CLIENT_KEYS): a client component reads
 * them without a database call of its own. The [lang] and global 404 pages
 * render without the database and keep their text (R8).
 */
export default function PageNotFound() {
  const { strings } = useSite();
  return (
    <ViewMarker view="other">
      <section className="shell" style={{ padding: '160px 0 120px', textAlign: 'center' }}>
        <h1>{strings['common.not_found']}</h1>
        <p>
          <a href={homeHref(DEFAULT_LOCALE)}>{strings['common.back_home']}</a>
        </p>
      </section>
    </ViewMarker>
  );
}
