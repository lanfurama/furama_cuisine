import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TayaHero } from '@/components/detail/TayaHero';
import { TayaExperiences } from '@/components/detail/TayaExperiences';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';
import { DETAIL_PAGE_IDS, DETAIL_SEO } from '@/lib/data';

type Props = { params: Promise<{ lang: string; slug: string }> };

export async function generateStaticParams() {
  return [...DETAIL_PAGE_IDS].map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return Object.hasOwn(DETAIL_SEO, slug)
    ? DETAIL_SEO[slug]
    : { title: 'Page not found — Furama Cuisine', robots: { index: false } };
}

/* The params read below blocks on purpose (see the comment on the page); this tells dev validation so. */
export const instant = false;

/*
 * params is awaited at the top, not inside <Suspense>. Inside a boundary even
 * the prerendered slugs ship their content as a streamed segment that only an
 * inline script reveals, so visitors without JS saw an empty page. The cost:
 * a slug missing from generateStaticParams gets no App Shell for this segment
 * and renders at request time on its first visit.
 */
export default async function RestaurantPage({ params }: Props) {
  const { slug } = await params;
  if (!DETAIL_PAGE_IDS.has(slug)) notFound();

  return (
    <ViewMarker view="detail" restaurant={slug}>
      <IntroTrigger />
      <TayaHero slug={slug} />
      <TayaExperiences />
      <MoreRestaurants slug={slug} />
      <MobileBar slug={slug} />
    </ViewMarker>
  );
}
