import { lang } from 'next/root-params';
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
import { homeSections } from '@/lib/content/home-sections';
import { getExperiences, getHeroSlides, getStories } from '@/lib/server/content/home';
import { requireEnabledLocale } from '@/lib/server/content/locales';
import { getSections } from '@/lib/server/content/site';

/*
 * The home page. Its lists come from the database through cached loaders
 * (lib/server/content/home.ts); the chrome's content and the catalogue come
 * from the (guarded) layout. A section staff switched off (sections.is_visible)
 * is left out, and so is one with nothing to show (spec §6.5; homeSections).
 */
export default async function HomePage() {
  // First, before any read: /favicon.ico lands here with "favicon.ico" as its language (requireEnabledLocale).
  const locale = await requireEnabledLocale(await lang());
  const [sections, slides, experiences, stories] = await Promise.all([
    getSections(locale),
    getHeroSlides(locale),
    getExperiences(locale),
    getStories(locale),
  ]);
  const shown = homeSections(sections, { hero: slides, experiences, stories });

  return (
    <ViewMarker view="home">
      <IntroTrigger />
      {shown.has('hero') && <Hero slides={slides} />}
      {shown.has('finder') && <Finder />}
      {shown.has('cuisines') && <Cuisines />}
      {shown.has('restaurants') && <Restaurants />}
      {shown.has('destinations') && <Destinations />}
      {shown.has('experiences') && <Experiences items={experiences} />}
      {shown.has('heritage') && <Heritage />}
      {shown.has('stories') && <Stories items={stories} />}
      {shown.has('offers') && <Offers />}
      <MobileBar />
    </ViewMarker>
  );
}
