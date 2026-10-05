import { getPool } from '@/db/client';
import { cronAuthorized } from '@/lib/server/cron';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { sweepMedia } from '@/lib/server/media/sweep';

/*
 * Vercel Cron, daily at 18:35 UTC (01:35 in Da Nang), vercel.json. Deletes the
 * files of this environment's folder that no media row names, 24 hours after
 * upload, and media rows that have sat in the trash for 30 days
 * (lib/server/media/sweep.ts; spec §12).
 *
 * Vercel runs crons on production deployments only, so a preview's folder of
 * the shared store is swept only when someone calls this route on that
 * preview with the secret:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/cron/media-sweep
 * `?dry=1` reports what would go without deleting anything.
 *
 * Without `Authorization: Bearer $CRON_SECRET` it is 401 (spec §12). No cache
 * tag changes: deleted rows were already out of every guest read.
 */

export const maxDuration = 300;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  }
  if (!isBlobConfigured()) {
    return Response.json({ skipped: 'blob_not_configured' }, { headers: NO_STORE });
  }
  const dryRun = new URL(request.url).searchParams.get('dry') === '1';
  const prefix = envPrefix();
  const report = await sweepMedia(getPool(), { prefix, dryRun });
  console.info(`[cron:media-sweep] ${prefix}/: scanned ${report.scanned}, deleted ${report.deleted.length}, purged rows ${report.purgedRows}${dryRun ? ' (dry run)' : ''}`);
  return Response.json({ prefix, dryRun, ...report }, { headers: NO_STORE });
}
