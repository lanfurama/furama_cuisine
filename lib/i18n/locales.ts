/*
 * Locale constants and pure helpers, safe in the proxy, on the server and in
 * the browser. Which languages are enabled is lib/i18n/site-locales.ts's job
 * (the proxy, and the pages through getEnabledLocales).
 */
export const DEFAULT_LOCALE = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/**
 * DEFAULT_LOCALE as an SQL string literal, for the queries that fall back to
 * the default language (there is no locales table since migration 011). A
 * code constant of LOCALE_CODE_RE's shape: nothing in it to escape.
 */
export const DEFAULT_LOCALE_SQL = `'${DEFAULT_LOCALE}'`;

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

/**
 * Pure: cookie, then Accept-Language, then default. Accept-Language is sorted
 * by q (clamped to 0–1; an unreadable q counts as 0), and each tag is tried
 * whole, then with its last subtag dropped, so zh-Hans-CN finds zh-hans and
 * vi-VN finds vi.
 */
export function pickLocale(
  cookie: string | undefined,
  acceptLanguage: string | null,
  enabled: readonly string[],
): string {
  const set = new Set(enabled.map((l) => l.toLowerCase()));
  const c = cookie?.trim().toLowerCase();
  if (c && set.has(c)) return c;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const n = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0 };
    })
    .filter((x) => x.tag && x.tag !== '*' && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const parts = tag.split('-');
    for (let n = parts.length; n > 0; n--) {
      const candidate = parts.slice(0, n).join('-');
      if (set.has(candidate)) return candidate;
    }
  }
  return DEFAULT_LOCALE;
}
