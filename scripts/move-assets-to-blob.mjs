#!/usr/bin/env node
/**
 * Moves the files migration 008 seeded as storage 'static' (public/assets,
 * served by the app) into the Vercel Blob store (spec §14.1 row 7 "chuyển ảnh
 * cũ lên Blob"), and points their media rows at the copies.
 *
 *   DATABASE_URL=… BLOB_READ_WRITE_TOKEN=… node scripts/move-assets-to-blob.mjs --prefix production            # dry run
 *   DATABASE_URL=… BLOB_READ_WRITE_TOKEN=… node scripts/move-assets-to-blob.mjs --prefix production --apply
 *
 * - Once, production only: production's database and the store Production and
 *   Preview share, folder `production` (README "Media in Vercel Blob"; the
 *   folder production's deployment uses, lib/media/rules.ts blobEnvPrefix, so
 *   its media-sweep cron sees the files as its own). Previews use the
 *   production database, so a run with a preview's folder would point
 *   production's rows at copies in that preview's folder: the script refuses
 *   every folder but `production`, and `development` (a local database and
 *   the fake store, as the tests run it).
 * - Dry run unless --apply: prints what it would upload and update, touches nothing.
 * - Idempotent: a file already in the store with the same size is not sent
 *   again; a row already 'blob' is skipped. Run it again after a failure.
 * - Each file is checked against its row (bytes) before it is sent, and its
 *   blur placeholder is computed from the same bytes (media.blur_data_url).
 * - The rows change in one transaction, after every upload succeeded, with
 *   one audit_log row each (actor: this script), holding the file on either
 *   side as History reads every media row (an ItemSnapshot: the row and its
 *   alt texts), the after side marked meta.moved_by: History lists the move
 *   and offers no restore of it (lib/admin/history.ts restoreChoices). The ids
 *   stay the same, so every reference (ON DELETE RESTRICT) still holds.
 * - Credentials: only an explicit BLOB_READ_WRITE_TOKEN (never the Vercel CLI's
 *   OIDC refresh, see lib/server/media/blob.ts). The public/assets files stay in
 *   the repository; the guest pages keep serving the cached /assets URLs until
 *   the next deploy, or the next save that expires the `media` tag.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BlobNotFoundError, head, put } from '@vercel/blob';
import { Client } from 'pg';
import sharp from 'sharp';
// Node strips the types of this .ts file itself (Node ≥ 22.18).
import { movedAssetPathname } from '../lib/media/rules.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const prefixAt = args.indexOf('--prefix');
const prefix = prefixAt === -1 ? '' : (args[prefixAt + 1] ?? '');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^(production|development)$/.test(prefix)) {
  fail('--prefix must be production (or development, with a local database and the fake store). Previews share production’s database: never a preview folder.');
}
const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
if (!token) fail('BLOB_READ_WRITE_TOKEN is not set (the read-write token of this environment’s store).');
const storeId = token.split('_')[3];
const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) fail('DATABASE_URL is not set (the database of the same environment).');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MOVED_BY = 'script:move-assets-to-blob';
// The file as History reads every media row (lib/server/content-admin/snapshot.ts readItem with MEDIA).
const SNAPSHOT = `SELECT jsonb_build_object(
    'v', 1, 'row', to_jsonb(m),
    'i18n', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.locale) FROM media_i18n t WHERE t.media_id = m.id), '[]'::jsonb)
  ) AS s FROM media m WHERE m.id = $1`;
const dbUrl = new URL(connectionString);
if (!LOCAL_HOSTS.has(dbUrl.hostname)) dbUrl.searchParams.set('sslmode', 'verify-full');

console.log(`${apply ? 'APPLY' : 'DRY RUN'}: database ${dbUrl.hostname}${dbUrl.pathname} → store ${storeId}, folder ${prefix}/`);

const client = new Client({ connectionString: dbUrl.toString() });
await client.connect();
try {
  const { rows } = await client.query(
    `SELECT id, pathname, content_type, bytes FROM media WHERE storage = 'static' ORDER BY pathname`,
  );
  const plan = [];
  for (const row of rows) {
    const bytes = await readFile(join(root, 'public', row.pathname));
    if (bytes.length !== row.bytes) fail(`${row.pathname}: ${bytes.length} bytes on disk, ${row.bytes} in the row; refusing to move a different file`);
    const target = movedAssetPathname(prefix, row.pathname);
    let existing = null;
    try {
      existing = await head(target, { token });
    } catch (err) {
      if (!(err instanceof BlobNotFoundError)) throw err;
    }
    if (existing && existing.size !== bytes.length) fail(`${target} is already in the store with ${existing.size} bytes (expected ${bytes.length}); remove it by hand first`);
    plan.push({ row, bytes, target, existing });
  }

  let uploaded = 0;
  for (const p of plan) {
    const verb = p.existing ? 'keep  ' : 'upload';
    console.log(`  ${verb} ${p.row.pathname} → ${p.target} (${p.bytes.length} bytes)`);
    if (apply && !p.existing) {
      p.existing = await put(p.target, p.bytes, {
        token,
        access: 'public',
        contentType: p.row.content_type,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      uploaded += 1;
    }
  }
  console.log(`${plan.length} static row(s); ${plan.filter((p) => !p.existing).length} file(s) to upload${apply ? `, ${uploaded} uploaded` : ''}.`);
  if (!apply) {
    console.log('Dry run: nothing changed. Add --apply to upload and update the rows.');
  } else if (plan.length > 0) {
    await client.query('BEGIN');
    for (const p of plan) {
      const blur =
        p.row.content_type === 'application/pdf'
          ? null
          : `data:image/webp;base64,${(await sharp(p.bytes).autoOrient().resize(16, 16, { fit: 'inside' }).webp({ quality: 50 }).toBuffer()).toString('base64')}`;
      const before = await client.query(`${SNAPSHOT} FOR UPDATE OF m`, [p.row.id]);
      const { rowCount } = await client.query(
        `UPDATE media SET storage = 'blob', url = $2, pathname = $3, blur_data_url = $4, updated_at = now(), updated_by = $6
          WHERE id = $1 AND storage = 'static' AND pathname = $5`,
        [p.row.id, p.existing.url, p.target, blur, p.row.pathname, MOVED_BY],
      );
      if (rowCount !== 1) throw new Error(`${p.row.pathname}: the row changed while the script ran`);
      const after = await client.query(SNAPSHOT, [p.row.id]);
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_email, action, entity_type, entity_id, before, after)
         VALUES (NULL, $4, 'update', 'media', $1, $2, $3)`,
        [p.row.id, before.rows[0].s, { ...after.rows[0].s, meta: { moved_by: MOVED_BY } }, MOVED_BY],
      );
    }
    await client.query('COMMIT');
    console.log(`Updated ${plan.length} row(s). Redeploy (or save any content that expires the media tag) so cached pages pick up the new URLs.`);
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  throw err;
} finally {
  await client.end();
}
