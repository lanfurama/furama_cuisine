import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
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

/**
 * The language of a guest page, or notFound() when it is not enabled. The
 * (guarded) layout checks the same, but layouts and pages render in parallel
 * (node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:460):
 * a page that read its content first would query the database for
 * /favicon.ico or /wp-login.php (the first segment is the language), and an
 * error of its own would win over the layout's 404. So every guest page awaits
 * this before anything else (test/guards/guest-pages.guard.test.ts).
 */
export async function requireEnabledLocale(code: string | undefined): Promise<string> {
  if (!code || !(await getEnabledLocales()).some((l) => l.code === code)) notFound();
  return code;
}
