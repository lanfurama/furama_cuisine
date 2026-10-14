import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { query } from '@/db/client';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import type { StringRow } from '@/lib/i18n/resolve';

type Run = <T extends Record<string, unknown>>(text: string, values?: unknown[]) => Promise<T[]>;

/**
 * The rows a guest may see for `keys` in `locale`, plus the default language's
 * rows as fallback (spec §5.1 item 5): the default language always shows;
 * another language shows `reviewed` rows only, never machine ones (owner,
 * 2026-10-14). Uncached; lib/server/content/strings.ts wraps it.
 * `db` lets the email sender read on its own pool or client: it runs in
 * after() and the cron route, outside any Next cache scope.
 */
export async function loadStringRows(
  locale: string,
  keys: readonly string[],
  db?: Pool | PoolClient,
): Promise<{ defaultLocale: string; rows: StringRow[] }> {
  const run: Run = db ? async (text, values) => (await db.query(text, values)).rows : query;
  const defaultLocale = DEFAULT_LOCALE;
  if (keys.length === 0) return { defaultLocale, rows: [] };

  const rows = await run<StringRow>(
    `SELECT cs.key, cs.locale, cs.value
       FROM content_strings cs
      WHERE cs.key = ANY($1::text[])
        AND cs.locale IN ($2, $3)
        AND (cs.locale = $3 OR cs.status = 'reviewed')`,
    [keys, locale, defaultLocale],
  );
  return { defaultLocale, rows };
}
