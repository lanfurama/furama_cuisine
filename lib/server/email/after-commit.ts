import 'server-only';
import { after } from 'next/server';
import { drainQuietly } from './drain';

/**
 * spec §10.2 step 7 and §10.4 (R20): once a write has committed, send what it
 * queued first, then whatever else is due in this env (a retry due before
 * the hourly cron goes out with the next write), at most 10 rows in 25 s.
 * after() keeps the function alive past the response (Vercel's waitUntil:
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:50,
 * 247-260) and runs even when the action threw or redirected (after.md:54),
 * so callers schedule it only after COMMIT, once the ids exist, and before
 * redirect(). It never throws: drainQuietly logs a code and the cron retries.
 */
export function drainAfterCommit(ids: readonly string[]): void {
  after(() => drainQuietly({ ids: [...ids], limit: 10, budgetMs: 25_000 }));
}
