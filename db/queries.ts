import 'server-only';
import { query } from './client';
import { DETAIL_PAGE_IDS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';

type RestaurantRow = {
  id: string;
  name: string;
  type: string;
  destination: string;
  cuisines: string[];
  meals: string[];
  slot_capacity: number;
};

/**
 * The restaurant catalogue, ordered as the design lays it out. An unknown
 * cuisine label throws: the cached guest read must fail loudly. (The booking
 * path reads lib/server/booking/rules.ts, never this.)
 */
export async function listRestaurants(): Promise<Restaurant[]> {
  const rows = await query<RestaurantRow>(
    `SELECT id, name, type, destination, cuisines, meals, slot_capacity
       FROM restaurants
      ORDER BY sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.id,
    hasDetailPage: DETAIL_PAGE_IDS.has(r.id),
    name: r.name,
    type: r.type,
    dest: r.destination as DestKey,
    cuisines: r.cuisines.map(cuisineSlug),
    meals: r.meals as Meal[],
    slotCapacity: r.slot_capacity,
  }));
}

/** Covers already booked per time slot for one restaurant on one date. */
export async function bookedCovers(
  restaurantId: string,
  isoDate: string,
): Promise<Record<string, number>> {
  const rows = await query<{ reserved_at: string; covers: string }>(
    `SELECT reserved_at, SUM(guests)::text AS covers
       FROM reservations
      WHERE restaurant_id = $1
        AND reserved_on = $2::date
        AND status <> 'cancelled'
      GROUP BY reserved_at`,
    [restaurantId, isoDate],
  );
  return Object.fromEntries(rows.map((r) => [r.reserved_at, Number(r.covers)]));
}

export async function slotCapacity(restaurantId: string): Promise<number> {
  const rows = await query<{ slot_capacity: number }>(
    'SELECT slot_capacity FROM restaurants WHERE id = $1',
    [restaurantId],
  );
  return rows[0]?.slot_capacity ?? 0;
}
