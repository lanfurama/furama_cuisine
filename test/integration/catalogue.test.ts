import { afterAll, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { listRestaurants } from '@/db/queries';
import { CUISINES } from '@/lib/data';

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')?.slotCapacity).toBe(16);
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
});
