import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import type { RestaurantDetail } from '@/lib/content/types';
import type { Restaurant } from '@/lib/data';
import { loadDetailSlugs, loadRestaurantDetail, loadRestaurants } from './restaurants.queries';

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

/** The slugs prerendered at build (generateStaticParams). */
export async function getDetailSlugs(): Promise<string[]> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.detailSlugs.tags);
  return loadDetailSlugs();
}

/**
 * One restaurant's page, or null (notFound). A null is cached too, under
 * `restaurants`: switching a page on (any save that expires the catalogue)
 * clears the cached 404 (spec §14.1 row 6). Once the slug is known to be a
 * restaurant, the entry also carries restaurant:<id>, which phase 7's editor
 * of that restaurant expires.
 */
export async function getRestaurantDetail(slug: string, locale: string): Promise<RestaurantDetail | null> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.detail.tags, TAGS.i18n(locale));
  const detail = await loadRestaurantDetail(slug, locale);
  if (detail) cacheTag(TAGS.restaurant(detail.id));
  return detail;
}
