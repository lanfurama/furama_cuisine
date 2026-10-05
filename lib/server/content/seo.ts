import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { TAGS } from '@/lib/cache-tags';
import type { Media } from '@/lib/content/types';
import { sectionKeys } from '@/lib/i18n/registry';
import { loadShareImage } from './seo.queries';

/*
 * What the guest pages' generateMetadata reads besides their own content: the
 * SEO screen's words (seo.*, through getStrings, content:ui) and its share
 * picture, cached under the tags of the tables it reads (lib/cache-plan.ts
 * LOADERS.shareImage): a save on the SEO screen expires content:contact, a
 * change to the file's alt or a trashed file expires media.
 */

/** The seo.* keys every page's metadata may use. */
export const SEO_KEYS = sectionKeys('seo');

export async function getShareImage(locale: string): Promise<Media | null> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.shareImage.tags, TAGS.i18n(locale));
  return loadShareImage(locale);
}
