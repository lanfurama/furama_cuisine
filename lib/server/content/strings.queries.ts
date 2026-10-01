import 'server-only';
import { query } from '@/db/client';
import type { StringRow } from '@/lib/i18n/resolve';

/**
 * The rows a guest may see for `keys` in `locale`, plus the default language's
 * rows as fallback (spec §5.1 item 5): the default language always shows;
 * another language shows `reviewed` rows, or `machine` rows when that language
 * has serve_machine on. Uncached; lib/server/content/strings.ts wraps it.
 */
export async function loadStringRows(
  locale: string,
  keys: readonly string[],
): Promise<{ defaultLocale: string; rows: StringRow[] }> {
  const defaults = await query<{ code: string }>('SELECT code FROM locales WHERE is_default');
  const defaultLocale = defaults[0]?.code ?? 'en';
  if (keys.length === 0) return { defaultLocale, rows: [] };

  const rows = await query<StringRow>(
    `SELECT cs.key, cs.locale, cs.value
       FROM content_strings cs
       JOIN locales l ON l.code = cs.locale
      WHERE cs.key = ANY($1::text[])
        AND cs.locale IN ($2, $3)
        AND (cs.locale = $3
             OR cs.status = 'reviewed'
             OR (cs.status = 'machine' AND l.serve_machine))`,
    [keys, locale, defaultLocale],
  );
  return { defaultLocale, rows };
}
