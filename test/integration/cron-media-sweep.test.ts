import { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerUploadedMedia } from '@/lib/server/media/register';
import { sweepMedia } from '@/lib/server/media/sweep';
import { installBlobRedirect, refused } from '../helpers/blob-redirect.mjs';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startFakeBlob, type FakeBlob } from '../helpers/fake-blob';

/*
 * The media-sweep (spec §12 "Upload lỗi"; R14, R15) against the database and
 * the fake Blob server (never the real service): orphans of this environment's
 * folder older than 24 hours go, rows 30 days in the trash are purged unless
 * content uses them again, and a database error stops the run before any
 * delete. Then /api/cron/media-sweep: Vercel Cron's bearer secret or 401, a
 * store that is not configured is skipped, `?dry=1` deletes nothing.
 */

const { GET, maxDuration } = await import('@/app/api/cron/media-sweep/route');

const SECRET = 'cron-secret-0123456789abcdef';
const ADMIN = { id: 'admin-1', email: 'owner@furama.test', name: 'Chủ quán' };
const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#c86428' } }).png().toBuffer();
const call = (authorization?: string, query = '') =>
  GET(new Request(`http://localhost/api/cron/media-sweep${query}`, { headers: authorization ? { authorization } : {} }));

let fake: FakeBlob;
let pool: Pool;

beforeAll(async () => {
  fake = await startFakeBlob();
  installBlobRedirect(fake.url);
});
afterAll(async () => {
  await fake.close();
  expect(refused).toEqual([]);
});
beforeEach(() => {
  fake.files.clear();
  fake.requests.length = 0;
});

describe.skipIf(!TEST_DATABASE_URL)('sweepMedia (database + fake Blob)', () => {
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', fake.token);
    vi.stubEnv('VERCEL_BLOB_RETRIES', '0');
    vi.stubEnv('VERCEL_ENV', '');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool.query(`DELETE FROM audit_log WHERE entity_type = 'media'`);
    await pool.query(`DELETE FROM media WHERE storage = 'blob'`);
    await pool.end();
  });

  it('deletes old orphans of its own folder only; keeps young ones, every file a row names, and other folders', async () => {
    const kept = `development/media/${UUIDS[0]}/kept.png`;
    fake.seed(kept, await png(), 'image/png');
    const reg = await registerUploadedMedia(pool, ADMIN, { pathname: kept });
    if (!reg.ok) throw new Error('refused');
    fake.files.get(kept)!.uploadedAt = hoursAgo(100);
    fake.seed(`development/media/${UUIDS[1]}/orphan.png`, await png(), 'image/png', hoursAgo(25));
    fake.seed(`development/media/${UUIDS[2]}/young.png`, await png(), 'image/png', hoursAgo(23));
    fake.seed(`production/media/${UUIDS[1]}/other-env.png`, await png(), 'image/png', hoursAgo(1000));
    fake.seed(`development-old/x.png`, await png(), 'image/png', hoursAgo(1000));
    fake.requests.length = 0;

    const dry = await sweepMedia(pool, { prefix: 'development', now, dryRun: true });
    expect(dry).toEqual({ purgedRows: 0, purgedFiles: [], scanned: 3, deleted: [`development/media/${UUIDS[1]}/orphan.png`], kept: 2 });
    expect(fake.files.size).toBe(5);

    const report = await sweepMedia(pool, { prefix: 'development', now });
    expect(report.deleted).toEqual([`development/media/${UUIDS[1]}/orphan.png`]);
    expect([...fake.files.keys()].sort()).toEqual([
      `development-old/x.png`,
      `development/media/${UUIDS[0]}/kept.png`,
      `development/media/${UUIDS[2]}/young.png`,
      `production/media/${UUIDS[1]}/other-env.png`,
    ]);
    // It only ever listed its own folder (R15).
    expect(fake.requests.filter((r) => r.path === '/api/blob' && r.method === 'GET').map((r) => r.query.prefix)).toEqual(['development/', 'development/']);
  });

  it('purges rows 30 days in the trash, then their files, and never a row content uses', async () => {
    const pathname = `development/media/${UUIDS[0]}/trash.png`;
    fake.seed(pathname, await png(), 'image/png', hoursAgo(24 * 40));
    const reg = await registerUploadedMedia(pool, ADMIN, { pathname });
    if (!reg.ok) throw new Error('refused');
    await pool.query(`UPDATE media SET deleted_at = now() - interval '31 days' WHERE id = $1`, [reg.data.id]);
    // A recent delete stays in the trash.
    const recent = `development/media/${UUIDS[1]}/recent.png`;
    fake.seed(recent, await png(), 'image/png', hoursAgo(24 * 40));
    const reg2 = await registerUploadedMedia(pool, ADMIN, { pathname: recent });
    if (!reg2.ok) throw new Error('refused');
    await pool.query(`UPDATE media SET deleted_at = now() - interval '29 days' WHERE id = $1`, [reg2.data.id]);
    // A static file someone soft-deleted by hand while a section still shows it: RESTRICT keeps it (SQLSTATE 23001).
    const chef = (await pool.query<{ id: string }>(`SELECT id FROM media WHERE pathname = '/assets/chef.jpg'`)).rows[0].id;
    await pool.query(`UPDATE media SET deleted_at = now() - interval '31 days' WHERE id = $1`, [chef]);
    try {
      const report = await sweepMedia(pool, { prefix: 'development', now });
      expect(report.purgedRows).toBe(1);
      expect(report.deleted).toEqual([pathname]);
      expect((await pool.query('SELECT 1 FROM media WHERE id = $1', [reg.data.id])).rowCount).toBe(0);
      expect((await pool.query('SELECT 1 FROM media WHERE id = $1', [reg2.data.id])).rowCount).toBe(1);
      expect(fake.files.has(recent)).toBe(true);
      expect((await pool.query('SELECT 1 FROM media WHERE id = $1', [chef])).rowCount).toBe(1);
      const { rows } = await pool.query(`SELECT actor_id, action, before, after FROM audit_log WHERE entity_id = $1 ORDER BY id DESC LIMIT 1`, [reg.data.id]);
      expect(rows[0]).toMatchObject({ actor_id: null, action: 'delete', before: { v: 1, row: { id: reg.data.id } }, after: null });
    } finally {
      await pool.query(`UPDATE media SET deleted_at = NULL WHERE id = $1`, [chef]);
    }
  });

  it('purges a trashed row whose file is in another folder (a preview upload is a production row) and deletes that file, listing only its own folder', async () => {
    // Registered as this environment's upload, then moved by SQL to where a preview of the same database would put it.
    const own = `development/media/${UUIDS[2]}/a.png`;
    const preview = `preview/feature-x/media/${UUIDS[2]}/a.png`;
    fake.seed(own, await png(), 'image/png', hoursAgo(24 * 40));
    const reg = await registerUploadedMedia(pool, ADMIN, { pathname: own });
    if (!reg.ok) throw new Error('refused');
    fake.files.delete(own);
    fake.seed(preview, await png(), 'image/png', hoursAgo(24 * 40));
    await pool.query(
      `UPDATE media SET pathname = $2, url = 'https://fakestore.public.blob.vercel-storage.com/' || $2, deleted_at = now() - interval '31 days' WHERE id = $1`,
      [reg.data.id, preview],
    );
    fake.requests.length = 0;

    const report = await sweepMedia(pool, { prefix: 'development', now });
    expect(report.purgedRows).toBe(1);
    expect((await pool.query('SELECT 1 FROM media WHERE id = $1', [reg.data.id])).rowCount).toBe(0);
    expect(fake.files.has(preview)).toBe(false);
    expect(report.purgedFiles).toEqual([preview]);
    expect(report.deleted).toEqual([]);
    // It still listed only its own folder (R15): the file was found through the purged row, not a listing.
    expect(fake.requests.filter((r) => r.path === '/api/blob' && r.method === 'GET').map((r) => r.query.prefix)).toEqual(['development/']);
  });

  it('a database error stops the run before any delete: never delete when unsure', async () => {
    // A purged row's file in another folder waits for the orphan pass too.
    const own = `development/media/${UUIDS[1]}/b.png`;
    const preview = `preview/feature-x/media/${UUIDS[1]}/b.png`;
    fake.seed(own, await png(), 'image/png', hoursAgo(24 * 40));
    const reg = await registerUploadedMedia(pool, ADMIN, { pathname: own });
    if (!reg.ok) throw new Error('refused');
    fake.files.delete(own);
    fake.seed(preview, await png(), 'image/png', hoursAgo(24 * 40));
    await pool.query(
      `UPDATE media SET pathname = $2, url = 'https://fakestore.public.blob.vercel-storage.com/' || $2, deleted_at = now() - interval '31 days' WHERE id = $1`,
      [reg.data.id, preview],
    );
    fake.requests.length = 0;
    fake.seed(`development/media/${UUIDS[2]}/orphan.png`, await png(), 'image/png', hoursAgo(48));
    const failing = {
      query: (sql: string, values?: unknown[]) => (/pathname = ANY/.test(sql) ? Promise.reject(new Error('db down')) : pool.query(sql, values)),
      connect: () => pool.connect(),
    } as unknown as Pool;
    await expect(sweepMedia(failing, { prefix: 'development', now })).rejects.toThrow('db down');
    expect(fake.files.has(`development/media/${UUIDS[2]}/orphan.png`)).toBe(true);
    expect(fake.files.has(preview)).toBe(true);
    expect(fake.requests.some((r) => r.path === '/api/blob/delete')).toBe(false);
  });

  it('refuses a prefix that could reach outside a folder', async () => {
    for (const prefix of ['', '/', '../x', '*', 'Production']) {
      await expect(sweepMedia(pool, { prefix, now })).rejects.toThrow(/refusing to sweep/);
    }
    expect(fake.requests).toEqual([]);
  });
});

describe('GET /api/cron/media-sweep', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('answers 401 without the secret, and touches no store', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', fake.token);
    for (const header of [undefined, 'Bearer wrong-secret-0123456789', SECRET]) {
      const res = await call(header);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fake.requests).toEqual([]);
  });

  it('skips an environment without a Blob store (local dev, CI) instead of failing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('BLOB_STORE_ID', '');
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ skipped: 'blob_not_configured' });
    expect(fake.requests).toEqual([]);
  });

  it.skipIf(!TEST_DATABASE_URL)('with the secret, sweeps its own folder; ?dry=1 deletes nothing', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', fake.token);
    vi.stubEnv('VERCEL_BLOB_RETRIES', '0');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(console, 'info').mockImplementation(() => {});
    fake.seed(`production/media/${UUIDS[0]}/orphan.png`, new Uint8Array([1]), 'image/png', new Date(Date.now() - 48 * 3600_000));
    fake.seed(`development/media/${UUIDS[0]}/orphan.png`, new Uint8Array([1]), 'image/png', new Date(Date.now() - 48 * 3600_000));

    const dry = await call(`Bearer ${SECRET}`, '?dry=1');
    expect(await dry.json()).toMatchObject({ prefix: 'production', dryRun: true, scanned: 1, deleted: [`production/media/${UUIDS[0]}/orphan.png`] });
    expect(fake.files.size).toBe(2);

    const res = await call(`Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ prefix: 'production', dryRun: false, deleted: [`production/media/${UUIDS[0]}/orphan.png`] });
    expect([...fake.files.keys()]).toEqual([`development/media/${UUIDS[0]}/orphan.png`]);
  });

  it('may run for five minutes (a large store pages through 1000 files at a time)', () => {
    expect(maxDuration).toBe(300);
  });
});
