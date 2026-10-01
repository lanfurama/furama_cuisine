import type { Metadata } from 'next';
import { TayaHero } from '@/components/detail/TayaHero';
import { TayaExperiences } from '@/components/detail/TayaExperiences';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';

/* This route becomes /[lang]/restaurants/[slug] in the route move; until then its slug is fixed. */
const SLUG = 'taya-house';

export const metadata: Metadata = {
  title: 'Tàya House — Furama Cuisine',
  description:
    'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.',
};

export default function TayaHousePage() {
  return (
    <ViewMarker view="detail" restaurant={SLUG}>
      <IntroTrigger />
      <TayaHero slug={SLUG} />
      <TayaExperiences />
      <MoreRestaurants slug={SLUG} />
      <MobileBar slug={SLUG} />
    </ViewMarker>
  );
}
