import { afterAll, describe, expect, it } from 'vitest';
import { getPool } from '@/db/client';
import { listRestaurants } from '@/db/queries';

describe.skipIf(!process.env.TEST_DATABASE_URL)('restaurant catalogue (database)', () => {
  afterAll(() => getPool().end());

  it('serves the 12 seeded restaurants in design order', async () => {
    const restaurants = await listRestaurants();
    expect(restaurants).toHaveLength(12);
    expect(restaurants[0].id).toBe('cafe-indochine');
    expect(restaurants.find((r) => r.id === 'taya-house')?.slotCapacity).toBe(16);
  });
});
