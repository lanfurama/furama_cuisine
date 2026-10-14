import 'server-only';
import { notFound } from 'next/navigation';
import { LISTED_LOCALE_CODES, SITE_LOCALE_ROWS } from '@/lib/i18n/site-locales';
import { isDraftMode } from '@/lib/server/draft-mode';

/** A language as the guest site shows it: the switcher, hreflang, the sitemap. */
export type SiteLocale = { code: string; bcp47: string; nativeName: string; shortLabel: string; script: string; isDefault: boolean };

/*
 * The languages come from lib/i18n/site-locales.ts, not the database (owner,
 * 2026-10-14): a change is a deploy, so nothing here is read per request or
 * cached. The async signatures stay so the pages read them as they did.
 */

const ENABLED: SiteLocale[] = SITE_LOCALE_ROWS.filter((l) => l.isEnabled).map(({ code, bcp47, nativeName, shortLabel, script, isDefault }) => ({
  code,
  bcp47,
  nativeName,
  shortLabel,
  script,
  isDefault,
}));
const ALL_CODES = [...LISTED_LOCALE_CODES];

/** Enabled languages. Feeds generateStaticParams, the language switcher and the sitemap. */
export async function getEnabledLocales(): Promise<SiteLocale[]> {
  return ENABLED;
}

/** Every listed language, enabled or not (Draft Mode's preview, C6). */
export async function getAllLocaleCodes(): Promise<string[]> {
  return ALL_CODES;
}

/**
 * Whether this request is a staff preview of `code`, a listed language that
 * guests cannot open (spec §6.1, R8-11): only /api/admin/preview turns Draft
 * Mode on, after its permission check. Asked only once the language is known
 * to be off, so a prerendered page never reads the request.
 */
export async function isLocalePreview(code: string | undefined): Promise<boolean> {
  if (!code || !(await isDraftMode())) return false;
  return ALL_CODES.includes(code);
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
  if (ENABLED.some((l) => l.code === code)) return code;
  if (await isLocalePreview(code)) return code;
  notFound();
}
