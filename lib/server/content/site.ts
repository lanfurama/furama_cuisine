import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import type { SiteSettings } from '@/lib/content/types';
import { loadSiteSettings } from './settings.queries';
import { loadCuisines, loadDestinations, loadNav, loadSections, loadSocials } from './site.queries';

/*
 * The site-wide content, cached (spec §6.2): 'use cache', cacheLife('max'),
 * the tags of lib/cache-plan.ts, and the locale as an argument (so it is part
 * of the cache key). One entry per tag group, so a save expires only what
 * read its table. Never import these from Vitest: cacheTag() throws outside
 * Next; test the *.queries.ts functions instead. The chrome's content as one
 * object, its nav filtered by the home page's answer, is getSiteContent in
 * home-content.ts.
 */

export async function getSections(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.sections.tags, TAGS.i18n(locale));
  return loadSections(locale);
}

export async function getCuisines(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.cuisines.tags, TAGS.i18n(locale));
  return loadCuisines(locale);
}

export async function getDestinations(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.destinations.tags, TAGS.i18n(locale));
  return loadDestinations(locale);
}

export async function getNav(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.nav.tags, TAGS.i18n(locale));
  return loadNav(locale);
}

export async function getSocials(locale: string) {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.socials.tags, TAGS.i18n(locale));
  return loadSocials(locale);
}

/**
 * site_settings as the guest site needs it. Not per language (R17): nothing
 * in it is translated, so one entry serves every locale. A missing row is the
 * one content gap that throws: migration 007 seeds it and nothing deletes it.
 */
export async function getSiteSettings(): Promise<SiteSettings> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.settings.tags);
  const row = await loadSiteSettings();
  if (!row) throw new Error('site_settings has no row (migration 007 seeds it)');
  return {
    email: row.email,
    defaultRestaurantId: row.defaultRestaurantId,
    defaultOccasion: row.defaultOccasion,
    heroAutoplayMs: row.heroAutoplayMs,
  };
}
