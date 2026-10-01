import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { listRestaurants } from '@/db/queries';
import { TAGS } from '@/lib/cache-tags';
import type { Restaurant } from '@/lib/data';

/**
 * The guest-facing catalogue. Cached across requests and baked into the
 * prerendered pages; an admin save will expire it with updateTag('restaurants').
 * `locale` is unused until restaurant_i18n exists, but it is already part of
 * the cache key so every language gets its own entry.
 * Never import this from Vitest: cacheTag() throws outside Next.
 */
export async function getRestaurants(locale: string): Promise<Restaurant[]> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.restaurants, TAGS.i18n(locale));
  return listRestaurants();
}
