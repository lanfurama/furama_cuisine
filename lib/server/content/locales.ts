import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { LOADERS } from '@/lib/cache-plan';
import { loadEnabledLocales, type SiteLocale } from './locales.queries';

export type { SiteLocale };

/** Enabled languages. Feeds generateStaticParams, the language switcher and the sitemap. */
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.locales.tags);
  return loadEnabledLocales();
}
