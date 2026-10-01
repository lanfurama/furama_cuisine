import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { loadEnabledLocales, type SiteLocale } from './locales.queries';

export type { SiteLocale };

/** Enabled languages. Feeds generateStaticParams, the language switcher and the sitemap. */
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.locales);
  return loadEnabledLocales();
}
