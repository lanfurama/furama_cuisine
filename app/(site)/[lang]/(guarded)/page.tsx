import { lang } from 'next/root-params';
import { Hero, HeroHeading } from '@/components/home/Hero';
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
import { getHomeContent } from '@/lib/server/content/home-content';
import { requireEnabledLocale } from '@/lib/server/content/locales';

/*
 * The home page. Its lists come from the database through cached loaders
 * (lib/server/content/home.ts); the chrome's content and the catalogue come
 * from the (guarded) layout. A section staff switched off (sections.is_visible)
 * is left out, and so is one with nothing to show (spec §6.5; homeSections).
 * getHomeContent gives that answer, and the layout's nav follows the same one.
 * The offers are today's (Da Nang), so this page, like every guest page below
 * the layout, revalidates hourly (getOffers, cacheLife('hours')).
 *
 * Without its hero the page names itself with a visually hidden <h1>
 * (HeroHeading), and its <main data-hero="none"> gives it a solid header from
 * the top and room beneath it (ViewMarker, styles/layout.css).
 */
export default async function HomePage() {
  // First, before any read: /favicon.ico lands here with "favicon.ico" as its language (requireEnabledLocale).
  const locale = await requireEnabledLocale(await lang());
  const { shown, slides, experiences, stories, offers } = await getHomeContent(locale);
  const hero = shown.has('hero');

  return (
    <ViewMarker view="home" hero={hero}>
      <IntroTrigger />
      {hero ? <Hero slides={slides} /> : <HeroHeading />}
      {shown.has('finder') && <Finder />}
      {shown.has('cuisines') && <Cuisines />}
      {shown.has('restaurants') && <Restaurants />}
      {shown.has('destinations') && <Destinations />}
      {shown.has('experiences') && <Experiences items={experiences} />}
      {shown.has('heritage') && <Heritage />}
      {shown.has('stories') && <Stories items={stories} />}
      {shown.has('offers') && <Offers items={offers} />}
      <MobileBar />
    </ViewMarker>
  );
}
