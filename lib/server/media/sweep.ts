import 'server-only';
import type { Pool } from 'pg';
import { insertAudit, withTransaction } from '@/lib/server/audit';
import { readItem } from '@/lib/server/content-admin/snapshot';
import { deleteBlobs, listBlobs } from './blob';
import { MEDIA } from './library';

/*
 * The media-sweep cron's work (spec §12 "Upload lỗi": blobs with no media row
 * are deleted after 24 hours, only in this environment's store).
 *
 * 1. Trash: a row soft-deleted more than TRASH_DAYS ago is deleted for good
 *    (one statement per row; RESTRICT still guards it, and a row something
 *    references again is skipped). Its file then has no row.
 * 2. Orphans: every file under this environment's folder that no media row
 *    names (live or in the trash) and that is older than ORPHAN_GRACE_HOURS
 *    is deleted. The grace covers an upload whose registerMedia has not run
 *    yet. Rows are looked up per page of the listing, after the purge, and a
 *    database error stops the run before any delete: never delete when unsure.
 *
 * "Only this environment's files" holds through the folder: Production and
 * Preview share one store (README "Media in Vercel Blob"), and the listing is
 * limited to `<prefix>/`, the folder this deployment hands out
 * (lib/media/rules.ts blobEnvPrefix), so production's cron never deletes a
 * preview's uploads, and a preview swept by hand never touches production's
 * files or another branch's.
 */

export const ORPHAN_GRACE_HOURS = 24;
export const TRASH_DAYS = 30;

export type SweepReport = { purgedRows: number; scanned: number; deleted: string[]; kept: number };

export async function sweepMedia(pool: Pool, options: { prefix: string; now?: Date; dryRun?: boolean }): Promise<SweepReport> {
  const prefix = options.prefix.replace(/\/+$/, '');
  if (!/^[a-z0-9][a-z0-9/-]*$/.test(prefix)) throw new Error(`refusing to sweep with prefix ${JSON.stringify(options.prefix)}`);
  const now = options.now ?? new Date();

  let purgedRows = 0;
  if (!options.dryRun) {
    const { rows: trash } = await pool.query<{ id: string }>(
      `SELECT id::text FROM media WHERE deleted_at < $1::timestamptz - make_interval(days => $2) ORDER BY deleted_at`,
      [now.toISOString(), TRASH_DAYS],
    );
    for (const { id } of trash) {
      try {
        await withTransaction(pool, async (client) => {
          // Still in the trash (History may have brought it back since the list was read)?
          const { rowCount } = await client.query('SELECT 1 FROM media WHERE id = $1 AND deleted_at IS NOT NULL FOR UPDATE', [id]);
          if (!rowCount) return;
          // The last version History knows (R5): after this, a restore that needs the file gets missing_reference (R14).
          const before = await readItem(client, MEDIA, id);
          await client.query('DELETE FROM media WHERE id = $1', [id]);
          await insertAudit(client, null, { action: 'delete', entityType: 'media', entityId: id, before, after: null });
          purgedRows += 1;
        });
      } catch (err) {
        // 23001 restrict_violation (ON DELETE RESTRICT; 23503 for NO ACTION): something
        // references the row again. Keep it; the library shows it as in use.
        const code = (err as { code?: string }).code;
        if (code !== '23001' && code !== '23503') throw err;
      }
    }
  }

  const cutoff = now.getTime() - ORPHAN_GRACE_HOURS * 3600_000;
  const deleted: string[] = [];
  let scanned = 0;
  let kept = 0;
  let page: { pathname: string; url: string; uploadedAt: Date }[] = [];

  const flush = async () => {
    if (page.length === 0) return;
    const { rows } = await pool.query<{ pathname: string }>('SELECT pathname FROM media WHERE pathname = ANY ($1::text[])', [page.map((b) => b.pathname)]);
    const known = new Set(rows.map((r) => r.pathname));
    const orphans = page.filter((b) => !known.has(b.pathname) && b.uploadedAt.getTime() < cutoff);
    kept += page.length - orphans.length;
    if (orphans.length > 0 && !options.dryRun) await deleteBlobs(orphans.map((b) => b.url));
    deleted.push(...orphans.map((b) => b.pathname));
    page = [];
  };

  for await (const blob of listBlobs(`${prefix}/`)) {
    // The API filters by prefix; checked again here, since a delete is the one thing this must never get wrong.
    if (!blob.pathname.startsWith(`${prefix}/`)) continue;
    scanned += 1;
    page.push(blob);
    if (page.length === 500) await flush();
  }
  await flush();
  return { purgedRows, scanned, deleted, kept };
}
