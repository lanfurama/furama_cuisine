import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import sharp from 'sharp';
import { getGlobalDispatcher } from 'undici';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeListEditor } from '@/lib/server/content-admin/list-editor';
import { readItem, snapshotToken, type ItemDef } from '@/lib/server/content-admin/snapshot';
import {
  MEDIA,
  MEDIA_REFERENCES,
  assertLiveMedia,
  deleteMedia,
  getMedia,
  listMedia,
  listTrashed,
  mediaUsage,
  restoreMedia,
  saveMediaDetails,
} from '@/lib/server/media/library';
import { registerUploadedMedia } from '@/lib/server/media/register';
import { installBlobRedirect, refused } from '../helpers/blob-redirect.mjs';
import { TEST_DATABASE_URL } from '../helpers/db';
import { startFakeBlob, type FakeBlob } from '../helpers/fake-blob';

/*
 * The media library against the database and the fake Blob server
 * (test/helpers/fake-blob.ts; never the real service): registerMedia's
 * upsert, measuring and audit; delete refused while a file is used (AC3),
 * soft delete otherwise, and the lock that keeps a delete and a save that
 * references the file from interleaving; the EN alt editor under the hash
 * token (R2, C8); History restore of a file (R14); and the restore engine
 * taking a file out of the trash when a version needs it (C7). Every
 * outgoing request of this process goes to the fake (blob-redirect.mjs
 * refuses all other hosts).
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
let pool: Pool;
let fake: FakeBlob;
const ADMIN = { id: 'admin-1', email: 'owner@furama.test', name: 'Chủ quán' };
const UUIDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#c86428' } }).png().toBuffer();
const chefId = async () => (await pool.query<{ id: string }>(`SELECT id FROM media WHERE pathname = '/assets/chef.jpg'`)).rows[0].id;
const token = async (id: string) => (await getMedia(pool, id))!.token;
const lastAudit = async (id: string) =>
  (await pool.query<{ id: string; action: string; before: Record<string, unknown>; after: Record<string, unknown> }>(
    `SELECT id::text, action, before, after FROM audit_log WHERE entity_type = 'media' AND entity_id = $1 ORDER BY id DESC LIMIT 1`,
    [id],
  )).rows[0];

async function upload(pathname: string, alt?: string): Promise<string> {
  fake.seed(pathname, await png(10, 10), 'image/png');
  const reg = await registerUploadedMedia(pool, ADMIN, { pathname, alt });
  if (!reg.ok) throw new Error(`refused: ${JSON.stringify(reg)}`);
  return reg.data.id;
}

describe.skipIf(!TEST_DATABASE_URL)('media library (database + fake Blob)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    fake = await startFakeBlob();
    const before = getGlobalDispatcher();
    installBlobRedirect(fake.url);
    // The redirect must be in place before any Blob call: otherwise a request would go to vercel.com.
    expect(getGlobalDispatcher()).not.toBe(before);
    process.env.BLOB_READ_WRITE_TOKEN = fake.token;
    process.env.VERCEL_BLOB_RETRIES = '0';
    delete process.env.VERCEL_OIDC_TOKEN;
    delete process.env.VERCEL_ENV;
  });

  afterAll(async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    await pool.query(`DELETE FROM audit_log WHERE entity_type IN ('media', 'stories')`);
    await pool.query(`DELETE FROM media WHERE storage = 'blob'`);
    await pool.query(`UPDATE media SET deleted_at = NULL WHERE storage = 'static'`);
    await pool.end();
    await fake.close();
    expect(refused).toEqual([]);
  });

  beforeEach(async () => {
    fake.files.clear();
    fake.requests.length = 0;
    await pool.query(`DELETE FROM media WHERE storage = 'blob' AND id NOT IN (SELECT image_id FROM stories)`);
  });

  it('names every column that references media, as the database has them (a new one must be added to MEDIA_REFERENCES)', async () => {
    const { rows } = await pool.query<{ table: string; column: string }>(
      `SELECT c.conrelid::regclass::text AS table, a.attname AS column
         FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = 'media'::regclass AND c.conrelid <> 'media_i18n'::regclass`,
    );
    const key = (r: { table: string; column: string }) => `${r.table}.${r.column}`;
    expect(rows.map(key).sort()).toEqual(MEDIA_REFERENCES.map(key).sort());
    // And each one is RESTRICT, so a hard delete can never take a shown file with it.
    const { rows: actions } = await pool.query<{ confdeltype: string }>(
      `SELECT DISTINCT confdeltype FROM pg_constraint WHERE contype = 'f' AND confrelid = 'media'::regclass AND conrelid <> 'media_i18n'::regclass`,
    );
    expect(actions).toEqual([{ confdeltype: 'r' }]);
  });

  it('registers an upload once: measured from the stored bytes, upserted by pathname, audited as a snapshot', async () => {
    const pathname = `development/media/${UUIDS[0]}/terrace.png`;
    fake.seed(pathname, await png(64, 48), 'image/png');

    const first = await registerUploadedMedia(pool, ADMIN, { pathname, alt: '  Terrace at dusk ' });
    expect(first).toMatchObject({ ok: true, data: { created: true } });
    if (!first.ok) throw new Error('refused');
    const row = (await getMedia(pool, first.data.id))!;
    expect(row).toMatchObject({
      storage: 'blob',
      url: `https://fakestore.public.blob.vercel-storage.com/${pathname}`,
      pathname,
      contentType: 'image/png',
      width: 64,
      height: 48,
      alt: 'Terrace at dusk',
      uses: 0,
      deletedAt: null,
    });
    expect(row.blurDataUrl).toMatch(/^data:image\/webp;base64,/);
    expect(row.token).toBe(snapshotToken(await readItem(pool, MEDIA, first.data.id)));

    // A retry (the answer was lost): same row, alt kept, an 'update' audit.
    const again = await registerUploadedMedia(pool, ADMIN, { pathname });
    expect(again).toEqual({ ok: true, data: { id: first.data.id, created: false } });
    expect((await getMedia(pool, first.data.id))!.alt).toBe('Terrace at dusk');
    const { rows: audit } = await pool.query(`SELECT action, actor_id, after FROM audit_log WHERE entity_type = 'media' AND entity_id = $1 ORDER BY id`, [first.data.id]);
    expect(audit.map((a) => [a.action, a.actor_id])).toEqual([
      ['create', 'admin-1'],
      ['update', 'admin-1'],
    ]);
    // The History shape of every content entity (R5): the row and its translations.
    expect(audit[0].after).toMatchObject({ v: 1, row: { id: first.data.id, pathname }, i18n: [{ locale: 'en', alt: 'Terrace at dusk' }] });
    // What went over the wire: head (bearer) then the file's bytes from the public host, twice.
    expect(fake.requests.map((r) => `${r.method} ${r.path} ${r.auth.split(':')[0]} ${r.status}`)).toEqual([
      'GET /api/blob bearer 200',
      `GET /cdn/${pathname} none 200`,
      'GET /api/blob bearer 200',
      `GET /cdn/${pathname} none 200`,
    ]);
  });

  it('refuses a file that is not what its name says, and deletes it from the store at once', async () => {
    const pathname = `development/media/${UUIDS[1]}/menu.pdf`;
    fake.seed(pathname, new TextEncoder().encode('<html>not a pdf</html>'), 'application/pdf');
    expect(await registerUploadedMedia(pool, ADMIN, { pathname })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { file: ['Nội dung file không đúng định dạng (chỉ nhận JPEG, PNG, WebP, AVIF hoặc PDF).'] },
    });
    expect(fake.files.has(pathname)).toBe(false);
    expect((await pool.query('SELECT 1 FROM media WHERE pathname = $1', [pathname])).rowCount).toBe(0);
  });

  it('refuses a real file the store serves under another Content-Type than its name signed for, and deletes it (SEC-2)', async () => {
    // Valid PDF bytes, but served as text/html: a guest's browser would render the stored file as a page.
    const pathname = `development/media/${UUIDS[2]}/menu.pdf`;
    fake.seed(pathname, new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'), 'text/html');
    expect(await registerUploadedMedia(pool, ADMIN, { pathname })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { file: ['Nội dung file không đúng định dạng (chỉ nhận JPEG, PNG, WebP, AVIF hoặc PDF).'] },
    });
    expect(fake.files.has(pathname)).toBe(false);
    expect((await pool.query('SELECT 1 FROM media WHERE pathname = $1', [pathname])).rowCount).toBe(0);
  });

  it('refuses a path of another environment or a file the store does not have, before reading anything', async () => {
    expect(await registerUploadedMedia(pool, ADMIN, { pathname: `production/media/${UUIDS[0]}/x.png` })).toMatchObject({
      ok: false,
      fieldErrors: { file: ['Đường dẫn file không hợp lệ cho môi trường này.'] },
    });
    expect(fake.requests).toEqual([]);
    expect(await registerUploadedMedia(pool, ADMIN, { pathname: `development/media/${UUIDS[0]}/x.png` })).toMatchObject({
      ok: false,
      fieldErrors: { file: ['Không tìm thấy file vừa tải lên. Hãy tải lại.'] },
    });
  });

  it('AC3: refuses to delete a file content shows, and lists where', async () => {
    const id = await chefId();
    expect(await mediaUsage(pool, id)).toEqual([{ label: 'Section experiences', href: '/admin/content/sections' }]);
    const result = await deleteMedia(pool, ADMIN, { id, token: await token(id) });
    expect(result).toEqual({ ok: false, code: 'in_use', uses: [{ label: 'Section experiences', href: '/admin/content/sections' }] });
    expect((await getMedia(pool, id))!.deletedAt).toBeNull();

    const card = (await pool.query<{ id: string }>(`SELECT card_image_id AS id FROM restaurants WHERE id = 'taya-house'`)).rows[0].id;
    expect((await mediaUsage(pool, card)).map((u) => u.label)).toEqual(['Ảnh thẻ nhà hàng Tàya House']);
  });

  it('soft-deletes an unused file: out of the library and of every save, kept in the trash and in the store', async () => {
    const pathname = `development/media/${UUIDS[2]}/spare.png`;
    const id = await upload(pathname, 'Spare');

    expect(await deleteMedia(pool, ADMIN, { id, token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await deleteMedia(pool, ADMIN, { id, token: await token(id) })).toEqual({ ok: true, data: null });
    expect((await listMedia(pool)).some((m) => m.id === id)).toBe(false);
    expect((await listTrashed(pool)).map((m) => m.id)).toContain(id);
    // Its page still opens (History, "Khôi phục mục đã xóa"); a second delete finds nothing to delete.
    expect((await getMedia(pool, id))!.deletedAt).not.toBeNull();
    expect(await deleteMedia(pool, ADMIN, { id, token: await token(id) })).toEqual({ ok: false, code: 'not_found' });
    const audit = await lastAudit(id);
    expect(audit.action).toBe('delete');
    expect(audit.before).toMatchObject({ v: 1, row: { id, pathname, deleted_at: null }, i18n: [{ locale: 'en', alt: 'Spare' }] });
    expect((audit.after.row as { deleted_at: string | null }).deleted_at).not.toBeNull();
    // The file stays in the store until the sweep purges the row (R14).
    expect(fake.files.has(pathname)).toBe(true);
    // A save that points content at it is refused.
    const client = await pool.connect();
    try {
      expect(await assertLiveMedia(client, [id, await chefId()])).toEqual([id]);
    } finally {
      client.release();
    }
  });

  it('History brings a deleted file back, and a version that had it deleted comes back only while nothing shows it (R14, code rule 5)', async () => {
    const id = await upload(`development/media/${UUIDS[0]}/back.png`, 'Back again');
    await deleteMedia(pool, ADMIN, { id, token: await token(id) });
    const deleted = await lastAudit(id);

    expect(await restoreMedia(pool, ADMIN, { id, auditId: deleted.id, side: 'before', token: 'stale' })).toMatchObject({ ok: false, code: 'conflict' });
    expect(await restoreMedia(pool, ADMIN, { id, auditId: deleted.id, side: 'before', token: await token(id) })).toEqual({ ok: true, data: null });
    expect(await getMedia(pool, id)).toMatchObject({ deletedAt: null, alt: 'Back again' });
    const restored = await lastAudit(id);
    expect(restored).toMatchObject({ action: 'restore', after: { meta: { restored_from: deleted.id } } });

    // The restore's "before" is the deleted file: refused while a section shows it…
    const old = (await pool.query<{ image_id: string }>(`SELECT image_id FROM sections WHERE key = 'heritage'`)).rows[0].image_id;
    await pool.query(`UPDATE sections SET image_id = $1 WHERE key = 'heritage'`, [id]);
    try {
      expect(await restoreMedia(pool, ADMIN, { id, auditId: restored.id, side: 'before', token: await token(id) })).toEqual({
        ok: false,
        code: 'in_use',
        uses: [{ label: 'Section heritage', href: '/admin/content/sections' }],
      });
    } finally {
      await pool.query(`UPDATE sections SET image_id = $1 WHERE key = 'heritage'`, [old]);
    }
    // …and deletes it again once nothing does.
    expect(await restoreMedia(pool, ADMIN, { id, auditId: restored.id, side: 'before', token: await token(id) })).toEqual({ ok: true, data: null });
    expect((await getMedia(pool, id))!.deletedAt).not.toBeNull();
    // A version from another file's history is not this file's.
    expect(await restoreMedia(pool, ADMIN, { id: await chefId(), auditId: deleted.id, side: 'before', token: await token(await chefId()) })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });

  it('a delete waits for a save that is pointing content at the file, then sees the use', async () => {
    const id = await upload(`development/media/${UUIDS[0]}/race.png`);
    const old = (await pool.query<{ image_id: string }>(`SELECT image_id FROM sections WHERE key = 'experiences'`)).rows[0].image_id;

    const save = await pool.connect();
    try {
      await save.query('BEGIN');
      // The save checks the file first (code rule 2) and writes the reference later in its transaction.
      expect(await assertLiveMedia(save, [id], 'image')).toEqual([]);
      const pending = deleteMedia(pool, ADMIN, { id, token: await token(id) });
      await new Promise((r) => setTimeout(r, 150));
      // The delete is still waiting on assertLiveMedia's key-share lock (without it, the delete would be done by now)...
      await save.query(`UPDATE sections SET image_id = $1 WHERE key = 'experiences'`, [id]);
      await save.query('COMMIT');
      // ...and once the save commits, finds the file in use.
      expect(await pending).toMatchObject({ ok: false, code: 'in_use', uses: [{ label: 'Section experiences' }] });
    } finally {
      await save.query(`UPDATE sections SET image_id = $1 WHERE key = 'experiences'`, [old]);
      save.release();
    }
  });

  it('edits the EN alt text and the decorative flag under the hash token, and History puts the seed alt back as it was (R3)', async () => {
    const id = await chefId();
    const original = (await getMedia(pool, id))!;
    const saved = await saveMediaDetails(pool, ADMIN, { id, token: original.token, alt: 'The chef at the pass', decorative: false });
    expect(saved).toEqual({ ok: true, data: { token: await token(id) } });
    const edited = await lastAudit(id);
    expect((await getMedia(pool, id))!.alt).toBe('The chef at the pass');
    expect(await saveMediaDetails(pool, ADMIN, { id, token: original.token, alt: 'x', decorative: false })).toMatchObject({ ok: false, code: 'conflict' });
    // Empty alt removes the EN row; decorative keeps alt="" wherever it is shown.
    expect(await saveMediaDetails(pool, ADMIN, { id, token: await token(id), alt: '', decorative: true })).toEqual(SAVED);
    expect(await getMedia(pool, id)).toMatchObject({ alt: '', isDecorative: true });
    expect((await lastAudit(id)).after.i18n).toEqual([]);

    // The version before the first edit: the seed's alt with its own review state, the flag off.
    expect(await restoreMedia(pool, ADMIN, { id, auditId: edited.id, side: 'before', token: await token(id) })).toEqual({ ok: true, data: null });
    expect(await getMedia(pool, id)).toMatchObject({ alt: original.alt, isDecorative: original.isDecorative, token: expect.any(String) });
    expect((await pool.query(`SELECT origin FROM media_i18n WHERE media_id = $1 AND locale = 'en'`, [id])).rows).toEqual([{ origin: 'seed' }]);
  });

  describe('the restore engine and files in the trash (C7, code rule 2)', () => {
    const STORY: ItemDef = {
      entityType: 'stories',
      table: 'stories',
      idType: 'bigint',
      columns: ['image_id', 'href', 'published_on', 'sort_order', 'is_published'],
      i18n: { table: 'story_i18n', fk: 'story_id', columns: ['category', 'title', 'href'] },
      tables: ['stories', 'story_i18n'],
      media: [{ column: 'image_id', kind: 'image' }],
    };
    const stories = makeListEditor<{ imageId: string; href: string }>(STORY, {
      listKey: 'stories',
      toRow: (input) => ({ image_id: input.imageId, href: input.href }),
    });
    const storyToken = async (id: string) => snapshotToken(await readItem(pool, STORY, id));
    const deleteRow = async (id: string) =>
      (await pool.query<{ id: string }>(`SELECT id::text FROM audit_log WHERE entity_type = 'stories' AND entity_id = $1 AND action = 'delete' ORDER BY id DESC LIMIT 1`, [id])).rows[0].id;

    it('a version whose picture is in the trash brings the picture back; one whose picture was purged cannot come back; a save cannot point at a trashed file', async () => {
      const { rows } = await pool.query<{ id: string; image_id: string; href: string }>(`SELECT id::text, image_id, href FROM stories ORDER BY sort_order, id LIMIT 1`);
      const story = rows[0];
      const firstEdit = async () =>
        (await pool.query<{ id: string }>(`SELECT id::text FROM audit_log WHERE entity_type = 'stories' AND entity_id = $1 AND action = 'update' ORDER BY id LIMIT 1`, [story.id])).rows[0].id;
      const picture = await upload(`development/media/${UUIDS[1]}/story.png`, 'A story');
      try {
        expect(await stories.update(pool, ADMIN, story.id, await storyToken(story.id), { imageId: picture, href: story.href })).toEqual(SAVED);
        expect(await stories.remove(pool, ADMIN, story.id, await storyToken(story.id))).toMatchObject({ ok: true });
        expect(await deleteMedia(pool, ADMIN, { id: picture, token: await token(picture) })).toEqual({ ok: true, data: null });

        // A save may not point content at a file in the trash.
        expect(await stories.create(pool, ADMIN, { imageId: picture, href: story.href })).toEqual({
          ok: false,
          code: 'invalid',
          fieldErrors: { image_id: ['File này đã bị xóa khỏi thư viện. Hãy chọn file khác.'] },
        });

        // The story's last version comes back with its picture, which leaves the trash with its own audit row.
        expect(await stories.restore(pool, ADMIN, { id: story.id, auditId: await deleteRow(story.id), side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
        expect((await readItem(pool, STORY, story.id))!.row.image_id).toBe(picture);
        expect((await getMedia(pool, picture))!.deletedAt).toBeNull();
        expect(await lastAudit(picture)).toMatchObject({ action: 'restore', before: { row: { id: picture } }, after: { row: { deleted_at: null } } });

        // Purged (the sweep's hard delete, R14): that version is gone for good.
        expect(await stories.remove(pool, ADMIN, story.id, await storyToken(story.id))).toMatchObject({ ok: true });
        await deleteMedia(pool, ADMIN, { id: picture, token: await token(picture) });
        await pool.query('DELETE FROM media WHERE id = $1', [picture]);
        expect(await stories.restore(pool, ADMIN, { id: story.id, auditId: await deleteRow(story.id), side: 'before', token: 'deleted' })).toEqual({
          ok: false,
          code: 'missing_reference',
        });
        expect(await readItem(pool, STORY, story.id)).toBeNull();
      } finally {
        // The version before the first edit: the seed's picture.
        if (!(await readItem(pool, STORY, story.id))) {
          expect(await stories.restore(pool, ADMIN, { id: story.id, auditId: await firstEdit(), side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
        }
        expect((await readItem(pool, STORY, story.id))!.row.image_id).toBe(story.image_id);
      }
    });
  });

  it('the static seed files are untouched by everything above', () => {
    expect(readFileSync(join(process.cwd(), 'public/assets/chef.jpg')).length).toBe(57833);
  });
});
