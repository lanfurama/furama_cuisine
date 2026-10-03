import { revalidateTag } from 'next/cache';
import { TAGS } from '@/lib/cache-tags';
import { cronAuthorized } from '@/lib/server/cron';

/*
 * Vercel Cron, daily at 17:05 UTC, which is 00:05 in Da Nang (vercel.json;
 * production deployments only). Offers are date-bound (spec §6.2): a new day
 * revalidates content:offers, so the home page drops an offer past its
 * valid_until, and shows one whose valid_from has come, a few minutes after
 * midnight instead of within the hour that the loader's cacheLife('hours')
 * allows.
 *
 * 'max', not { expire: 0 } (R7, amending spec §6.2): the next visitor is served
 * the cached page while it renders again (revalidateTag.md:23,30), so a
 * database that is down at 00:05 cannot turn the home page into an error; the
 * cost is that the first visitor after the cron may see yesterday's offers
 * once. { expire: 0 } would make that visit wait for a render, which fails
 * while the database is down (revalidateTag.md:25).
 *
 * Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12). Reading
 * request.headers keeps the handler out of prerendering
 * (node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:124).
 */

/** Seconds: one call, no database. */
export const maxDuration = 60;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  revalidateTag(TAGS.contentOffers, 'max');
  console.info(`[cron:daily] revalidated ${TAGS.contentOffers}`);
  return Response.json({ revalidated: [TAGS.contentOffers] }, { headers: NO_STORE });
}
