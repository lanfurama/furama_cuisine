import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { resolveDay } from '@/lib/booking/resolve-day';
import { PHONE_DAY_LIMIT } from '@/lib/booking/rules';
import { slotVerdict } from '@/lib/booking/slot-code';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { UPCOMING_STATUSES } from '@/lib/reservations/lifecycle';
import { outboxEnv } from '@/lib/server/email/env';
import { queueWebBookingEmails } from '@/lib/server/email/outbox';
import { newReference } from '@/lib/server/reference';
import { venueNow, type IsoDate } from '@/lib/venue-time';
import type { ReservationRequest } from './input';
import { lockBookingDay, lockGuestPhoneDay } from './lock';
import { loadBookedCovers, loadRestaurantRules } from './rules';

/*
 * Steps 5 and 6 of submitReservation (spec §10.2): one transaction that
 * counts the number's active requests for the date under the guest-phone
 * lock, then takes the booking-day lock, re-reads the rules and the covers,
 * re-runs resolveDay, and inserts the booking (with the policy version the
 * guest agreed to), its 'created' event and its email_outbox rows (staff.new,
 * then guest.ack or guest.confirmed). Nothing is sent here; the action drains
 * `outboxIds` once this has committed (step 7).
 */

export type CreateOutcome =
  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed'; outboxIds: string[] }
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

/**
 * Step 5 (R14): the active web requests this number already holds for this
 * date, at any restaurant. Counted under the number's own lock, because the
 * booking-day lock is per restaurant and the same number can book two
 * restaurants at once. Taken before the booking-day lock (lock order in
 * lock.ts), so a burst from one number queues on its own key and is refused
 * without holding up the restaurant's day.
 */
async function phoneDayFull(client: PoolClient, input: ReservationRequest): Promise<boolean> {
  await lockGuestPhoneDay(client, input.phoneE164, input.date);
  const { rows } = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM reservations
      WHERE phone_e164 = $1 AND reserved_on = $2::date AND source = 'web' AND status = ANY($3::text[])`,
    [input.phoneE164, input.date, UPCOMING_STATUSES],
  );
  return rows[0].n >= PHONE_DAY_LIMIT;
}

async function insertInTransaction(client: PoolClient, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  if (await phoneDayFull(client, input)) return { ok: false, code: 'too_many_requests' };
  // Then the booking-day lock: the rules and the covers read below must be the ones the insert is decided on.
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
        email, note, status, confirmed_at, source, locale, consent_version, consented_at, offer_id)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
             COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
                      (SELECT code FROM locales WHERE is_default)),
             $14, now(),
             -- R9, a soft link: the id came over the wire, and the guest may have switched
             -- restaurant or date since VIEW OFFER. Kept only for a published offer of this
             -- restaurant that runs on the booked date; anything else books without it.
             (SELECT o.id FROM offers o
               WHERE o.id = $15 AND o.restaurant_id = $2 AND o.is_published
                 AND (o.valid_from IS NULL OR o.valid_from <= $3::date)
                 AND (o.valid_until IS NULL OR o.valid_until >= $3::date)))
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
      input.consentVersion,
      input.offerId,
    ],
  );
  const id = rows[0].id;
  const event = await client.query<{ id: string }>(
    `INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2) RETURNING id::text`,
    [id, status],
  );
  const outboxIds = await queueWebBookingEmails(client, { reservationId: id, eventId: event.rows[0].id, env: outboxEnv(), status });
  return { ok: true, id, reference, date: input.date, status, outboxIds };
}
