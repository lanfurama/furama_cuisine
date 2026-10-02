import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { resolveDay } from '@/lib/booking/resolve-day';
import { slotVerdict } from '@/lib/booking/slot-code';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { newReference } from '@/lib/server/reference';
import { venueNow, type IsoDate } from '@/lib/venue-time';
import type { ReservationRequest } from './input';
import { lockBookingDay } from './lock';
import { loadBookedCovers, loadRestaurantRules } from './rules';

/*
 * Step 6 of submitReservation (spec §10.2): one transaction that takes the
 * booking-day lock, re-reads the rules and the covers, re-runs resolveDay,
 * and inserts the booking with its 'created' event. The outbox rows of step 6
 * and after() of step 7 arrive in phase 5.
 */

export type CreateOutcome =
  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed' }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

export type CreateOptions = {
  now?: Date;
  makeReference?: () => string;
  /** Tests pass a second pool to play a second server instance. */
  pool?: Pool;
};

const REFERENCE_ATTEMPTS = 3;

/** The unique constraint a Postgres error violated, if it is one. */
function violatedConstraint(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' ? (e.constraint ?? null) : null;
}

/** Books a table from the guest form. A reference that collides is redrawn, three times at most. */
export async function createWebReservation(
  input: ReservationRequest,
  { now = new Date(), makeReference = newReference, pool = getPool() }: CreateOptions = {},
): Promise<CreateOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insertOnce(pool, input, now, makeReference());
    } catch (err) {
      const constraint = violatedConstraint(err);
      // The partial unique index rejects a second active request for the same table and number.
      if (constraint === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
      if (constraint === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

async function insertOnce(pool: Pool, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await insertInTransaction(client, input, now, reference);
    await client.query(outcome.ok ? 'COMMIT' : 'ROLLBACK');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertInTransaction(client: PoolClient, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  // The lock first: the rules and the covers read below must be the ones the insert is decided on.
  await lockBookingDay(client, input.restaurantId, input.date);
  const loaded = await loadRestaurantRules(client, input.restaurantId, input.locale, venueNow(now).date);
  if (!loaded) return { ok: false, code: 'restaurant_unavailable' };
  const { rules, groupPhone } = loaded;
  const booked = (await loadBookedCovers(client, input.restaurantId, input.date, input.date))[input.date] ?? {};
  const verdict = slotVerdict(resolveDay(rules, input.date, now, booked, input.guests), input.time);
  if (!verdict.ok) {
    if (verdict.code === 'slot_unavailable') return { ...verdict, params: { restaurant: rules.restaurantName } };
    if (verdict.code === 'party_too_large') {
      return { ...verdict, params: { max: String(rules.maxParty), ...(groupPhone ? { phone: groupPhone.display } : {}) } };
    }
    return verdict;
  }
  const status = rules.autoConfirm ? 'confirmed' : 'requested';
  // search_text, version and updated_at come from the reservations_before_write trigger.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservations
       (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164,
        email, note, status, confirmed_at, source, locale)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
             COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
                      (SELECT code FROM locales WHERE is_default)))
     RETURNING id::text`,
    [
      reference,
      input.restaurantId,
      input.date,
      input.time,
      verdict.period.meal,
      input.guests,
      input.name,
      input.phone,
      input.phoneE164,
      input.email,
      input.note,
      status,
      input.locale,
    ],
  );
  const id = rows[0].id;
  await client.query(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2)`, [
    id,
    status,
  ]);
  return { ok: true, id, reference, date: input.date, status };
}
