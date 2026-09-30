import 'server-only';
import { query } from './client';
import type { DestKey, Meal, Restaurant } from '@/lib/data';

type RestaurantRow = {
  id: string;
  name: string;
  type: string;
  destination: string;
  cuisines: string[];
  meals: string[];
  slot_capacity: number;
};

/** The restaurant catalogue, ordered as the design lays it out. */
export async function listRestaurants(): Promise<Restaurant[]> {
  const rows = await query<RestaurantRow>(
    `SELECT id, name, type, destination, cuisines, meals, slot_capacity
       FROM restaurants
      ORDER BY sort_order`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    dest: r.destination as DestKey,
    cuisines: r.cuisines,
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

export type NewReservation = {
  reference: string;
  restaurantId: string;
  isoDate: string;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email?: string;
  note?: string;
};

export type CreateResult =
  | { ok: true; reference: string }
  | { ok: false; reason: 'full' | 'duplicate' | 'unknown-restaurant' };

/**
 * Books a table if the slot still has room. The capacity check and the insert
 * share one transaction and take a row lock on the restaurant, so two
 * simultaneous requests for the last seats cannot both succeed.
 */
export async function createReservation(input: NewReservation): Promise<CreateResult> {
  const { getPool } = await import('./client');
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const restaurant = await client.query<{ slot_capacity: number }>(
      'SELECT slot_capacity FROM restaurants WHERE id = $1 FOR UPDATE',
      [input.restaurantId],
    );
    if (!restaurant.rowCount) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'unknown-restaurant' };
    }

    const booked = await client.query<{ covers: string }>(
      `SELECT COALESCE(SUM(guests), 0)::text AS covers
         FROM reservations
        WHERE restaurant_id = $1
          AND reserved_on = $2::date
          AND reserved_at = $3
          AND status <> 'cancelled'`,
      [input.restaurantId, input.isoDate, input.time],
    );

    const taken = Number(booked.rows[0]?.covers ?? 0);
    if (taken + input.guests > restaurant.rows[0].slot_capacity) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'full' };
    }

    await client.query(
      `INSERT INTO reservations
         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, email, note)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9)`,
      [
        input.reference,
        input.restaurantId,
        input.isoDate,
        input.time,
        input.guests,
        input.name,
        input.phone,
        input.email || null,
        input.note || null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, reference: input.reference };
  } catch (err) {
    await client.query('ROLLBACK');
    // The partial unique index rejects an identical re-submit.
    if (typeof err === 'object' && err && (err as { code?: string }).code === '23505') {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  } finally {
    client.release();
  }
}
