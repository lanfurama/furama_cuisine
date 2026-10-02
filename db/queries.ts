import 'server-only';
import { query } from './client';
import { DETAIL_PAGE_IDS, MEALS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';

type RestaurantRow = {
  id: string;
  name: string;
  type: string;
  destination: string;
  cuisines: string[];
  meals: string[];
  booking_enabled: boolean;
};

/**
 * The restaurant catalogue, ordered as the design lays it out. An unknown
 * cuisine label throws: the cached guest read must fail loudly. (The booking
 * path reads lib/server/booking/rules.ts, never this.)
 */
export async function listRestaurants(): Promise<Restaurant[]> {
  // meals: the meals of the active service periods, in MEALS order (spec §6.3
  // item 2); restaurants.meals is only the phase-1 seed source now. Period saves
  // expire the 'restaurants' tag this catalogue is cached under.
  const rows = await query<RestaurantRow>(
    `SELECT r.id, r.name, r.type, r.destination, r.cuisines, r.booking_enabled,
            ARRAY(SELECT m.meal
                    FROM unnest($1::text[]) WITH ORDINALITY AS m(meal, n)
                   WHERE EXISTS (SELECT 1 FROM service_periods p
                                  WHERE p.restaurant_id = r.id AND p.active AND p.meal = m.meal)
                   ORDER BY m.n) AS meals
       FROM restaurants r
      ORDER BY r.sort_order`,
    [MEALS],
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
    bookingEnabled: r.booking_enabled,
  }));
}
