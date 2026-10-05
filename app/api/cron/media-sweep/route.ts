import { getPool } from '@/db/client';
import { cronAuthorized } from '@/lib/server/cron';
import { envPrefix, isBlobConfigured } from '@/lib/server/media/blob';
import { sweepMedia } from '@/lib/server/media/sweep';

/*
 * Vercel Cron, daily at 18:35 UTC (01:35 in Da Nang), vercel.json. Deletes
 * media rows that have sat in the trash for 30 days, and their files from any
 * folder (a preview's upload is a production row: previews use the production
 * database), then the files of this environment's folder that no media row
 * names, 24 hours after upload (lib/server/media/sweep.ts; spec §12).
 *
 * Vercel runs crons on production deployments only, so the cron sweeps
 * `production/`. Nobody runs it on a preview: there it would purge
 * production's trash too. A preview folder's orphans (an upload whose
 * registerMedia never ran) are not swept (R15: storage only).
 *
 * `?dry=1` lists the orphan files that would go and deletes nothing; it skips
 * the trash purge, so it does not report rows or their files.
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
  console.info(`[cron:media-sweep] ${prefix}/: scanned ${report.scanned}, deleted ${report.deleted.length}, purged rows ${report.purgedRows}, their files elsewhere ${report.purgedFiles.length}${dryRun ? ' (dry run)' : ''}`);
  return Response.json({ prefix, dryRun, ...report }, { headers: NO_STORE });
}
