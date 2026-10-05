import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { loadRestaurantRules } from '@/lib/server/booking/rules';
import {
  createRestaurant,
  getRestaurantEditor,
  listRestaurantsAdmin,
  readRestaurant,
  reorderRestaurants,
  RESTAURANT,
  restoreRestaurant,
  restoreRestaurantOrder,
  saveRestaurantContent,
  setRestaurantArchived,
  setRestaurantShown,
  type RestaurantSnapshot,
} from '@/lib/server/content-admin/restaurants';
import { writeItem } from '@/lib/server/content-admin/snapshot';
import { loadOffers } from '@/lib/server/content/home.queries';
import { loadDetailSlugs, loadRestaurantDetail, loadRestaurants } from '@/lib/server/content/restaurants.queries';
import { restaurantsWithoutRecipient } from '@/lib/server/email/recipients';

/*
 * The restaurants list (spec §7.2 /admin/restaurants) against the database:
 * "Thêm nhà hàng" (R22) makes a hidden draft whose id is its slug; showing it
 * needs its card picture and type; archiving (never deleting, F10) takes it
 * off the catalogue, its page, its offers and online booking, and History
 * brings it back; the catalogue's order with its History. L7-4: a restaurant
 * guests cannot book raises no "no recipient" alarm.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-quan', email: 'quan@furama.test', name: 'Quân' };
const TODAY = '2026-10-05';

let seedTaya: RestaurantSnapshot;
let seedOrder: { id: string; sort_order: number }[] = [];

const ids = async () => (await loadRestaurants('en')).map((r) => r.id);
const token = async (id: string) => (await getRestaurantEditor(pool, id))!.token;
const listToken = async () => (await listRestaurantsAdmin(pool)).token;
const audit = async () =>
  (await pool.query('SELECT a.id::text AS id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;

async function resetRestaurants() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM restaurants WHERE id LIKE 'test-a11-%'`);
    await writeItem(client, RESTAURANT, { v: 1, row: seedTaya.row, i18n: seedTaya.i18n }, 'seed');
    for (const r of seedOrder) await client.query('UPDATE restaurants SET sort_order = $2, is_published = true, archived_at = NULL WHERE id = $1', [r.id, r.sort_order]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurants list (database)', () => {
  beforeAll(async () => {
    seedTaya = (await readRestaurant(pool, 'taya-house'))!;
    seedOrder = (await pool.query<{ id: string; sort_order: number }>('SELECT id, sort_order FROM restaurants ORDER BY sort_order, id')).rows;
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
      ACTOR.id,
      ACTOR.name,
      ACTOR.email,
    ]);
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetRestaurants());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = $1`, [ACTOR.id]);
    await pool.end();
  });

  it('R22: "Thêm nhà hàng" makes a hidden draft whose id is its slug, online booking off; a slug in use is refused', async () => {
    expect(await createRestaurant(pool, ACTOR, { name: 'Sen Garden', slug: 'test-a11-sen', destinationId: 'resort' })).toEqual({ ok: true, data: { id: 'test-a11-sen' } });
    const draft = (await readRestaurant(pool, 'test-a11-sen'))!;
    expect(draft.row).toMatchObject({ id: 'test-a11-sen', slug: 'test-a11-sen', name: 'Sen Garden', is_published: false, has_detail_page: false, card_image_id: null });
    expect(draft).toMatchObject({ i18n: [], cuisines: [], highlights: [] });
    expect((await pool.query(`SELECT booking_enabled FROM restaurants WHERE id = 'test-a11-sen'`)).rows[0].booking_enabled).toBe(false);
    expect((await pool.query(`SELECT count(*)::int AS n FROM service_periods WHERE restaurant_id = 'test-a11-sen'`)).rows[0].n).toBe(0);
    expect(await ids()).not.toContain('test-a11-sen');
    // Last in the list, and in History as created.
    expect((await listRestaurantsAdmin(pool)).items.at(-1)).toMatchObject({ id: 'test-a11-sen', isPublished: false, archived: false, card: null });
    expect(await audit()).toEqual([expect.objectContaining({ action: 'create', entity_type: 'restaurants', entity_id: 'test-a11-sen', before: null })]);

    for (const slug of ['test-a11-sen', 'taya-house']) {
      expect(await createRestaurant(pool, ACTOR, { name: 'Again', slug, destinationId: 'resort' })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { slug: [expect.any(String)] } });
    }
    expect(await createRestaurant(pool, ACTOR, { name: 'Nowhere', slug: 'test-a11-x', destinationId: 'atlantis' })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { destinationId: [expect.any(String)] },
    });
    // The teaser card is not a place (SEC-5): the select lists venues only, and a crafted post is refused the same way.
    expect(await createRestaurant(pool, ACTOR, { name: 'Soon', slug: 'test-a11-soon', destinationId: 'future' })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { destinationId: [expect.any(String)] },
    });
    expect(await audit()).toHaveLength(1);
  });

  it('showing a restaurant needs its card picture and an EN type; then it is in the catalogue, and hiding takes it out', async () => {
    await createRestaurant(pool, ACTOR, { name: 'Sen Garden', slug: 'test-a11-sen', destinationId: 'resort' });
    expect(await setRestaurantShown(pool, ACTOR, { id: 'test-a11-sen', token: await token('test-a11-sen'), shown: true })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { cardImageId: [expect.any(String)], typeLabel: [expect.any(String)] },
    });
    const card = String(seedTaya.row.card_image_id);
    const draft = (await getRestaurantEditor(pool, 'test-a11-sen'))!;
    expect(await saveRestaurantContent(pool, ACTOR, 'test-a11-sen', draft.token, { ...draft.values, cardImageId: card, typeLabel: { en: 'Garden Dining' } })).toMatchObject({
      ok: true,
      data: { visibilityChanged: false },
    });
    expect(await setRestaurantShown(pool, ACTOR, { id: 'test-a11-sen', token: await token('test-a11-sen'), shown: true })).toEqual({
      ok: true,
      data: { altChanged: false, visibilityChanged: true },
    });
    expect((await loadRestaurants('en')).find((r) => r.id === 'test-a11-sen')).toMatchObject({ name: 'Sen Garden', type: 'Garden Dining', bookingEnabled: false });
    expect(await setRestaurantShown(pool, ACTOR, { id: 'test-a11-sen', token: await token('test-a11-sen'), shown: false })).toMatchObject({ ok: true });
    expect(await ids()).not.toContain('test-a11-sen');
  });

  it('archived, a restaurant leaves the catalogue, its page, its offers and online booking; History brings it back (F10: never deleted)', async () => {
    const offersOf = async () => (await loadOffers('en')).filter((o) => o.restaurantId === 'taya-house').length;
    const bookable = async () => (await loadRestaurantRules(pool, 'taya-house', 'en', TODAY))!.rules.bookingEnabled;
    const offers = await offersOf();
    expect(offers).toBeGreaterThan(0);
    expect(await bookable()).toBe(true);

    expect(await setRestaurantArchived(pool, ACTOR, { id: 'taya-house', token: await token('taya-house'), archived: true })).toEqual({
      ok: true,
      data: { altChanged: false, visibilityChanged: true },
    });
    expect(await ids()).not.toContain('taya-house');
    expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
    expect(await loadDetailSlugs()).toEqual([]);
    expect(await offersOf()).toBe(0);
    expect(await bookable()).toBe(false);
    expect((await listRestaurantsAdmin(pool)).items.find((r) => r.id === 'taya-house')).toMatchObject({ archived: true, isPublished: true });

    const [archived] = await audit();
    expect(archived).toMatchObject({ action: 'update', entity_type: 'restaurants', entity_id: 'taya-house', before: { row: { archived_at: null } } });
    expect(archived.after.row.archived_at).not.toBeNull();
    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: archived.id, side: 'before', token: await token('taya-house') })).toMatchObject({
      ok: true,
      data: { visibilityChanged: true },
    });
    expect(await ids()).toContain('taya-house');
    expect(await loadDetailSlugs()).toEqual(['taya-house']);
    expect(await offersOf()).toBe(offers);
    expect(await bookable()).toBe(true);
  });

  it('the catalogue’s order: the whole old order is kept, a stale list is a conflict, and History puts it back', async () => {
    const before = await ids();
    const all = (await listRestaurantsAdmin(pool)).items.map((r) => r.id);
    const swapped = [all[1], all[0], ...all.slice(2)];
    const seen = await listToken();
    expect(await reorderRestaurants(pool, ACTOR, seen, swapped)).toEqual({ ok: true, data: null });
    expect(await ids()).toEqual([before[1], before[0], ...before.slice(2)]);
    expect(await reorderRestaurants(pool, ACTOR, seen, all)).toMatchObject({ ok: false, code: 'conflict' });
    const [row] = await audit();
    expect(row).toMatchObject({ action: 'reorder', entity_type: 'restaurants', entity_id: null });
    expect(await restoreRestaurantOrder(pool, ACTOR, { auditId: row.id, side: 'before', token: await listToken() })).toEqual({ ok: true, data: null });
    expect(await ids()).toEqual(before);
  });

  it('L7-4: a restaurant guests cannot book (hidden or archived) raises no "no recipient" alarm', async () => {
    const missing = async () => (await restaurantsWithoutRecipient(pool)).map((r) => r.id);
    expect(await missing()).toContain('pho-cuon');
    await pool.query(`UPDATE restaurants SET is_published = false WHERE id = 'pho-cuon'`);
    expect(await missing()).not.toContain('pho-cuon');
    await pool.query(`UPDATE restaurants SET is_published = true, archived_at = now() WHERE id = 'pho-cuon'`);
    expect(await missing()).not.toContain('pho-cuon');
  });
});
