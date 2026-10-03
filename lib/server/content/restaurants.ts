import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import type { Restaurant } from '@/lib/data';
import { loadRestaurants } from './restaurants.queries';

/*
 * Restaurants, cached (see lib/server/content/site.ts for the rules). Booking
 * config saves expire 'restaurants' (phase 4); phase 7's restaurant editor
 * expires 'restaurants' and 'restaurant:<id>' (lib/cache-plan.ts tagsForSave).
 */

/** The guest-facing catalogue, baked into every prerendered guest page. */
export async function getRestaurants(locale: string): Promise<Restaurant[]> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.restaurants.tags, TAGS.i18n(locale));
  return loadRestaurants(locale);
}
