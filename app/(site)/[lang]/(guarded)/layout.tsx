import type { Metadata } from 'next';
import { lang } from 'next/root-params';
import { Suspense } from 'react';
import { homeMetadata, languageAlternates } from '@/lib/content/seo';
import { guestSettings } from '@/lib/content/settings';
import { CLIENT_KEYS } from '@/lib/i18n/registry';
import { siteOrigin } from '@/lib/site-origin';
import { getSiteContent } from '@/lib/server/content/home-content';
import { getEnabledLocales, isLocalePreview, requireEnabledLocale } from '@/lib/server/content/locales';
import { getRestaurants } from '@/lib/server/content/restaurants';
import { getShareImage, SEO_KEYS } from '@/lib/server/content/seo';
import { getStrings } from '@/lib/server/content/strings';
import { SiteProvider } from '@/components/site/SiteProvider';
import { Chrome } from '@/components/site/Chrome';
import { PreviewBanner } from '@/components/site/PreviewBanner';

/**
 * The home page's title, description and share text and picture, from the
 * SEO screen (seo.*, site_settings.og_image_id); also every page's default.
 * A language that is off says nothing here: the layout below 404s it, and
 * its tab keeps the root layout's title. Cached reads only, so the home page
 * stays prerendered with its metadata in <head>.
 *
 * metadataBase makes every relative URL below absolute (siteOrigin, R8-9), and
 * the alternates here are the home page's (it has no metadata of its own):
 * every other page sets its own, and a 404 none (notFoundMetadata).
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await lang();
  const enabled = await getEnabledLocales();
  const on = !!locale && enabled.some((l) => l.code === locale);
  // Draft Mode's preview of a language that is off (C6): never indexed, and in no one's hreflang.
  const preview = !on && (await isLocalePreview(locale));
  if (!locale || (!on && !preview)) return { metadataBase: siteOrigin() };
  const [t, share] = await Promise.all([getStrings(locale, SEO_KEYS), getShareImage(locale)]);
  return preview
    ? { ...homeMetadata(t, share), metadataBase: siteOrigin(), robots: { index: false, follow: false }, alternates: null }
    : { ...homeMetadata(t, share), metadataBase: siteOrigin(), alternates: languageAlternates(locale, '/', enabled) };
}

/*
 * Every guest page sits below this layout. It checks the language against the
 * locales table, so notFound() renders [lang]/not-found.tsx with a real 404 (and
 * that cached 404 carries the `locales` tag, so enabling the language clears
 * it), and it reads the catalogue, the chrome's content (getSiteContent in
 * lib/server/content/home-content.ts: nav, footer, cuisines, destinations,
 * sections, site settings) and the UI strings, so a database failure renders
 * [lang]/error.tsx. In the root layout neither could be caught.
 *
 * The nav follows the home page's own answer (getHomeContent), so this layout
 * also reads the home page's lists, today's offers among them
 * (cacheLife('hours')): every guest page revalidates hourly, not only the home
 * page (scripts/check-prerender.mjs checks it).
 */
export default async function GuardedLayout({ children }: { children: React.ReactNode }) {
  // `lang()` is string | undefined since app/admin added a second root layout (next-root-params.md:286-313).
  // A language that is off is a 404, unless staff preview it in Draft Mode (C6).
  const locale = await requireEnabledLocale(await lang());
  const enabled = await getEnabledLocales();
  const [restaurants, site, strings] = await Promise.all([
    getRestaurants(locale),
    getSiteContent(locale),
    getStrings(locale, CLIENT_KEYS),
  ]);

  // A default restaurant guests cannot see (a draft, or at a hidden destination) stays off the payload (L7-2).
  return (
    <SiteProvider
      locale={locale}
      languages={enabled.map((l) => ({ code: l.code, bcp47: l.bcp47, shortLabel: l.shortLabel, nativeName: l.nativeName }))}
      restaurants={restaurants}
      site={{ ...site, settings: guestSettings(site.settings, restaurants) }}
      strings={strings}
    >
      <Chrome>{children}</Chrome>
      <Suspense>
        <PreviewBanner locale={locale} />
      </Suspense>
    </SiteProvider>
  );
}
