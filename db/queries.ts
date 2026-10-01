import 'server-only';
import { getPool, query } from './client';
import { DETAIL_PAGE_IDS, cuisineSlug, type DestKey, type Meal, type Restaurant } from '@/lib/data';
import { newReference } from '@/lib/server/reference';

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
 * cuisine label throws (the cached guest read must fail loudly); with
 * `lenient` it is logged and skipped, for the booking path, which only needs
 * ids, meals and capacity and must not die over a filter label.
 */
export async function listRestaurants(options: { lenient?: boolean } = {}): Promise<Restaurant[]> {
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
    cuisines: r.cuisines.flatMap((label) => {
      try {
        return [cuisineSlug(label)];
      } catch (error) {
        if (!options.lenient) throw error;
        console.error('unknown_cuisine_label', label);
        return [];
      }
    }),
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
  restaurantId: string;
  isoDate: string;
  time: string;
  guests: number;
  name: string;
  /** As the guest typed it. */
  phone: string;
  /** Canonical form; the duplicate check keys on this. */
  phoneE164: string;
  email?: string;
  note?: string;
};

export type CreateResult =
  | { ok: true; reference: string }
  | { ok: false; reason: 'full' | 'duplicate' | 'unknown-restaurant' };

const REFERENCE_ATTEMPTS = 3;

/** The unique constraint a Postgres error violated, if it is one. */
function violatedConstraint(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' ? (e.constraint ?? null) : null;
}

/**
 * Books a table if the slot still has room. A reference that collides with an
 * existing one is redrawn, up to three times.
 */
export async function createReservation(
  input: NewReservation,
  makeReference: () => string = newReference,
): Promise<CreateResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insertReservation(input, makeReference());
    } catch (err) {
      if (violatedConstraint(err) === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * The capacity check and the insert share one transaction and take a row lock
 * on the restaurant, so two simultaneous requests for the last seats cannot
 * both succeed.
 */
async function insertReservation(input: NewReservation, reference: string): Promise<CreateResult> {
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
         (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)`,
      [
        reference,
        input.restaurantId,
        input.isoDate,
        input.time,
        input.guests,
        input.name,
        input.phone,
        input.phoneE164,
        input.email || null,
        input.note || null,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, reference };
  } catch (err) {
    await client.query('ROLLBACK');
    // The partial unique index rejects a second request for the same table and number.
    if (violatedConstraint(err) === 'reservations_dedupe_v2_idx') return { ok: false, reason: 'duplicate' };
    throw err;
  } finally {
    client.release();
  }
}
