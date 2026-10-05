import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import type { AuditActor } from '@/lib/server/audit';
import { getRestaurantBooking, saveRestaurantRules } from '@/lib/server/booking/config';
import { MEDIA_GONE } from '@/lib/server/content-admin/list-editor';
import {
  getRestaurantEditor,
  HIGHLIGHT,
  readRestaurant,
  RESTAURANT,
  restoreRestaurant,
  saveRestaurantContent,
  type RestaurantInput,
  type RestaurantSnapshot,
} from '@/lib/server/content-admin/restaurants';
import { readItem, writeItem, type ItemSnapshot } from '@/lib/server/content-admin/snapshot';
import { loadRestaurantDetail, loadRestaurants } from '@/lib/server/content/restaurants.queries';
import { loadBookingEmailData } from '@/lib/server/email/booking/load';
import { getMedia, MEDIA, saveMediaDetails } from '@/lib/server/media/library';

/*
 * The restaurant's content editor (spec §7.2 /admin/restaurants/[id]) against
 * the database: the row, restaurant_i18n, cuisines and highlights saved and
 * restored as one aggregate (spec §7.4, §7.5); the guest's card and page
 * follow at once. R19 carries the card's alt along with a rename, as the
 * file's own History row (C6). Every file the aggregate points at is live
 * (code rule 2), the menu PDF and the highlights' pictures included, and a
 * restore takes a trashed one out of the trash (C7). The token is the
 * content's hash (R2): a booking-rules save is no conflict. L7-5: the
 * restaurant's own number reaches its booking emails.
 */

const pool = getPool();
const ACTOR: AuditActor = { id: 'staff-hoa', email: 'hoa@furama.test', name: 'Hoa' };
const OTHER: AuditActor = { id: 'staff-vy', email: 'vy@furama.test', name: 'Vy' };

let seedTaya: RestaurantSnapshot;
let seedCard: ItemSnapshot;

const tayaToken = async () => (await getRestaurantEditor(pool, 'taya-house'))!.token;
const tayaInput = async (over: Partial<RestaurantInput> = {}): Promise<RestaurantInput> => ({ ...(await getRestaurantEditor(pool, 'taya-house'))!.values, ...over });
const audit = async () =>
  (await pool.query('SELECT a.id::text AS id, actor_id, action, entity_type, entity_id, locale, before, after FROM audit_log a ORDER BY a.id')).rows;

/** A library file of this test's own, unused by anything. */
async function testFile(name: string, kind: 'image' | 'pdf' = 'image'): Promise<string> {
  const pdf = kind === 'pdf';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO media (storage, url, pathname, content_type, width, height, bytes) VALUES ('static', $1, $1, $2, $3, $3, 1000) RETURNING id`,
    [`/assets/test-a10-${name}.${pdf ? 'pdf' : 'jpg'}`, pdf ? 'application/pdf' : 'image/jpeg', pdf ? null : 40],
  );
  return rows[0].id;
}

/** Puts Tàya House, its cuisines, highlights and card file back as migration 008 seeded them. */
async function resetTaya() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM reservations WHERE guest_name = 'A10 Test'`);
    await writeItem(client, RESTAURANT, { v: 1, row: seedTaya.row, i18n: seedTaya.i18n }, 'seed');
    await client.query(`DELETE FROM restaurant_cuisines WHERE restaurant_id = 'taya-house'`);
    for (const c of seedTaya.cuisines) {
      await client.query(`INSERT INTO restaurant_cuisines (restaurant_id, cuisine_id, sort_order) VALUES ('taya-house', $1, $2)`, [c.cuisine_id, c.sort_order]);
    }
    await client.query(`DELETE FROM restaurant_highlights WHERE restaurant_id = 'taya-house'`);
    for (const h of seedTaya.highlights) await writeItem(client, HIGHLIGHT, h, 'seed');
    await writeItem(client, MEDIA, seedCard, 'seed');
    await client.query(`UPDATE restaurants SET window_days = NULL WHERE id = 'taya-house'`);
    await client.query(`DELETE FROM media WHERE pathname LIKE '/assets/test-a10-%'`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant content editor (database)', () => {
  beforeAll(async () => {
    seedTaya = (await readRestaurant(pool, 'taya-house'))!;
    seedCard = (await readItem(pool, MEDIA, String(seedTaya.row.card_image_id)))!;
    for (const a of [ACTOR, OTHER]) {
      await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ($1, $2, $3, true, 'editor') ON CONFLICT (id) DO NOTHING`, [
        a.id,
        a.name,
        a.email,
      ]);
    }
  });
  beforeEach(() => pool.query('TRUNCATE audit_log'));
  afterEach(() => resetTaya());
  afterAll(async () => {
    await pool.query('TRUNCATE audit_log');
    await pool.query(`DELETE FROM staff_user WHERE id = ANY($1::text[])`, [[ACTOR.id, OTHER.id]]);
    await pool.end();
  });

  it('a rename shows on the card at once; R19 carries the card alt along, as the file’s own History row; a restore puts both back', async () => {
    const input = await tayaInput({ name: 'Tàya Garden House', typeLabel: { en: 'Garden Dining' } });
    const renamed = await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), input);
    expect(renamed).toEqual({ ok: true, data: { altChanged: true, visibilityChanged: false, token: await tayaToken() } });
    const card = (await loadRestaurants('en')).find((r) => r.id === 'taya-house')!;
    expect(card).toMatchObject({ name: 'Tàya Garden House', type: 'Garden Dining' });
    expect(card.image?.alt).toBe('Tàya Garden House');
    const rows = await audit();
    expect(rows.map((r) => [r.action, r.entity_type])).toEqual([
      ['update', 'media'],
      ['update', 'restaurants'],
    ]);
    // C6: the file's History holds the whole file, its alt rows with their review state (R3).
    expect(rows[0]).toMatchObject({ entity_id: seedTaya.row.card_image_id, before: { v: 1, i18n: [{ locale: 'en', alt: 'Tàya House', origin: 'seed' }] } });
    expect(rows[0].after.i18n).toEqual([expect.objectContaining({ locale: 'en', alt: 'Tàya Garden House', status: 'reviewed', origin: 'human' })]);
    expect(rows[1].before).toMatchObject({ row: { name: 'Tàya House' }, cuisines: seedTaya.cuisines });
    expect(rows[1].before.highlights).toHaveLength(4);

    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: rows[1].id, side: 'before', token: await tayaToken() })).toMatchObject({
      ok: true,
      data: { altChanged: true },
    });
    const back = (await loadRestaurants('en')).find((r) => r.id === 'taya-house')!;
    expect(back).toMatchObject({ name: 'Tàya House', type: seedTaya.i18n.find((r) => r.locale === 'en')!.type_label });
    expect(back.image?.alt).toBe('Tàya House');
  });

  it('a file screen open across a rename that rewrote its alt (R19) is a conflict naming who renamed, not the file’s last editor (7A review)', async () => {
    const card = String(seedTaya.row.card_image_id);
    await pool.query(`UPDATE media SET updated_by = $2 WHERE id = $1::uuid`, [card, OTHER.id]);
    const file = (await getMedia(pool, card))!;
    expect((await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), await tayaInput({ name: 'Tàya Garden House' }))).ok).toBe(true);
    expect(await saveMediaDetails(pool, OTHER, { id: card, token: file.token, alt: 'The house at night', decorative: false })).toMatchObject({
      ok: false,
      code: 'conflict',
      params: { by: 'Hoa' },
    });
  });

  it('R19 leaves an alt an editor wrote', async () => {
    await pool.query(`UPDATE media_i18n SET alt = 'A garden house among palms' WHERE media_id = $1::uuid AND locale = 'en'`, [seedTaya.row.card_image_id]);
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), await tayaInput({ name: 'Tàya' }))).toMatchObject({ data: { altChanged: false } });
    expect((await loadRestaurants('en')).find((r) => r.id === 'taya-house')!.image?.alt).toBe('A garden house among palms');
  });

  it('the rules: a page needs its portrait and EN story, a shown restaurant its card and type, at most 5 highlights shown, one menu, a unique slug; nothing is written', async () => {
    const save = async (over: Partial<RestaurantInput>) => saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), await tayaInput(over));
    expect(await save({ story: { en: null } })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { story: [expect.any(String)] } });
    expect(await save({ detailImageId: null })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { detailImageId: [expect.any(String)] } });
    expect(await save({ cardImageId: null, typeLabel: { en: null } })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { cardImageId: [expect.stringMatching(/ảnh thẻ/)], typeLabel: [expect.stringMatching(/loại nhà hàng/)] },
    });
    const pdf = await testFile('menu', 'pdf');
    expect(await save({ menuPdfMediaId: { en: pdf } })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { menuPdfUrl: [expect.stringMatching(/không cả hai/)] } });
    const base = await tayaInput();
    const extra = { ...base.highlights[0], id: null, title: { en: 'Extra' } };
    expect(await save({ highlights: [...base.highlights, extra, extra] })).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: { highlights: [expect.stringMatching(/Tối đa 5/)] },
    });
    expect(await save({ slug: 'cafe-indochine' })).toMatchObject({ ok: false, code: 'invalid', fieldErrors: { slug: [expect.any(String)] } });
    expect(await audit()).toEqual([]);
    // A hidden draft with its page off saves without a card picture, a type or a story (R22).
    expect(await save({ isPublished: false, hasDetailPage: false, cardImageId: null, typeLabel: { en: null }, story: { en: null } })).toMatchObject({
      ok: true,
      data: { visibilityChanged: true },
    });
    expect((await loadRestaurants('en')).map((r) => r.id)).not.toContain('taya-house');
  });

  it('a restaurant sits at a venue: a save or a restore that puts it at the teaser card is refused (SEC-5); nothing is written', async () => {
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), await tayaInput({ destinationId: 'future' }))).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { destinationId: [expect.stringMatching(/không phải thẻ teaser/)] },
    });
    // A version at the teaser (forged: no save could write one) cannot come back either.
    const atTeaser = { ...seedTaya, row: { ...seedTaya.row, destination_id: 'future' } };
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, before, after) VALUES ($1, 'update', 'restaurants', 'taya-house', $2, $2) RETURNING id::text`,
      [ACTOR.id, JSON.stringify(atTeaser)],
    );
    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: rows[0].id, side: 'before', token: await tayaToken() })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { destinationId: [expect.stringMatching(/không phải thẻ teaser/)] },
    });
    expect((await audit()).map((a) => a.id)).toEqual([rows[0].id]);
    expect((await readRestaurant(pool, 'taya-house'))!.row.destination_id).toBe('resort');
  });

  it('highlights: remove one, add one, reorder and hide; the page follows; a restore brings the removed one back under its id', async () => {
    const base = await tayaInput();
    const [a, b, c, d] = base.highlights;
    const added = { id: null, imageId: a.imageId, isPublished: true, title: { en: 'Sunset Tea' }, detail: { en: 'In the garden, 17:00' } };
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), { ...base, highlights: [c, added, a, { ...d, isPublished: false }] })).toMatchObject({
      ok: true,
    });
    const detail = (await loadRestaurantDetail('taya-house', 'en'))!;
    expect(detail.highlights.map((h) => h.title)).toEqual([c.title.en, 'Sunset Tea', a.title.en]);
    const [save] = await audit();

    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: save.id, side: 'before', token: await tayaToken() })).toMatchObject({ ok: true });
    const back = (await loadRestaurantDetail('taya-house', 'en'))!;
    expect(back.highlights.map((h) => h.title)).toEqual([a, b, c, d].map((h) => h.title.en));
    const ids = (await pool.query(`SELECT id::text FROM restaurant_highlights WHERE restaurant_id = 'taya-house' ORDER BY sort_order, id`)).rows.map((r) => r.id);
    expect(ids).toEqual([a, b, c, d].map((h) => h.id));
    expect((await pool.query(`SELECT count(*)::int AS n FROM restaurant_highlight_i18n WHERE highlight_id = $1::bigint`, [b.id])).rows[0].n).toBe(1);
  });

  it('every file it points at is live (code rule 2); a restore takes a trashed one out of the trash, the menu PDF and a highlight’s picture too (C7)', async () => {
    const pdf = await testFile('menu', 'pdf');
    const picture = await testFile('highlight');
    const base = await tayaInput();
    const withFiles = { ...base, menuPdfUrl: { en: null }, menuPdfMediaId: { en: pdf }, highlights: [{ ...base.highlights[0], imageId: picture }, ...base.highlights.slice(1)] };
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), withFiles)).toMatchObject({ ok: true });
    expect((await loadRestaurantDetail('taya-house', 'en'))!.menu).toEqual({ kind: 'pdf', url: '/assets/test-a10-menu.pdf' });
    const [saved] = await audit();
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), base)).toMatchObject({ ok: true });

    // Unused now: the library may trash them, and no save may point at them then.
    await pool.query('UPDATE media SET deleted_at = now() WHERE id = ANY($1::uuid[])', [[pdf, picture]]);
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), withFiles)).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { menuPdfMediaId: [MEDIA_GONE], highlights: [MEDIA_GONE] },
    });
    // A picture where a PDF belongs is no menu.
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), { ...base, menuPdfUrl: { en: null }, menuPdfMediaId: { en: base.cardImageId } })).toEqual({
      ok: false,
      code: 'invalid',
      fieldErrors: { menuPdfMediaId: [MEDIA_GONE] },
    });

    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: saved.id, side: 'after', token: await tayaToken() })).toMatchObject({ ok: true });
    expect((await pool.query('SELECT count(*)::int AS n FROM media WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL', [[pdf, picture]])).rows[0].n).toBe(2);
    expect((await loadRestaurantDetail('taya-house', 'en'))!.menu).toEqual({ kind: 'pdf', url: '/assets/test-a10-menu.pdf' });

    // Purged by the sweep: that version cannot come back.
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), base)).toMatchObject({ ok: true });
    await pool.query('DELETE FROM media WHERE id = $1', [pdf]);
    expect(await restoreRestaurant(pool, ACTOR, { id: 'taya-house', auditId: saved.id, side: 'after', token: await tayaToken() })).toEqual({
      ok: false,
      code: 'missing_reference',
    });
  });

  it('the token is the content: a booking-rules save in between is not a conflict, a content save is', async () => {
    const seen = await tayaToken();
    const rules = (await getRestaurantBooking(pool, 'taya-house'))!;
    expect(
      await saveRestaurantRules(pool, OTHER, { restaurantId: 'taya-house', token: rules.token, bookingEnabled: true, windowDays: 30, leadMinutes: null, maxParty: null }),
    ).toMatchObject({ ok: true });
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', seen, await tayaInput({ typeLabel: { en: 'Wellness Dining' } }))).toMatchObject({ ok: true });
    const stale = await tayaToken();
    await saveRestaurantContent(pool, OTHER, 'taya-house', stale, await tayaInput({ typeLabel: { en: 'Garden' } }));
    expect(await saveRestaurantContent(pool, ACTOR, 'taya-house', stale, await tayaInput())).toMatchObject({ ok: false, code: 'conflict', params: { by: 'Vy' } });
  });

  it('L7-5: the restaurant’s own number, saved here, is the one its booking emails give', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO reservations (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164, source, status)
       VALUES ('FC-A10TEST', 'taya-house', CURRENT_DATE + 3, '19:00', 'Dinner', 2, 'A10 Test', '0905000000', '+84905000000', 'web', 'requested') RETURNING id::text`,
    );
    // Until then, the resort's (its destination's) number.
    expect((await loadBookingEmailData(pool, rows[0].id))!.groupPhone).toMatchObject({ display: '+84 236 651 9999' });
    expect(
      await saveRestaurantContent(pool, ACTOR, 'taya-house', await tayaToken(), await tayaInput({ phoneDisplay: '0905 111 222', phoneE164: '+84905111222' })),
    ).toMatchObject({ ok: true });
    expect((await loadBookingEmailData(pool, rows[0].id))!.groupPhone).toEqual({ display: '0905 111 222', tel: '+84905111222' });
  });
});
