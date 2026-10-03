import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { fold } from '@/lib/booking';
import { loadRestaurants } from '@/lib/server/content/restaurants.queries';

/*
 * The guest catalogue (lib/server/content/restaurants.queries.ts), read from
 * migration 008's tables. Its type, destination and cuisines must equal what
 * the phase-1 columns said (they still hold the seed; phase 10 drops them),
 * which is what the site rendered before phase 6.
 */

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);
const list = (locale = 'en') => loadRestaurants(locale);

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterEach(async () => {
    await sql('UPDATE restaurants SET booking_enabled = true, is_published = true, archived_at = NULL, phone_e164 = NULL, phone_display = NULL');
    await sql(`UPDATE restaurants SET sort_order = 3 WHERE id = 'taya-house'`);
    await sql('UPDATE service_periods SET active = true');
    await sql(`DELETE FROM service_periods WHERE restaurant_id = 'hura-izakaya' AND meal = 'Breakfast'`);
    await sql(`DELETE FROM restaurant_i18n WHERE locale <> 'en'`);
    await sql(`DELETE FROM cuisine_i18n WHERE locale <> 'en'`);
    await sql(`UPDATE cuisines SET is_published = true`);
  });
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await list();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')).toMatchObject({ meals: ['Lunch', 'Dinner'], bookingEnabled: true });
  });

  it('says what the phase-1 columns said: type, destination and cuisines, in their order', async () => {
    const { rows } = await sql(
      `SELECT r.id, r.type, r.destination,
              ARRAY(SELECT ci.cuisine_id FROM unnest(r.cuisines) WITH ORDINALITY AS c(label, n)
                      JOIN cuisine_i18n ci ON ci.locale = 'en' AND ci.label = c.label ORDER BY c.n) AS cuisines
         FROM restaurants r ORDER BY r.sort_order, r.id`,
    );
    expect((await list()).map((r) => ({ id: r.id, type: r.type, destination: r.dest, cuisines: r.cuisines }))).toEqual(rows);
    const byId = Object.fromEntries((await list()).map((r) => [r.id, r.cuisines]));
    expect(byId['yum-food-village']).toEqual(['international', 'vietnamese', 'thai']);
  });

  it('gives each card its picture, with the restaurant’s name as alt (R19)', async () => {
    const restaurants = await list();
    for (const r of restaurants) expect(r.image).toMatchObject({ url: `/assets/r-${r.id}.jpg`, alt: r.name });
    expect(restaurants.find((r) => r.id === 'taya-house')?.image).toMatchObject({ width: 960, height: 720 });
  });

  it('reads slug and has_detail_page from the table: only Tàya House has a page', async () => {
    const restaurants = await list();
    expect(restaurants.every((r) => r.slug === r.id)).toBe(true);
    expect(restaurants.filter((r) => r.hasDetailPage).map((r) => r.id)).toEqual(['taya-house']);
  });

  it('carries the booking switch', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    const off = (await list()).filter((r) => !r.bookingEnabled).map((r) => r.id);
    expect(off).toEqual(['hai-van-lounge']);
  });

  it('gives the restaurant’s own number, else its destination’s; none at the MM Supercenter', async () => {
    await sql(`UPDATE restaurants SET phone_e164 = '+842363847333', phone_display = '0236 3847 333' WHERE id = 'the-fan'`);
    const phones = Object.fromEntries((await list()).map((r) => [r.id, r.phone]));
    expect(phones['the-fan']).toEqual({ tel: '+842363847333', display: '0236 3847 333' });
    expect(phones['pho-cuon']).toEqual({ tel: '+84859555759', display: '0859 555 759' });
    expect(phones['taya-house']).toEqual({ tel: '+842366519999', display: '+84 236 651 9999' });
    expect(phones['yum-food-village']).toBeNull();
  });

  it('leaves out unpublished and archived restaurants', async () => {
    await sql(`UPDATE restaurants SET is_published = false WHERE id = 'danaksara'`);
    await sql(`UPDATE restaurants SET archived_at = now() WHERE id = 'pho-cuon'`);
    const ids = (await list()).map((r) => r.id);
    expect(ids).toHaveLength(10);
    expect(ids).not.toContain('danaksara');
    expect(ids).not.toContain('pho-cuon');
  });

  it('breaks a sort_order tie by id, so the order is total (phase-4 ledger T3)', async () => {
    // cafe-indochine is 1; give Tàya House the same: the ids decide, and every read agrees.
    await sql(`UPDATE restaurants SET sort_order = 1 WHERE id = 'taya-house'`);
    const ids = (await list()).map((r) => r.id);
    expect(ids.slice(0, 2)).toEqual(['cafe-indochine', 'taya-house']);
  });

  it('derives meals from the active service periods, in the canonical meal order (spec §6.3)', async () => {
    // Seeded periods reproduce restaurants.meals exactly.
    const { rows } = await sql('SELECT id, meals FROM restaurants ORDER BY sort_order, id');
    expect((await list()).map((r) => [r.id, r.meals])).toEqual(rows.map((r) => [r.id, r.meals]));
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    await sql(
      `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, covers_per_slot, sort_order)
       VALUES ('hura-izakaya', 'Breakfast', '07:00', '09:00', 10, 50)`,
    );
    const meals = Object.fromEntries((await list()).map((r) => [r.id, r.meals]));
    expect(meals['taya-house']).toEqual(['Dinner']);
    expect(meals['hura-izakaya']).toEqual(['Breakfast', 'Dinner']);
  });

  describe('search text (spec §6.3 item 9)', () => {
    it('folds what the card says: name, type, cuisines and destination, as the search overlay matched before', async () => {
      const r = (await list()).find((x) => x.id === 'pho-cuon')!;
      expect(r.search).toBe(fold(`${r.name} ${r.type} Vietnamese Furama Dining House`));
      expect(r.search).toContain('pho cuon');
    });

    it('in another language, holds that language’s words and the default language’s', async () => {
      await sql(`INSERT INTO restaurant_i18n (restaurant_id, locale, type_label) VALUES ('pho-cuon', 'vi', 'Món cuốn · Tầng 1')`);
      await sql(`INSERT INTO cuisine_i18n (cuisine_id, locale, label) VALUES ('vietnamese', 'vi', 'Món Việt')`);
      const r = (await list('vi')).find((x) => x.id === 'pho-cuon')!;
      expect(r.type).toBe('Món cuốn · Tầng 1');
      expect(r.search).toContain(fold('Món cuốn'));
      expect(r.search).toContain(fold('Món Việt'));
      expect(r.search).toContain('vietnamese');
      expect(r.search).toContain('furama dining house');
    });

    it('lists only published cuisines', async () => {
      await sql(`UPDATE cuisines SET is_published = false WHERE id = 'thai'`);
      const r = (await list()).find((x) => x.id === 'yum-food-village')!;
      expect(r.cuisines).toEqual(['international', 'vietnamese']);
      expect(r.search).not.toContain('thai');
    });
  });
});
