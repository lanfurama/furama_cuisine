import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import type { StringKey } from '@/lib/i18n/registry';
import { resolveStrings } from '@/lib/i18n/resolve';
import { loadStringRows } from './strings.queries';

/**
 * Resolved text for `keys` in `locale`: DB override, else registry default.
 * `locale` and `keys` are arguments, so they form the cache key. Callers get
 * the locale from `lang()` (next/root-params) in a Server Component, or pass it
 * explicitly from a Server Action, route handler or email sender.
 * Refreshed by the `content:ui` tag (and `i18n:<locale>`).
 */
export async function getStrings<K extends StringKey>(
  locale: string,
  keys: readonly K[],
): Promise<Record<K, string>> {
  'use cache';
  cacheLife('max');
  cacheTag(TAGS.contentUi, TAGS.i18n(locale));

  const { defaultLocale, rows } = await loadStringRows(locale, keys);
  return resolveStrings(rows, keys, locale, defaultLocale);
}
