/*
 * Locale constants and pure helpers, safe in the proxy, on the server and in
 * the browser. Which languages are enabled is the `locales` table's job; the
 * proxy still uses ENABLED_LOCALES until phase 8 (spec §6.1).
 */
export const DEFAULT_LOCALE = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Phase 2: only 'en' exists. Phase 8 swaps this for a best-effort read of the locales table. */
export const ENABLED_LOCALES: readonly string[] = ['en'];

/**
 * A URL locale code: en, vi, zh-hans, pt-br. The same shape as the CHECK on
 * locales.code (migration 004) and the locale segment the proxy matcher skips.
 */
export const LOCALE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * The BCP 47 spelling of a URL code, for <html lang> in the root layout (which
 * reads no database): zh-hans -> zh-Hans, pt-br -> pt-BR, es-419 stays.
 */
export function toBcp47(code: string): string {
  return code
    .split('-')
    .map((part, i) => {
      if (i === 0 || !/^[a-z]+$/.test(part)) return part;
      if (part.length === 4) return part[0].toUpperCase() + part.slice(1); // script
      if (part.length === 2) return part.toUpperCase(); // region
      return part;
    })
    .join('-');
}

/** Pure: cookie, then Accept-Language (q-sorted, primary-subtag fallback), then default. */
export function pickLocale(
  cookie: string | undefined,
  acceptLanguage: string | null,
  enabled: readonly string[],
): string {
  const set = new Set(enabled.map((l) => l.toLowerCase()));
  const c = cookie?.toLowerCase();
  if (c && set.has(c)) return c;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1 };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    if (set.has(tag)) return tag;
    const primary = tag.split('-')[0];
    if (set.has(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
