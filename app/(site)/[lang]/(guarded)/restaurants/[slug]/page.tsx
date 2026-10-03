import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RestaurantHero } from '@/components/detail/RestaurantHero';
import { Highlights } from '@/components/detail/Highlights';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { getEnabledLocales, requireEnabledLocale } from '@/lib/server/content/locales';
import { getDetailSlugs, getRestaurantDetail } from '@/lib/server/content/restaurants';

type Props = { params: Promise<{ lang: string; slug: string }> };

/**
 * Cache Components refuses an empty list (migrating-to-cache-components.md:570),
 * so with no page switched on the build prerenders this placeholder, which
 * 404s like any unknown slug. No restaurant can take it: a slug is lower-case
 * words and hyphens (restaurants_slug_check).
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

const NOT_FOUND: Metadata = { title: 'Page not found — Furama Cuisine', robots: { index: false } };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, slug } = await params;
  // A language that is off 404s in the layout; its tab must not carry the restaurant's title (phase-2 risk 7, R14).
  if (!(await getEnabledLocales()).some((l) => l.code === lang)) return NOT_FOUND;
  const detail = await getRestaurantDetail(slug, lang);
  if (!detail) return NOT_FOUND;
  // PHASE 7: the SEO editor fills these, and "{name} — Furama Cuisine" becomes a registry template.
  return {
    title: detail.seo.title ?? `${detail.name} — Furama Cuisine`,
    ...(detail.seo.description ? { description: detail.seo.description } : {}),
  };
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
  const detail = await getRestaurantDetail(slug, lang);
  if (!detail) notFound();

  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <RestaurantHero detail={detail} />
      {detail.highlights.length > 0 && (
        <Highlights title={detail.highlightsTitle ?? `At ${detail.name}`} items={detail.highlights} />
      )}
      <MoreRestaurants slug={detail.slug} destinationName={detail.destinationName} />
      <MobileBar detail={detail} />
    </ViewMarker>
  );
}
