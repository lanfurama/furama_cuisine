import { Hero } from '@/components/home/Hero';
import { Finder } from '@/components/home/Finder';
import { Cuisines } from '@/components/home/Cuisines';
import { Restaurants } from '@/components/home/Restaurants';
import { Destinations } from '@/components/home/Destinations';
import { Experiences } from '@/components/home/Experiences';
import { Heritage } from '@/components/home/Heritage';
import { Stories } from '@/components/home/Stories';
import { Offers } from '@/components/home/Offers';
import { IntroTrigger } from '@/components/site/IntroTrigger';

export default function HomePage() {
  return (
    <main>
      <IntroTrigger />
      <Hero />
      <Finder />
      <Cuisines />
      <Restaurants />
      <Destinations />
      <Experiences />
      <Heritage />
      <Stories />
      <Offers />
    </main>
  );
}
