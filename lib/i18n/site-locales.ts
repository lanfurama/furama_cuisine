import { catalogLanguage, type CatalogLanguage } from './catalog';
import { DEFAULT_LOCALE } from './locales';

/*
 * The site's languages, decided here in code (owner, 2026-10-14: no language
 * screen in the admin). The order is the switcher's. A language must be in
 * LANGUAGE_CATALOG (lib/i18n/catalog.ts), which holds its name, script and
 * BCP 47 spelling.
 *
 * The guest site, the proxy and the SQL that picks a language read this list
 * itself; there is no locales table since migration 011. So, to add, turn on
 * or off or reorder a language: edit the list and deploy (README, "Before
 * launch B"). A language taken off the list is turned off, never deleted: its
 * translations stay. A new language starts `enabled: false`: translate its
 * content and guest emails in the admin (it is listed there and staff can
 * preview it), then turn it on. Guests see reviewed translations only; a
 * missing one falls back to the default language, which is DEFAULT_LOCALE
 * (lib/i18n/locales.ts) too.
 */
export type SiteLocaleConfig = { code: string; enabled: boolean; default?: true };

export const SITE_LOCALES: readonly SiteLocaleConfig[] = [
  { code: 'en', enabled: true, default: true },
  { code: 'vi', enabled: true },
];

export type SiteLocaleRow = CatalogLanguage & { isDefault: boolean; isEnabled: boolean; sortOrder: number };

/** The listed languages as rows (catalogue entry, default, on or off, order); throws on a list that cannot work. */
export function siteLocaleRows(list: readonly SiteLocaleConfig[] = SITE_LOCALES): SiteLocaleRow[] {
  const defaults = list.filter((l) => l.default);
  if (defaults.length !== 1) throw new Error(`SITE_LOCALES: exactly one default language, found ${defaults.length}`);
  if (!defaults[0].enabled) throw new Error(`SITE_LOCALES: the default language (${defaults[0].code}) must be enabled`);
  const seen = new Set<string>();
  return list.map((l, i) => {
    if (seen.has(l.code)) throw new Error(`SITE_LOCALES: ${l.code} is listed twice`);
    seen.add(l.code);
    const language = catalogLanguage(l.code);
    if (!language) throw new Error(`SITE_LOCALES: ${l.code} is not in LANGUAGE_CATALOG (lib/i18n/catalog.ts)`);
    return { ...language, isDefault: l.default === true, isEnabled: l.enabled, sortOrder: (i + 1) * 10 };
  });
}

/** SITE_LOCALES as rows, checked once at load: a list that cannot work fails the build. */
export const SITE_LOCALE_ROWS: readonly SiteLocaleRow[] = siteLocaleRows();

/** What guests may open, in the switcher's order: the proxy's redirect, the language checks, the sitemap. */
export const ENABLED_LOCALE_CODES: readonly string[] = SITE_LOCALE_ROWS.filter((l) => l.isEnabled).map((l) => l.code);

/** Every listed language, enabled or not: what staff may preview, record for a guest or translate. */
export const LISTED_LOCALE_CODES: readonly string[] = SITE_LOCALE_ROWS.map((l) => l.code);

/** The language a guest's booking and emails use: `code` while guests can open it, else the default. */
export const guestLocale = (code: string): string => (ENABLED_LOCALE_CODES.includes(code) ? code : DEFAULT_LOCALE);
