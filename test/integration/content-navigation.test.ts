import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { listDeleted } from '@/lib/server/content-admin/history';
import {
  createNavItem,
  deleteNavItem,
  listNavAdmin,
  NAV_ITEM,
  NAV_NEEDS_LABEL,
  NAV_RESTORE_TARGET_TAKEN,
  NAV_TARGET_TAKEN,
  reorderNavItems,
  restoreNavItem,
  restoreNavItemOrder,
  setNavItemPublished,
  updateNavItem,
} from '@/lib/server/content-admin/nav';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadNav } from '@/lib/server/content/site.queries';

/*
 * The navigation editor (spec §7.2 content/navigation, §6.5 "tối đa 6 mục;
 * nhãn > 14 cảnh báo, > 18 không cho lưu; mục tự ẩn khi section đích bị
 * ẩn"; phase-6 L7-14) against the database: the header's and the menu's
 * items (loadNav) follow each write at once.
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };

let seed: ItemSnapshot[] = [];

const audit = async () => (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const item = async (target: string) => (await listNavAdmin(pool)).items.find((n) => n.values.targetSection === target)!;
const listToken = async () => (await listNavAdmin(pool)).token;
const menu = async () => (await loadNav('en')).map((n) => `${n.target}:${n.label}`);

/** Puts the menu back as migration 008 seeded it, and the sections' switches on. */
async function resetNav() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM nav_items');
    for (const s of seed) await writeItem(client, NAV_ITEM, s, 'seed', { order: true });
    await client.query('UPDATE sections SET is_visible = true');
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('navigation editor (database)', () => {
  beforeAll(async () => {
    seed = await readItems(pool, NAV_ITEM);
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetNav());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('a renamed item reaches the menu at once; History brings the old label back; a page older than another save is a conflict', async () => {
    expect(await menu()).toEqual([
      'restaurants:Restaurants',
      'destinations:Destinations',
      'experiences:Experiences',
      'offers:Offers',
      'stories:Stories',
      'heritage:About',
    ]);
    const offers = await item('offers');
    expect(await updateNavItem(pool, ACTOR, offers.id, offers.token, { ...offers.values, label: { en: 'Deals' } })).toEqual(SAVED);
    expect(await menu()).toContain('offers:Deals');
    const [saved] = await audit();
    expect(saved).toMatchObject({ action: 'update', entity_type: 'nav_items', entity_id: offers.id });
    expect(await updateNavItem(pool, OTHER, offers.id, offers.token, offers.values)).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
    expect(await restoreNavItem(pool, OTHER, { id: offers.id, auditId: saved.id, side: 'before', token: (await item('offers')).token })).toEqual({
      ok: true,
      data: null,
    });
    expect(await menu()).toContain('offers:Offers');
  });

  it('a label needs EN text of at most 18 characters; one item per section; at most 6 shown (spec §6.5, L7-14)', async () => {
    const offers = await item('offers');
    for (const label of [null, '  ', 'A'.repeat(19)]) {
      expect(await updateNavItem(pool, ACTOR, offers.id, offers.token, { ...offers.values, label: { en: label } })).toEqual({
        ok: false,
        code: 'invalid',
        fieldErrors: { label: [NAV_NEEDS_LABEL] },
      });
    }
    // Eighteen is the most the one-line header holds: allowed (the form warns past 14).
    expect(await updateNavItem(pool, ACTOR, offers.id, offers.token, { ...offers.values, label: { en: 'A'.repeat(18) } })).toEqual(SAVED);

    expect(await createNavItem(pool, ACTOR, { id: null, targetSection: 'stories', isPublished: false, label: { en: 'News' } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { targetSection: [NAV_TARGET_TAKEN] },
    });
    // Six shown already: a seventh (the one free section) may be added hidden, not shown.
    expect(await createNavItem(pool, ACTOR, { id: null, targetSection: 'cuisines', isPublished: true, label: { en: 'Cuisines' } })).toEqual({
      ok: false,
      code: 'limit',
      params: { max: '6' },
    });
    expect((await createNavItem(pool, ACTOR, { id: null, targetSection: 'cuisines', isPublished: false, label: { en: 'Cuisines' } })).ok).toBe(true);
    const cuisines = await item('cuisines');
    expect(await setNavItemPublished(pool, ACTOR, cuisines.id, cuisines.token, true)).toEqual({ ok: false, code: 'limit', params: { max: '6' } });
    // Moving an item onto a section another item has is refused too.
    expect(await updateNavItem(pool, ACTOR, cuisines.id, cuisines.token, { ...cuisines.values, targetSection: 'heritage' })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { targetSection: [NAV_TARGET_TAKEN] },
    });
  });

  it('an item hides with its section, whatever its own switch says (spec §6.5); the screen says so', async () => {
    await pool.query(`UPDATE sections SET is_visible = false WHERE key = 'stories'`);
    expect(await menu()).not.toContain('stories:Stories');
    expect(await item('stories')).toMatchObject({ isPublished: true, sectionVisible: false });
  });

  it('deleted, an item comes back under its id in its place, unless its section has another item by then; the order and its History', async () => {
    const before = (await listNavAdmin(pool)).items.map((n) => n.id);
    expect(await reorderNavItems(pool, ACTOR, await listToken(), [...before].reverse())).toEqual({ ok: true, data: null });
    const reordered = (await audit()).at(-1);
    expect(await restoreNavItemOrder(pool, OTHER, { auditId: reordered.id, side: 'before', token: await listToken() })).toEqual({ ok: true, data: null });
    expect((await listNavAdmin(pool)).items.map((n) => n.id)).toEqual(before);

    const stories = await item('stories');
    expect(await deleteNavItem(pool, ACTOR, stories.id, stories.token)).toEqual({ ok: true, data: { meta: null } });
    expect(await menu()).not.toContain('stories:Stories');
    const [gone] = await listDeleted(pool, NAV_ITEM);
    // Someone gives the section a new item meanwhile: the old one cannot come back beside it (one per section).
    const created = await createNavItem(pool, ACTOR, { id: null, targetSection: 'stories', isPublished: true, label: { en: 'Journal' } });
    expect(created.ok).toBe(true);
    // A restore cannot pick another section, so its refusal says what to do instead (not the form's "chọn section khác").
    expect(await restoreNavItem(pool, OTHER, { id: gone.id, auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { targetSection: [NAV_RESTORE_TARGET_TAKEN] },
    });
    expect(NAV_RESTORE_TARGET_TAKEN).not.toMatch(/chọn section khác/);
    expect(await deleteNavItem(pool, ACTOR, (await item('stories')).id, (await item('stories')).token)).toMatchObject({ ok: true });
    expect(await restoreNavItem(pool, OTHER, { id: gone.id, auditId: gone.auditId, side: 'before', token: 'deleted' })).toEqual({ ok: true, data: null });
    expect((await listNavAdmin(pool)).items.map((n) => n.id)).toEqual(before);
    expect(await menu()).toContain('stories:Stories');
  });
});
