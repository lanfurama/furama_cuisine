import 'server-only';
import { homeSections, navFor } from '@/lib/content/home-sections';
import type { Cuisine, Destination, Experience, HeroSlide, Offer, SectionKey, Sections, SiteContent, Story } from '@/lib/content/types';
import { getExperiences, getHeroSlides, getOffers, getStories } from './home';
import { getCuisines, getDestinations, getNav, getSections, getSiteSettings, getSocials } from './site';

/*
 * One answer to "what does the home page show" (spec §6.5), for the home page
 * and for the chrome of every guest page: the header's and the menu's items
 * follow it, so none points at a section the home page left out. Both are
 * plain functions over the cached loaders, not cached themselves: each part
 * keeps its own cache entry and tags, and the page and the layout read the
 * same entries. getSiteContent lives here rather than in site.ts, so that
 * neither module imports the other.
 *
 * Lifetimes: the answer includes today's offers (getOffers, cacheLife('hours')),
 * so the (guarded) layout that reads it makes every guest page revalidate
 * hourly (1 hour, expiring after 1 day; cacheLife.md:144), not only the home
 * page. Accepted for one source of truth: the alternative, a second cached
 * wrapper with a longer life around the offers, could hold a stale nav for 30
 * days (nested caches keep the outer lifetime; cacheLife.md:406).
 */

export type HomeContent = {
  sections: Sections;
  slides: HeroSlide[];
  experiences: Experience[];
  stories: Story[];
  offers: Offer[];
  cuisines: Cuisine[];
  destinations: Destination[];
  /** The blocks that render (homeSections): switched on, and with something to show. */
  shown: Set<SectionKey>;
};

export async function getHomeContent(locale: string): Promise<HomeContent> {
  const [sections, slides, experiences, stories, offers, cuisines, destinations] = await Promise.all([
    getSections(locale),
    getHeroSlides(locale),
    getExperiences(locale),
    getStories(locale),
    getOffers(locale),
    getCuisines(locale),
    getDestinations(locale),
  ]);
  // Cuisines and Destinations draw the chrome's lists: an empty one would leave an empty rail.
  const shown = homeSections(sections, { hero: slides, experiences, stories, offers, cuisines, destinations });
  return { sections, slides, experiences, stories, offers, cuisines, destinations, shown };
}

/**
 * Everything the chrome needs, for the (guarded) layout to hand to
 * SiteProvider. The home page's lists stay on the server: only the nav,
 * filtered by them, reaches the browser.
 */
export async function getSiteContent(locale: string): Promise<SiteContent> {
  const [home, nav, socials, settings] = await Promise.all([
    getHomeContent(locale),
    getNav(locale),
    getSocials(locale),
    getSiteSettings(),
  ]);
  return {
    cuisines: home.cuisines,
    destinations: home.destinations,
    nav: navFor(nav, home.shown),
    socials,
    sections: home.sections,
    settings,
  };
}
