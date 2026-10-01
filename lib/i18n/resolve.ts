import { REGISTRY, registryLocaleDefault, type StringKey } from './registry';

/** One content_strings row that is allowed to reach guests. */
export type StringRow = { key: string; locale: string; value: string };

/**
 * Picks the text for each key, spec §5.1 item 5. Each key falls back on its own:
 *   1. the row in `locale`
 *   2. the registry's text for that locale (only email.* / legal.* have one)
 *   3. the row in the default language
 *   4. the registry's English text
 * `rows` must already be filtered for visibility (see loadStringRows).
 */
export function resolveStrings<K extends StringKey>(
  rows: readonly StringRow[],
  keys: readonly K[],
  locale: string,
  defaultLocale: string,
): Record<K, string> {
  const at = new Map<string, string>();
  for (const r of rows) at.set(`${r.key}\u0000${r.locale}`, r.value);

  const out = {} as Record<K, string>;
  for (const key of keys) {
    out[key] =
      at.get(`${key}\u0000${locale}`) ??
      registryLocaleDefault(key, locale) ??
      at.get(`${key}\u0000${defaultLocale}`) ??
      REGISTRY[key].en;
  }
  return out;
}
