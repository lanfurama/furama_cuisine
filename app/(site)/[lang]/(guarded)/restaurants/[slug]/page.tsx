import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RestaurantHero } from '@/components/detail/RestaurantHero';
import { Highlights } from '@/components/detail/Highlights';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { languageAlternates, notFoundMetadata, restaurantMetadata } from '@/lib/content/seo';
import { isRestaurantSlug } from '@/lib/content/slug';
import { formatMessage } from '@/lib/i18n/format';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { getEnabledLocales, requireEnabledLocale } from '@/lib/server/content/locales';
import { getDetailSlugs, getRestaurantDetail } from '@/lib/server/content/restaurants';
import { getShareImage, SEO_KEYS } from '@/lib/server/content/seo';
import { getStrings } from '@/lib/server/content/strings';

type Props = { params: Promise<{ lang: string; slug: string }> };

/**
 * Cache Components refuses an empty list (migrating-to-cache-components.md:570),
 * so with no page switched on the build prerenders this placeholder, which
 * 404s like any unknown slug. No restaurant can take it: a slug is lower-case
 * words and hyphens (restaurants_slug_check), so isRestaurantSlug refuses it
 * before any read.
 */
const NO_PAGE_SLUG = '_none';

/**
 * Every restaurant whose page is on at build time is prerendered. A page
 * switched on later renders on its first visit and is cached from then on.
 * dynamicParams is not available with Cache Components (dynamicParams.md:22):
 * an unknown slug also renders on request, and notFound() below answers it
 * (a cached 404 tagged restaurants, R13).
 */
export async function generateStaticParams() {
  const slugs = await getDetailSlugs();
  return (slugs.length > 0 ? slugs : [NO_PAGE_SLUG]).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  // A language that is off 404s in the layout; its tab must not carry the restaurant's title (phase-2 risk 7, R14),
  // and its words are the default language's.
  const enabled = await getEnabledLocales();
  if (!enabled.some((l) => l.code === lang)) return notFoundMetadata(await getStrings(DEFAULT_LOCALE, ['seo.not_found_title']));
  const t = await getStrings(lang, SEO_KEYS);
  // A segment no restaurant can have never reaches the database (a NUL byte made Postgres throw).
  if (!isRestaurantSlug(slug)) return notFoundMetadata(t);
  const [detail, share] = await Promise.all([getRestaurantDetail(slug, lang), getShareImage(lang)]);
  if (!detail) return notFoundMetadata(t);
  // L7-13: its own title, description and picture, else the SEO screen's; its share text is always its own.
  return { ...restaurantMetadata(t, detail, share, lang), alternates: languageAlternates(lang, `/restaurants/${slug}`, enabled) };
}

/* The params read below blocks on purpose (see the comment on the page); this tells dev validation so. */
export const instant = false;

/*
 * params is awaited at the top, not inside <Suspense>. Inside a boundary even
 * the prerendered slugs ship their content as a streamed segment that only an
 * inline script reveals, so visitors without JS saw an empty page. The cost:
 * a slug missing from generateStaticParams gets no App Shell for this segment
 * and renders at request time on its first visit.
 *
 * The page is the restaurant's (restaurant_i18n, restaurant_highlights, spec
 * §6.4): one without has_detail_page, unpublished or archived is notFound()
 * and its card opens the reservation form instead.
 */
export default async function RestaurantPage({ params }: Props) {
  const { lang, slug } = await params;
  // Before the read: the layout's language check runs in parallel (requireEnabledLocale).
  await requireEnabledLocale(lang);
  // A segment no restaurant can have is a 404 without a query: a NUL byte made Postgres throw on every
  // hit, so the error page was never cached, and any other junk slug cost a read (R13).
  if (!isRestaurantSlug(slug)) notFound();
  const [detail, strings] = await Promise.all([getRestaurantDetail(slug, lang), getStrings(lang, ['detail.highlights_title'])]);
  if (!detail) notFound();

  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <RestaurantHero detail={detail} />
      {detail.highlights.length > 0 && (
        <Highlights title={detail.highlightsTitle ?? formatMessage(strings['detail.highlights_title'], { name: detail.name }, lang)} items={detail.highlights} />
      )}
      <MoreRestaurants slug={detail.slug} destinationName={detail.destinationName} />
      <MobileBar detail={detail} />
    </ViewMarker>
  );
}
