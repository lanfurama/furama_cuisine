import { getPool } from '@/db/client';
import { FALLBACK_LOCALES } from './locales';

/*
 * The enabled languages for the proxy's redirect (spec §6.1): "best-effort: a
 * module variable with a 60-second TTL, a query with a timeout of at most
 * 500 ms; an error or a timeout serves ['en']. This is the proxy's only
 * database query." A failure is cached like a success, so a dead database
 * costs one slow redirect a minute per instance, not one per request
 * (measured in the phase-2 spike: 44–77 ms then 2 ms;
 * docs/superpowers/research/2026-10-01-phase-2-spikes/proxy-routing.md).
 *
 * No 'server-only' import: the proxy bundles this module, and the spike ran it
 * there as it is.
 */

const TTL_MS = 60_000;
const TIMEOUT_MS = 500;

let cache: { at: number; value: readonly string[] } | null = null;

export async function enabledLocalesBestEffort(now = Date.now()): Promise<readonly string[]> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let value: readonly string[] = FALLBACK_LOCALES;
  try {
    const query = getPool().query<{ code: string }>('SELECT code FROM locales WHERE is_enabled ORDER BY sort_order, code');
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('locales: timed out')), TIMEOUT_MS);
    });
    // A late answer after the timeout is dropped; keep it from surfacing as an unhandled rejection.
    query.catch(() => {});
    const { rows } = await Promise.race([query, timeout]);
    if (rows.length) value = rows.map((r) => r.code);
  } catch {
    // FALLBACK_LOCALES: getPool() throws without DATABASE_URL, the query may fail or time out.
  } finally {
    clearTimeout(timer);
  }
  cache = { at: now, value };
  return value;
}

/** Tests only: forget the cached answer. */
export function resetEnabledLocalesCache(): void {
  cache = null;
}
