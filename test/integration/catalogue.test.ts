import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { listRestaurants } from '@/db/queries';
import { CUISINES } from '@/lib/data';

const sql = (text: string, values: unknown[] = []) => getPool().query(text, values);

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterEach(async () => {
    await sql('UPDATE restaurants SET booking_enabled = true');
    await sql('UPDATE service_periods SET active = true');
    await sql(`DELETE FROM service_periods WHERE restaurant_id = 'hura-izakaya' AND meal = 'Breakfast'`);
  });
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')).toMatchObject({ meals: ['Lunch', 'Dinner'], bookingEnabled: true });
  });

  it('keys cuisines by slug, so every label in the database has one', async () => {
    const slugs = new Set(CUISINES.map(([, slug]) => slug));
    const used = (await listRestaurants()).flatMap((r) => r.cuisines);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !slugs.has(c))).toEqual([]);
  });

  it('uses the id as slug and gives only Tàya House a detail page', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants.every((r) => r.slug === r.id)).toBe(true);
    expect(restaurants.filter((r) => r.hasDetailPage).map((r) => r.id)).toEqual(['taya-house']);
  });

  it('carries the booking switch', async () => {
    await sql(`UPDATE restaurants SET booking_enabled = false WHERE id = 'hai-van-lounge'`);
    const off = (await listRestaurants()).filter((r) => !r.bookingEnabled).map((r) => r.id);
    expect(off).toEqual(['hai-van-lounge']);
  });

  it('derives meals from the active service periods, in the canonical meal order (spec §6.3)', async () => {
    // Seeded periods reproduce restaurants.meals exactly.
    const { rows } = await sql('SELECT id, meals FROM restaurants ORDER BY sort_order');
    expect((await listRestaurants()).map((r) => [r.id, r.meals])).toEqual(rows.map((r) => [r.id, r.meals]));
    await sql(`UPDATE service_periods SET active = false WHERE restaurant_id = 'taya-house' AND meal = 'Lunch'`);
    await sql(
      `INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, covers_per_slot, sort_order)
       VALUES ('hura-izakaya', 'Breakfast', '07:00', '09:00', 10, 50)`,
    );
    const meals = Object.fromEntries((await listRestaurants()).map((r) => [r.id, r.meals]));
    expect(meals['taya-house']).toEqual(['Dinner']);
    expect(meals['hura-izakaya']).toEqual(['Breakfast', 'Dinner']);
  });
});
