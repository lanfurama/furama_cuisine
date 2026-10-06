import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { notFound } from 'next/navigation';
import { LOADERS } from '@/lib/cache-plan';
import { isDraftMode } from '@/lib/server/draft-mode';
import { loadAllLocaleCodes, loadEnabledLocales, type SiteLocale } from './locales.queries';

export type { SiteLocale };

/** Enabled languages. Feeds generateStaticParams, the language switcher and the sitemap. */
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.locales.tags);
  return loadEnabledLocales();
}

/** Every language code in the table, enabled or not (Draft Mode's preview, C6). */
export async function getAllLocaleCodes(): Promise<string[]> {
  'use cache';
  cacheLife('max');
  cacheTag(...LOADERS.locales.tags);
  return loadAllLocaleCodes();
}

/**
 * Whether this request is a staff preview of `code`, a language in the table
 * that guests cannot open (spec §6.1, R8-11): only /api/admin/preview turns
 * Draft Mode on, after its permission check. Asked only once the language is
 * known to be off, so a prerendered page never reads the request.
 */
export async function isLocalePreview(code: string | undefined): Promise<boolean> {
  if (!code || !(await isDraftMode())) return false;
  return (await getAllLocaleCodes()).includes(code);
}


/**
 * The language of a guest page, or notFound() when it is not enabled (and not
 * previewed in Draft Mode). The
 * (guarded) layout checks the same, but layouts and pages render in parallel
 * (node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md:460):
 * a page that read its content first would query the database for
 * /favicon.ico or /wp-login.php (the first segment is the language), and an
 * error of its own would win over the layout's 404. So every guest page awaits
 * this before anything else (test/guards/guest-pages.guard.test.ts).
 */
export async function requireEnabledLocale(code: string | undefined): Promise<string> {
  if (!code) notFound();
  if ((await getEnabledLocales()).some((l) => l.code === code)) return code;
  if (await isLocalePreview(code)) return code;
  notFound();
}
