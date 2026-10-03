import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import { loadExperiences, loadHeroSlides, loadStories } from './home.queries';

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
