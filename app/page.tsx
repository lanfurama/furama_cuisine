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
import { MobileBar } from '@/components/site/MobileBar';
import { ViewMarker } from '@/components/site/ViewMarker';

export default function HomePage() {
  return (
    <ViewMarker view="home">
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
      <MobileBar />
    </ViewMarker>
  );
}
