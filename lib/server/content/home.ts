import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { loadExperiences, loadHeroSlides, loadOffers, loadStories } from './home.queries';

/* The home page's lists, cached (see lib/server/content/site.ts for the rules). */

export async function getHeroSlides(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.heroSlides.tags, TAGS.i18n(locale));
  return loadHeroSlides(locale);
}

export async function getExperiences(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.experiences.tags, TAGS.i18n(locale));
  return loadExperiences(locale);
}

export async function getStories(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.stories.tags, TAGS.i18n(locale));
  return loadStories(locale);
}

/**
 * Date-bound (spec §6.2): 'hours' (stale 5 min, revalidate 1 h, expire 1 day;
 * cacheLife.md:144), so the home page drops an ended offer within the hour
 * even without the daily cron (app/api/cron/daily), which revalidates
 * content:offers at 00:05 in Da Nang. It still prerenders (cacheLife.md:270).
 * The (guarded) layout reads it too, since the nav leaves Offers out on a day
 * without one (getHomeContent), so every guest page revalidates hourly.
 */
export async function getOffers(locale: string) {
  'use cache';
  cacheLife('hours');
  cacheTag(...LOADERS.offers.tags, TAGS.i18n(locale));
  return loadOffers(locale);
}
