import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import {
  createCuisine,
  CUISINE,
  CUISINE_NEEDS_LABEL,
  deleteCuisine,
  listCuisinesAdmin,
  reorderCuisines,
  restoreCuisine,
  restoreCuisineOrder,
  setCuisinePublished,
  updateCuisine,
  type CuisineInput,
} from '@/lib/server/content-admin/cuisines';
import { listDeleted } from '@/lib/server/content-admin/history';
import { ID_TAKEN, makeListEditor, MEDIA_GONE, STILL_IN_USE } from '@/lib/server/content-admin/list-editor';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadRestaurants } from '@/lib/server/content/restaurants.queries';
import { loadCuisines } from '@/lib/server/content/site.queries';

/*
 * The cuisines editor (spec §7.2 content/cuisines, §6.5 "nên tối đa 10",
 * §7.4, §7.5) against the database: the rail and the filters follow each
 * write at once (loadCuisines, and the catalogue's cuisine ids and labels);
 * a cuisine a restaurant lists cannot be deleted; a deleted one comes back
 * under its slug.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };

let seed: ItemSnapshot[] = [];
let thaiImage = '';

const audit = async () => (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const item = async (id: string) => (await listCuisinesAdmin(pool)).items.find((c) => c.id === id)!;
const listToken = async () => (await listCuisinesAdmin(pool)).token;
const rail = async () => (await loadCuisines('en')).map((c) => c.id);
const cuisinesOf = async (restaurant: string) => (await loadRestaurants('en')).find((r) => r.id === restaurant)!.cuisines;

const cuisine = (id: string, patch: Partial<CuisineInput> = {}): CuisineInput => ({ id, imageId: thaiImage, isPublished: true, label: { en: `Test ${id}` }, ...patch });

/** Puts every cuisine back as migration 008 seeded it, and removes this test's own rows. */
async function resetCuisines() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM cuisines WHERE id LIKE 'test-b2-%'`);
    for (const s of seed) await writeItem(client, CUISINE, s, 'seed', { order: true });
    await client.query(`DELETE FROM media WHERE pathname LIKE '/assets/test-b2-%'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('cuisines editor (database)', () => {
  beforeAll(async () => {
    seed = await readItems(pool, CUISINE);
    thaiImage = String(seed.find((s) => s.row.id === 'thai')!.row.image_id);
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetCuisines());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('a rename reaches the rail at once; History brings the old label back; a page older than another save is a conflict', async () => {
    const thai = await item('thai');
    expect(thai).toMatchObject({ name: 'Thai', isPublished: true, restaurants: 2 });
    expect(await updateCuisine(pool, ACTOR, 'thai', thai.token, { ...thai.values, label: { en: 'Thai & Lao' } })).toEqual({ ok: true, data: null });
    expect((await loadCuisines('en')).find((c) => c.id === 'thai')?.label).toBe('Thai & Lao');
    const [saved] = await audit();
    expect(saved).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'cuisines', entity_id: 'thai' });
    expect(await updateCuisine(pool, OTHER, 'thai', thai.token, thai.values)).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
    expect(await restoreCuisine(pool, OTHER, { id: 'thai', auditId: saved.id, side: 'before', token: (await item('thai')).token })).toEqual({ ok: true, data: null });
    expect((await loadCuisines('en')).find((c) => c.id === 'thai')?.label).toBe('Thai');
  });

  it('hidden, it leaves the rail and the restaurants’ cuisines; shown again, it is back', async () => {
    expect(await cuisinesOf('thai-siam-kitchen')).toEqual(['thai']);
    expect(await setCuisinePublished(pool, ACTOR, 'thai', (await item('thai')).token, false)).toEqual({ ok: true, data: null });
    expect(await rail()).not.toContain('thai');
    expect(await cuisinesOf('thai-siam-kitchen')).toEqual([]);
    expect(await setCuisinePublished(pool, ACTOR, 'thai', (await item('thai')).token, true)).toEqual({ ok: true, data: null });
    expect(await cuisinesOf('thai-siam-kitchen')).toEqual(['thai']);
  });

  it('a new cuisine needs its EN label and a live picture, takes its slug once, and ten shown is only advice', async () => {
    expect(await createCuisine(pool, ACTOR, cuisine('test-b2-korean', { label: { en: null } }))).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { label: [CUISINE_NEEDS_LABEL] },
    });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, deleted_at)
       VALUES ('static', '/assets/test-b2-gone.jpg', '/assets/test-b2-gone.jpg', 'image/jpeg', 40, 40, 1000, now()) RETURNING id`,
    );
    expect(await createCuisine(pool, ACTOR, cuisine('test-b2-korean', { imageId: rows[0].id }))).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { imageId: [MEDIA_GONE] },
    });
    expect(await createCuisine(pool, ACTOR, cuisine('test-b2-korean'))).toEqual({ ok: true, data: { id: 'test-b2-korean' } });
    expect(await createCuisine(pool, ACTOR, cuisine('test-b2-korean'))).toEqual({ ok: false, code: 'invalid', fieldErrors: { id: [ID_TAKEN] } });
    // Eight seeded, so the eleventh shown is allowed: §6.5 says "nên", and the screen warns (limitWarnings).
    for (const id of ['test-b2-a', 'test-b2-b']) expect((await createCuisine(pool, ACTOR, cuisine(id))).ok).toBe(true);
    expect(await rail()).toHaveLength(11);
  });

  it('a cuisine a restaurant lists cannot be deleted, and the refusal names it; an unused one comes back under its slug, in its place', async () => {
    expect(await deleteCuisine(pool, ACTOR, 'thai', (await item('thai')).token)).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { _: ['Ẩm thực này đang gắn với 2 nhà hàng (Thai Siam Kitchen, Yum Food Village). Bỏ nó ở các nhà hàng đó trước, hoặc chỉ ẩn nó.'] },
    });
    expect(await audit()).toEqual([]);

    await createCuisine(pool, ACTOR, cuisine('test-b2-korean'));
    const before = (await listCuisinesAdmin(pool)).items.map((c) => c.id);
    expect(await reorderCuisines(pool, ACTOR, await listToken(), ['test-b2-korean', ...before.slice(0, -1)])).toEqual({ ok: true, data: null });
    const reordered = (await audit()).at(-1);
    expect(await deleteCuisine(pool, ACTOR, 'test-b2-korean', (await item('test-b2-korean')).token)).toEqual({ ok: true, data: { meta: null } });
    expect(await rail()).not.toContain('test-b2-korean');
    const [gone] = await listDeleted(pool, CUISINE);
    expect(gone.id).toBe('test-b2-korean');
    expect(await restoreCuisine(pool, OTHER, { id: 'test-b2-korean', auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
    expect((await rail())[0]).toBe('test-b2-korean');
    expect(await restoreCuisineOrder(pool, OTHER, { auditId: reordered.id, side: 'before', token: await listToken() })).toEqual({ ok: true, data: null });
    expect((await listCuisinesAdmin(pool)).items.map((c) => c.id)).toEqual(before);
  });

  it('the database stays the last guard: a delete a RESTRICT key refuses (23001) is refused cleanly, nothing written', async () => {
    // The cuisines list without its refuseDelete: only restaurant_cuisines' ON DELETE RESTRICT stands in the way.
    const bare = makeListEditor<CuisineInput>(CUISINE, { listKey: 'cuisines', toRow: (input) => ({ id: input.id, image_id: input.imageId, is_published: input.isPublished }) });
    expect(await bare.remove(pool, ACTOR, 'thai', (await item('thai')).token)).toEqual({ ok: false, code: 'invalid', fieldErrors: { _: [STILL_IN_USE] } });
    expect(await rail()).toContain('thai');
    expect(await audit()).toEqual([]);
  });
});
