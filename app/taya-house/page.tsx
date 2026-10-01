import type { Metadata } from 'next';
import { TayaHero } from '@/components/detail/TayaHero';
import { TayaExperiences } from '@/components/detail/TayaExperiences';
import { MoreRestaurants } from '@/components/detail/MoreRestaurants';
import { IntroTrigger } from '@/components/site/IntroTrigger';

export const metadata: Metadata = {
  title: 'Tàya House — Furama Cuisine',
  description:
    'A wellness dining home beneath the Lagoon Garden at Furama Resort Danang, with Vietnamese cooking classes led by Cơ Tu chef A Rất Thị Hép.',
};

export default function TayaHousePage() {
  return (
    <main>
      <IntroTrigger />
      <TayaHero />
      <TayaExperiences />
      <MoreRestaurants />
    </main>
  );
}
