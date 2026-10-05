import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { listRestaurantOptions } from '@/lib/server/booking/queries';
import { loadBookingRules } from '@/lib/server/booking/rules';
import {
  createDestination,
  deleteDestination,
  DESTINATION,
  listDestinationOptions,
  listDestinationsAdmin,
  ONE_TEASER,
  reorderDestinations,
  restoreDestination,
  restoreDestinationOrder,
  setDestinationPublished,
  updateDestination,
  VENUE_NEEDS_NAME,
  type DestinationInput,
} from '@/lib/server/content-admin/destinations';
import { listDeleted } from '@/lib/server/content-admin/history';
import { ID_TAKEN, MEDIA_GONE } from '@/lib/server/content-admin/list-editor';
import { listRestaurantsAdmin } from '@/lib/server/content-admin/restaurants';
import { readItems, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadOffers } from '@/lib/server/content/home.queries';
import { loadDetailSlugs, loadRestaurantDetail, loadRestaurants } from '@/lib/server/content/restaurants.queries';
import { loadDestinations } from '@/lib/server/content/site.queries';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { restaurantsWithoutRecipient } from '@/lib/server/email/recipients';

/*
 * The destinations editor (spec §7.2 content/destinations, §6.5 "2–5, tối đa
 * 1 thẻ teaser", §7.4, §7.5) against the database, and what hiding a
 * destination means for guests (phase-6 ledger D1, L7-2): its restaurants
 * leave the catalogue, their pages, the offers and online booking, while
 * staff paths still see them. The guest loaders are read after each step.
 */

/** A save's answer: the token of the version it wrote (Saved, lib/admin/save-state.ts). */
const SAVED = { ok: true, data: { token: expect.any(String) } };
const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
const OTHER: AuditActor = { id: 'staff-minh', email: 'minh@furama.test', name: 'Minh' };
const RESORT_RESTAURANTS = ['cafe-indochine', 'don-ciprianis', 'taya-house', 'danaksara', 'v-senses-cafe', 'hai-van-lounge'];

let seed: ItemSnapshot[] = [];

const audit = async () => (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, before, after FROM audit_log a ORDER BY a.id')).rows;
const item = async (id: string) => (await listDestinationsAdmin(pool)).items.find((d) => d.id === id)!;
const listToken = async () => (await listDestinationsAdmin(pool)).token;
const shownIds = async () => (await loadDestinations('en')).map((d) => d.id);

/** A destination's form values: a venue named in EN, hidden, with nothing else. */
function venue(id: string, patch: Partial<DestinationInput> = {}): DestinationInput {
  return {
    id,
    kind: 'venue',
    isPublished: false,
    showInFooter: false,
    cardImageId: null,
    phoneDisplay: null,
    phoneE164: null,
    email: null,
    mapUrl: null,
    name: { en: `Test ${id}` },
    cardTitle1: { en: null },
    cardTitle2: { en: null },
    cardBlurb1: { en: null },
    cardBlurb2: { en: null },
    address: { en: null },
    ...patch,
  };
}

/** Puts every destination back as migration 008 seeded it, and removes this test's own rows. */
async function resetDestinations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM closures WHERE destination_id LIKE 'test-b1-%'`);
    await client.query(`DELETE FROM notification_recipients WHERE destination_id LIKE 'test-b1-%'`);
    await client.query(`DELETE FROM destinations WHERE id LIKE 'test-b1-%'`);
    for (const s of seed) await writeItem(client, DESTINATION, s, 'seed', { order: true });
    await client.query(`DELETE FROM media WHERE pathname LIKE '/assets/test-b1-%'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('destinations editor (database)', () => {
  beforeAll(async () => {
    seed = await readItems(pool, DESTINATION);
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetDestinations());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('a card’s words reach the guest at once; History brings the old ones back; a page older than another save is a conflict', async () => {
    const mm = await item('mm');
    expect(mm).toMatchObject({ name: 'Furama MM Supercenter', kind: 'venue', isPublished: true, shownRestaurants: 2 });
    const edited = { ...mm.values, cardTitle1: { en: 'Furama MM' }, cardTitle2: { en: 'Food Court' }, address: { en: '1 Test Street' } };
    expect(await updateDestination(pool, ACTOR, 'mm', mm.token, edited)).toEqual(SAVED);
    expect((await loadDestinations('en')).find((d) => d.id === 'mm')).toMatchObject({ cardTitle: ['Furama MM', 'Food Court'], address: '1 Test Street' });

    const [saved] = await audit();
    expect(saved).toMatchObject({ actor_id: ACTOR.id, action: 'update', entity_type: 'destinations', entity_id: 'mm' });
    expect(saved.before.i18n).toEqual([expect.objectContaining({ locale: 'en', card_title_2: 'Supercenter', address: null })]);
    expect(saved.after.i18n).toEqual([expect.objectContaining({ locale: 'en', card_title_2: 'Food Court', status: 'reviewed', origin: 'human' })]);

    // The page loaded before that save: a conflict naming who saved first, and nothing written.
    expect(await updateDestination(pool, OTHER, 'mm', mm.token, mm.values)).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Lan' } });
    expect(await audit()).toHaveLength(1);

    expect(await restoreDestination(pool, OTHER, { id: 'mm', auditId: saved.id, side: 'before', token: (await item('mm')).token })).toEqual({ ok: true, data: null });
    expect((await loadDestinations('en')).find((d) => d.id === 'mm')).toMatchObject({ cardTitle: ['Furama MM', 'Supercenter'], address: null });
    expect((await audit()).at(-1)).toMatchObject({ action: 'restore', entity_id: 'mm', after: { meta: { restored_from: saved.id } } });
  });

  it('a venue needs its EN name (L7-7); a teaser may have none, and only one teaser shows; at most five show (spec §6.5)', async () => {
    const resort = await item('resort');
    expect(await updateDestination(pool, ACTOR, 'resort', resort.token, { ...resort.values, name: { en: null } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { name: [VENUE_NEEDS_NAME] },
    });
    // A second teaser, shown: refused on create and on the list's switch.
    const teaser = venue('test-b1-soon', { kind: 'teaser', name: { en: null }, cardTitle1: { en: 'Soon' }, isPublished: true });
    expect(await createDestination(pool, ACTOR, teaser)).toEqual({ ok: false, code: 'invalid', fieldErrors: { isPublished: [ONE_TEASER] } });
    expect(await createDestination(pool, ACTOR, { ...teaser, isPublished: false })).toEqual({ ok: true, data: { id: 'test-b1-soon' } });
    expect(await setDestinationPublished(pool, ACTOR, 'test-b1-soon', (await item('test-b1-soon')).token, true)).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { isPublished: [ONE_TEASER] },
    });
    // Four shown: a fifth may show, a sixth may not.
    expect(await createDestination(pool, ACTOR, venue('test-b1-five', { isPublished: true }))).toEqual({ ok: true, data: { id: 'test-b1-five' } });
    expect(await createDestination(pool, ACTOR, venue('test-b1-six', { isPublished: true }))).toEqual({ ok: false, code: 'limit', params: { max: '5' } });
    expect(await shownIds()).toEqual(['resort', 'dining-house', 'mm', 'future', 'test-b1-five']);
  });

  it('a new destination takes its slug once; deleted, it comes back under that id in its place; the order and its History', async () => {
    expect(await createDestination(pool, ACTOR, venue('test-b1-hoian', { phoneDisplay: '0236 3000 000', phoneE164: '+842363000000' }))).toEqual({
      ok: true,
      data: { id: 'test-b1-hoian' },
    });
    expect(await createDestination(pool, OTHER, venue('test-b1-hoian'))).toEqual({ ok: false, code: 'invalid', fieldErrors: { id: [ID_TAKEN] } });
    expect((await item('test-b1-hoian')).values).toMatchObject({ phoneDisplay: '0236 3000 000', phoneE164: '+842363000000' });

    const before = (await listDestinationsAdmin(pool)).items.map((d) => d.id);
    expect(before).toEqual(['resort', 'dining-house', 'mm', 'future', 'test-b1-hoian']);
    expect(await reorderDestinations(pool, ACTOR, await listToken(), ['test-b1-hoian', ...before.slice(0, 4)])).toEqual({ ok: true, data: null });
    const reordered = (await audit()).at(-1);
    expect(reordered).toMatchObject({ action: 'reorder', entity_type: 'destinations', entity_id: null });

    expect(await deleteDestination(pool, ACTOR, 'test-b1-hoian', (await item('test-b1-hoian')).token)).toEqual({ ok: true, data: { meta: null } });
    const deleted = await listDeleted(pool, DESTINATION);
    expect(deleted.map((d) => d.id)).toEqual(['test-b1-hoian']);
    expect(await restoreDestination(pool, OTHER, { id: 'test-b1-hoian', auditId: deleted[0].auditId, side: 'before', token: 'deleted' })).toEqual({
      ok: true,
      data: null,
    });
    expect((await listDestinationsAdmin(pool)).items.map((d) => d.id)).toEqual(['test-b1-hoian', ...before.slice(0, 4)]);
    expect((await item('test-b1-hoian')).values.name).toEqual({ en: 'Test test-b1-hoian' });

    expect(await restoreDestinationOrder(pool, OTHER, { auditId: reordered.id, side: 'before', token: await listToken() })).toEqual({
      ok: true,
      data: null,
    });
    expect((await listDestinationsAdmin(pool)).items.map((d) => d.id)).toEqual(before);
  });

  it('a destination with restaurants, closures or recipients cannot be deleted (they would go with it); nothing is written', async () => {
    const mm = await item('mm');
    const refused = await deleteDestination(pool, ACTOR, 'mm', mm.token);
    expect(refused).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { _: [expect.stringMatching(/còn 2 nhà hàng/)] } });

    await createDestination(pool, ACTOR, venue('test-b1-closed'));
    await pool.query(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'test-b1-closed', '2026-12-24', '2026-12-25')`);
    await pool.query(`INSERT INTO notification_recipients (scope, destination_id, email) VALUES ('destination', 'test-b1-closed', 'desk@furama.test')`);
    expect(await deleteDestination(pool, ACTOR, 'test-b1-closed', (await item('test-b1-closed')).token)).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { _: [expect.stringMatching(/ngày đóng cửa hoặc người nhận thông báo/)] },
    });
    expect((await pool.query(`SELECT count(*)::int AS n FROM closures WHERE destination_id = 'test-b1-closed'`)).rows[0].n).toBe(1);
    expect((await audit()).map((a) => a.action)).toEqual(['create']);
  });

  it('a destination that restaurants, closures or recipients point at cannot become a teaser, hidden or not, on a save or a restore; nothing is written', async () => {
    // Hidden, so the one-shown-teaser rule does not answer first; the pickers (venues only) must keep listing it.
    expect(await setDestinationPublished(pool, ACTOR, 'mm', (await item('mm')).token, false)).toEqual({ ok: true, data: null });
    const mm = await item('mm');
    const asTeaser = await updateDestination(pool, ACTOR, 'mm', mm.token, { ...mm.values, kind: 'teaser' });
    expect(asTeaser).toEqual({ ok: false, code: 'invalid', fieldErrors: { kind: [expect.stringMatching(/còn 2 nhà hàng trỏ tới điểm đến này/)] } });
    expect((await listDestinationOptions(pool)).map((d) => d.id)).toContain('mm');

    // A teaser version from History (forged: no save could write one) is refused the same way.
    const teaserSnapshot = (await readItems(pool, DESTINATION)).find((s) => s.row.id === 'mm')!;
    teaserSnapshot.row.kind = 'teaser';
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after) VALUES ($1, 'update', 'destinations', 'mm', $2, $2) RETURNING id::text`,
      [ACTOR.id, JSON.stringify(teaserSnapshot)],
    );
    const written = (await audit()).length;
    expect(await restoreDestination(pool, OTHER, { id: 'mm', auditId: rows[0].id, side: 'before', token: mm.token })).toEqual(asTeaser);
    expect(await audit()).toHaveLength(written);
    expect((await item('mm')).kind).toBe('venue');

    // Closures alone are enough (recipients too): the closures and recipients pickers list venues only.
    await createDestination(pool, ACTOR, venue('test-b1-closed'));
    await pool.query(`INSERT INTO closures (scope, destination_id, starts_on, ends_on) VALUES ('destination', 'test-b1-closed', '2026-12-24', '2026-12-25')`);
    const closed = await item('test-b1-closed');
    expect(await updateDestination(pool, ACTOR, 'test-b1-closed', closed.token, { ...closed.values, kind: 'teaser' })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { kind: [expect.stringMatching(/còn 1 ngày đóng cửa trỏ tới điểm đến này/)] },
    });
    expect((await item('test-b1-closed')).kind).toBe('venue');
  });

  it('a destination its restaurants moved away from can be deleted: the phase-1 destination column that still names it is cleared', async () => {
    expect(await createDestination(pool, ACTOR, venue('test-b1-probe'))).toEqual({ ok: true, data: { id: 'test-b1-probe' } });
    // As migrations 004 and 008 seeded every restaurant: both columns name the destination.
    await pool.query(
      `INSERT INTO restaurants (id, name, slug, destination, destination_id, is_published, has_detail_page, booking_enabled)
       VALUES ('test-b1-probe-r', 'Probe', 'test-b1-probe-r', 'test-b1-probe', 'test-b1-probe', false, false, false)`,
    );
    try {
      // The restaurant editor moves it by destination_id alone.
      await pool.query(`UPDATE restaurants SET destination_id = 'resort' WHERE id = 'test-b1-probe-r'`);
      expect(await deleteDestination(pool, ACTOR, 'test-b1-probe', (await item('test-b1-probe')).token)).toEqual({ ok: true, data: { meta: null } });
      expect((await pool.query(`SELECT destination, destination_id FROM restaurants WHERE id = 'test-b1-probe-r'`)).rows[0]).toEqual({
        destination: null,
        destination_id: 'resort',
      });
    } finally {
      await pool.query(`DELETE FROM restaurants WHERE id = 'test-b1-probe-r'`);
    }
  });

  it('the card’s picture must be live (code rule 2)', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes, deleted_at)
       VALUES ('static', '/assets/test-b1-gone.jpg', '/assets/test-b1-gone.jpg', 'image/jpeg', 40, 30, 1000, now()) RETURNING id`,
    );
    const mm = await item('mm');
    expect(await updateDestination(pool, ACTOR, 'mm', mm.token, { ...mm.values, cardImageId: rows[0].id })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { cardImageId: [MEDIA_GONE] },
    });
  });

  describe('a hidden destination hides its restaurants everywhere a guest reaches them (phase-6 ledger D1, L7-2)', () => {
    it('the catalogue, the restaurant pages and their slugs, the offers and online booking; staff still see them; showing it brings them back', async () => {
      expect((await item('resort')).shownRestaurants).toBe(6);
      expect(await loadDetailSlugs()).toEqual(['taya-house']);
      expect((await loadOffers('en')).map((o) => o.restaurantId)).toEqual(['cafe-indochine', 'taya-house', 'hai-van-lounge']);

      expect(await setDestinationPublished(pool, ACTOR, 'resort', (await item('resort')).token, false)).toEqual({ ok: true, data: null });
      expect(await shownIds()).toEqual(['dining-house', 'mm', 'future']);
      const catalogue = (await loadRestaurants('en')).map((r) => r.id);
      for (const id of RESORT_RESTAURANTS) expect(catalogue).not.toContain(id);
      expect(catalogue).toHaveLength(6);
      expect(await loadDetailSlugs()).toEqual([]);
      expect(await loadRestaurantDetail('taya-house', 'en')).toBeNull();
      expect(await loadOffers('en')).toEqual([]);
      const rules = await loadBookingRules(pool, ['taya-house', 'the-fan'], 'en', '2026-10-01');
      expect([...rules].map(([id, r]) => [id, r.rules.bookingEnabled])).toEqual([
        ['taya-house', false],
        ['the-fan', true],
      ]);
      // No "no recipient" alarm for restaurants guests cannot book (L7-4's predicate).
      for (const r of await restaurantsWithoutRecipient(pool)) expect(RESORT_RESTAURANTS).not.toContain(r.id);
      // Staff paths still see them; the restaurants list says why they take no online booking.
      expect((await listRestaurantOptions(pool)).map((r) => r.id)).toEqual(expect.arrayContaining(RESORT_RESTAURANTS));
      const listed = (await listRestaurantsAdmin(pool)).items;
      expect(listed.filter((r) => !r.destinationShown).map((r) => r.id)).toEqual(expect.arrayContaining(RESORT_RESTAURANTS));
      expect(listed.filter((r) => !r.destinationShown)).toHaveLength(RESORT_RESTAURANTS.length);
      expect((await listDestinationOptions(pool)).map((d) => d.id)).toEqual(['resort', 'dining-house', 'mm']);

      const [hidden] = await audit();
      expect(await restoreDestination(pool, OTHER, { id: 'resort', auditId: hidden.id, side: 'before', token: (await item('resort')).token })).toEqual({
        ok: true,
        data: null,
      });
      expect(await loadDetailSlugs()).toEqual(['taya-house']);
      expect((await loadRestaurantDetail('taya-house', 'en'))?.name).toBe('Tàya House');
      expect((await loadOffers('en')).map((o) => o.id)).toEqual([1, 2, 3]);
      expect((await loadRestaurants('en')).map((r) => r.id)).toEqual(expect.arrayContaining(RESORT_RESTAURANTS));
      expect((await loadBookingRules(pool, ['taya-house'], 'en', '2026-10-01')).get('taya-house')?.rules.bookingEnabled).toBe(true);
    });

    it('its number is never another restaurant’s larger-group phone, on the drawer or in the emails; its own restaurants keep it', async () => {
      // ChaoShan Hotpot and its destination (MM) have no number: the first destination with one answers, the resort.
      const RESORT = { display: '+84 236 651 9999', tel: '+842366519999' };
      const DINING_HOUSE = { display: '0859 555 759', tel: '+84859555759' };
      const phones = async () => {
        const rules = await loadBookingRules(pool, ['chaoshan-hotpot', 'taya-house'], 'en', '2026-10-01');
        return { chaoshan: rules.get('chaoshan-hotpot')?.groupPhone, taya: rules.get('taya-house')?.groupPhone };
      };
      const { rows } = await pool.query<{ id: string; restaurant_id: string }>(
        `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
         VALUES ('FC-B1PHONE1', 'chaoshan-hotpot', '2026-10-20', '19:00', 'Dinner', 12, 'B1 Test', '0905000001', '+84905000001', 'web', 'requested'),
                ('FC-B1PHONE2', 'taya-house', '2026-10-20', '19:00', 'Dinner', 12, 'B1 Test', '0905000002', '+84905000002', 'staff', 'confirmed')
         RETURNING id::text, restaurant_id`,
      );
      const emailPhone = async (restaurant: string) => (await loadBookingEmailData(pool, rows.find((r) => r.restaurant_id === restaurant)!.id))!.groupPhone;
      try {
        expect(await phones()).toEqual({ chaoshan: RESORT, taya: RESORT });
        expect(await emailPhone('chaoshan-hotpot')).toEqual(RESORT);

        expect(await setDestinationPublished(pool, ACTOR, 'resort', (await item('resort')).token, false)).toEqual({ ok: true, data: null });
        // The next shown destination with a number; the hidden resort's restaurants still print their own destination's.
        expect(await phones()).toEqual({ chaoshan: DINING_HOUSE, taya: RESORT });
        expect(await emailPhone('chaoshan-hotpot')).toEqual(DINING_HOUSE);
        expect(await emailPhone('taya-house')).toEqual(RESORT);
      } finally {
        await pool.query(`DELETE FROM reservations WHERE reference LIKE 'FC-B1PHONE%'`);
      }
    });
  });
});
