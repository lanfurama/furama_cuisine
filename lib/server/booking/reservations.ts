import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';
import { findPlannedSlot, planDay } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES, type ReservationStatus } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import {
  STAFF_SOURCES,
  checkWindow,
  findTransition,
  serviceDay,
  sourcesOf,
  type StaffSource,
  type Transition,
} from '@/lib/reservations/lifecycle';
import { withTransaction } from '@/lib/server/audit';
import { newReference } from '@/lib/server/reference';
import { minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';
import { lockBookingDay } from './lock';
import { loadBookedCovers, loadRestaurantRules } from './rules';

/*
 * Every staff write to a reservation (spec §10.3, §7.4): one transaction that
 * changes the row, appends its reservation_events row (instead of audit_log)
 * and runs the effects hook. Optimistic concurrency on reservations.version,
 * which the reservations_before_write trigger bumps on every UPDATE.
 *
 * A write that takes covers (a staff booking, an edit that moves or grows a
 * booking) calls lockBookingDay first, the same lock as the guest's submit,
 * and only then reads the rules and the covers. Staff slots come from the
 * clock-free planDay: staff may book past the online window, on a restaurant
 * whose online booking is off, above max_party, but never into a closed
 * service or at a time that is not a slot (R8).
 *
 * Phase 5 (email): the hooks run inside the same transaction, after the event
 * row; `notifyGuest` is already part of every input (false until phase 5 adds
 * the checkbox and the outbox effects).
 */

/** Who acted, as reservation_events stores it: a snapshot, no FK (spec §5.1.6). */
export type ReservationActor = { id: string; label: string };

export function staffActor(staff: { userId: string; name: string; email: string }): ReservationActor {
  return { id: staff.userId, label: `${staff.name} (${staff.email})` };
}

export type ReservationEffects = {
  /** After a status change and its event; same transaction. Phase 5 queues transition.guestEmail here. */
  afterTransition?: (
    client: PoolClient,
    change: { reservationId: string; transition: Transition; eventId: string; notifyGuest: boolean },
  ) => Promise<void>;
  /** After a staff booking and its `created` event; same transaction. Phase 5 queues guest.confirmed here. */
  afterCreate?: (
    client: PoolClient,
    created: { reservationId: string; status: ReservationStatus; eventId: string; notifyGuest: boolean },
  ) => Promise<void>;
};

export type Failure<C extends string> = { ok: false; code: C; params?: Record<string, string>; fieldErrors?: Record<string, string[]> };
export type Conflict = Failure<'conflict'>;

/**
 * "Vừa được {người} thay đổi lúc {giờ}" (spec §10.3): the newest event that came with an UPDATE of the row
 * (the ones that bump version) says who got there first. A note changes no row, nor will phase 5's email events.
 */
async function conflict(client: PoolClient, reservationId: string): Promise<Conflict> {
  const { rows } = await client.query<{ actor_label: string | null; at: Date }>(
    `SELECT actor_label, at FROM reservation_events
      WHERE reservation_id = $1 AND type IN ('status_changed', 'edited')
      ORDER BY at DESC, id DESC LIMIT 1`,
    [reservationId],
  );
  const last = rows[0];
  return { ok: false, code: 'conflict', params: { by: last?.actor_label ?? 'người khác', at: last ? formatDateTimeVi(last.at) : '' } };
}

type EventType = 'created' | 'status_changed' | 'edited' | 'note_added';

async function insertEvent(
  client: PoolClient,
  actor: ReservationActor,
  event: { reservationId: string; type: EventType; from?: string | null; to?: string | null; changes?: unknown; reason?: string | null },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservation_events (reservation_id, actor_kind, actor_id, actor_label, type, from_status, to_status, changes, reason)
     VALUES ($1, 'staff', $2, $3, $4, $5, $6, $7, $8)
     RETURNING id::text`,
    [
      event.reservationId,
      actor.id,
      actor.label,
      event.type,
      event.from ?? null,
      event.to ?? null,
      event.changes === undefined ? null : JSON.stringify(event.changes),
      event.reason ?? null,
    ],
  );
  return rows[0].id;
}

/** The unique constraint a Postgres error violated, if it is one. */
function constraintOf(err: unknown): string | null {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' ? (e.constraint ?? null) : null;
}

// ── status transitions ──────────────────────────────────────────────────────

export type TransitionInput = { id: string; version: number; to: ReservationStatus; reason: string | null; notifyGuest: boolean };
export type TransitionResult =
  | { ok: true; data: { status: ReservationStatus; version: number } }
  | Conflict
  | Failure<'not_found' | 'not_allowed' | 'too_early' | 'too_late' | 'invalid' | 'duplicate'>;

type Current = { status: ReservationStatus; version: number; date: IsoDate; time: string };

export async function transitionReservation(
  pool: Pool,
  actor: ReservationActor,
  input: TransitionInput,
  options: { now?: Date; effects?: ReservationEffects } = {},
): Promise<TransitionResult> {
  const now = options.now ?? new Date();
  try {
    return await withTransaction(pool, async (client): Promise<TransitionResult> => {
      const { rows } = await client.query<Current>(
        `SELECT status, version, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time FROM reservations WHERE id = $1`,
        [input.id],
      );
      const current = rows[0];
      if (!current) return { ok: false, code: 'not_found' };
      if (current.version !== input.version) return conflict(client, input.id);

      const transition = findTransition(current.status, input.to);
      if (!transition) return { ok: false, code: 'not_allowed' };
      const window = checkWindow(transition, current.date, current.time, now);
      if (!window.ok) return { ok: false, code: window.code };
      if (transition.reason === 'required' && !input.reason) {
        return { ok: false, code: 'invalid', fieldErrors: { reason: ['Nhập lý do.'] } };
      }

      // The sources whose window is open now; the version pins the row checked above.
      const from = sourcesOf(input.to).filter((s) => checkWindow(findTransition(s, input.to)!, current.date, current.time, now).ok);
      const updated = await client.query<{ status: ReservationStatus; version: number }>(
        `UPDATE reservations
            SET status = $3,
                status_reason = CASE WHEN $3 IN ('cancelled', 'declined') THEN $4 ELSE status_reason END,
                confirmed_at = CASE WHEN $3 = 'confirmed' THEN coalesce(confirmed_at, now()) ELSE confirmed_at END,
                cancelled_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END,
                updated_by = $5
          WHERE id = $1 AND version = $2 AND status = ANY ($6::text[])
          RETURNING status, version`,
        [input.id, input.version, input.to, input.reason, actor.id, from],
      );
      if (updated.rowCount === 0) return conflict(client, input.id);

      const eventId = await insertEvent(client, actor, {
        reservationId: input.id,
        type: 'status_changed',
        from: current.status,
        to: input.to,
        reason: input.reason,
      });
      await options.effects?.afterTransition?.(client, { reservationId: input.id, transition, eventId, notifyGuest: input.notifyGuest });
      return { ok: true, data: updated.rows[0] };
    });
  } catch (err) {
    // seated → confirmed puts a row back under the dedupe index.
    if (constraintOf(err) === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
    throw err;
  }
}

// ── the slot check of staff bookings and edits ──────────────────────────────

/** Staff paths never show a closure's public reason; the default language stands in when this one is off. */
const STAFF_LOCALE = 'vi';

export type BookingCheckFailure = Failure<'not_found' | 'closed' | 'slot_unavailable' | 'full' | 'invalid'>;
type SlotCheck = { ok: true; meal: Meal; over: boolean } | BookingCheckFailure;

/**
 * Under the booking-day lock: the time must be a slot of an open service that
 * day; past its capacity only with a reason. `excludeId`: an edit does not
 * count its own covers.
 */
async function checkSlot(
  client: PoolClient,
  slot: { restaurantId: string; date: IsoDate; time: string; guests: number; overCapacityReason: string | null },
  excludeId: string | null = null,
): Promise<SlotCheck> {
  const loaded = await loadRestaurantRules(client, slot.restaurantId, STAFF_LOCALE, slot.date);
  if (!loaded) return { ok: false, code: 'not_found' };
  const hit = findPlannedSlot(planDay(loaded.rules, slot.date), slot.time);
  if (!hit) return { ok: false, code: 'slot_unavailable' };
  if (hit.period.closed) return { ok: false, code: 'closed' };
  const booked = (await loadBookedCovers(client, slot.restaurantId, slot.date, slot.date, excludeId))[slot.date]?.[slot.time] ?? 0;
  const over = booked + slot.guests > hit.capacity;
  if (over && !slot.overCapacityReason) return { ok: false, code: 'full', params: { left: String(Math.max(0, hit.capacity - booked)) } };
  return { ok: true, meal: hit.period.meal, over };
}

// ── staff bookings (phone, walk-in) ─────────────────────────────────────────

export type StaffBookingInput = {
  restaurantId: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email: string | null;
  note: string | null;
  locale: string;
  source: StaffSource;
  /** Required to book past a slot's capacity (spec §10.3: over_capacity with a reason). */
  overCapacityReason: string | null;
  notifyGuest: boolean;
};

export type StaffBookingResult = { ok: true; data: { id: string; reference: string } } | BookingCheckFailure | Failure<'duplicate'>;

const REFERENCE_ATTEMPTS = 3;

export async function createStaffReservation(
  pool: Pool,
  actor: ReservationActor,
  input: StaffBookingInput,
  options: { now?: Date; effects?: ReservationEffects; makeReference?: () => string } = {},
): Promise<StaffBookingResult> {
  const now = options.now ?? new Date();
  const makeReference = options.makeReference ?? newReference;
  // A walk-in is seated now, so it belongs to this service day; a phone booking is for a sitting still to come.
  if (input.source === 'walk_in' && input.date !== serviceDay(now)) {
    return { ok: false, code: 'invalid', fieldErrors: { date: ['Khách vãng lai chỉ tạo cho hôm nay.'] } };
  }
  if (input.source === 'phone' && input.date < venueNow(now).date) {
    return { ok: false, code: 'invalid', fieldErrors: { date: ['Ngày đã qua.'] } };
  }
  if (input.source === 'phone' && minutesUntil(input.date, input.time, now) < 0) {
    return { ok: false, code: 'invalid', fieldErrors: { time: ['Giờ này đã qua. Khách đang có mặt thì tạo khách vãng lai.'] } };
  }
  const status = STAFF_SOURCES[input.source];

  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction(pool, async (client): Promise<StaffBookingResult> => {
        // The lock first: the rules and the covers read below must be the ones the insert is decided on.
        await lockBookingDay(client, input.restaurantId, input.date);
        const slot = await checkSlot(client, input);
        if (!slot.ok) return slot;

        // search_text, version and updated_at come from the reservations_before_write trigger.
        const { rows } = await client.query<{ id: string; reference: string }>(
          `INSERT INTO reservations
             (reference, restaurant_id, reserved_on, reserved_at, guests, guest_name, phone, phone_e164, email, note,
              status, meal, locale, source, over_capacity, confirmed_at, updated_by)
           VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                   CASE WHEN $11 IN ('confirmed', 'seated') THEN now() END, $16)
           RETURNING id::text, reference`,
          [
            makeReference(),
            input.restaurantId,
            input.date,
            input.time,
            input.guests,
            input.name,
            input.phone,
            input.phoneE164,
            input.email,
            input.note,
            status,
            slot.meal,
            input.locale,
            input.source,
            slot.over,
            actor.id,
          ],
        );
        const created = rows[0];
        const eventId = await insertEvent(client, actor, {
          reservationId: created.id,
          type: 'created',
          to: status,
          changes: { source: input.source, ...(slot.over ? { over_capacity: true } : {}) },
          reason: slot.over ? input.overCapacityReason : null,
        });
        await options.effects?.afterCreate?.(client, { reservationId: created.id, status, eventId, notifyGuest: input.notifyGuest });
        return { ok: true, data: created };
      });
    } catch (err) {
      const constraint = constraintOf(err);
      if (constraint === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      if (constraint === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
      throw err;
    }
  }
}

// ── edits (date, time, party, guest details) ────────────────────────────────

export type EditInput = {
  id: string;
  version: number;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phoneE164: string;
  email: string | null;
  note: string | null;
  overCapacityReason: string | null;
};

export type EditResult =
  | { ok: true; data: { version: number; changed: boolean } }
  | Conflict
  | BookingCheckFailure
  | Failure<'not_allowed' | 'duplicate'>;

type EditableRow = {
  restaurant_id: string;
  status: ReservationStatus;
  version: number;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  phone_e164: string;
  email: string | null;
  note: string | null;
  over_capacity: boolean;
};

/** Staff edits ignore the clock (R8), so unlike the other writes this one takes no `now`. */
export async function editReservation(pool: Pool, actor: ReservationActor, input: EditInput): Promise<EditResult> {
  try {
    return await withTransaction(pool, async (client): Promise<EditResult> => {
      const { rows } = await client.query<EditableRow>(
        `SELECT restaurant_id, status, version, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time, guests,
                guest_name AS name, phone, phone_e164, email, note, over_capacity
           FROM reservations WHERE id = $1`,
        [input.id],
      );
      const before = rows[0];
      if (!before) return { ok: false, code: 'not_found' };
      if (before.version !== input.version) return conflict(client, input.id);
      if (!(HOLDING_STATUSES as readonly string[]).includes(before.status)) return { ok: false, code: 'not_allowed' };

      const after = {
        date: input.date,
        time: input.time,
        guests: input.guests,
        name: input.name,
        phone: input.phone,
        phone_e164: input.phoneE164,
        email: input.email,
        note: input.note,
      };
      const changes: Record<string, [unknown, unknown]> = {};
      for (const [key, value] of Object.entries(after)) {
        const old = before[key as keyof typeof after];
        if (old !== value) changes[key] = [old, value];
      }
      // Every UPDATE bumps the version (the trigger), so an unchanged form writes nothing.
      if (Object.keys(changes).length === 0) return { ok: true, data: { version: before.version, changed: false } };

      // A smaller party at the same slot frees covers: only a move or a larger party is re-checked,
      // under the lock of the target day (one booking-day lock per transaction; freeing needs none).
      const moved = input.date !== before.date || input.time !== before.time;
      let meal: Meal | null = null;
      let over = before.over_capacity;
      if (moved || input.guests > before.guests) {
        await lockBookingDay(client, before.restaurant_id, input.date);
        const slot = await checkSlot(client, { ...input, restaurantId: before.restaurant_id }, input.id);
        if (!slot.ok) return slot;
        meal = slot.meal;
        over = slot.over;
      }

      const updated = await client.query<{ version: number }>(
        `UPDATE reservations
            SET reserved_on = $3::date, reserved_at = $4, guests = $5, guest_name = $6, phone = $7, phone_e164 = $8,
                email = $9, note = $10, meal = coalesce($11, meal), over_capacity = $12, updated_by = $13
          WHERE id = $1 AND version = $2
          RETURNING version`,
        [input.id, input.version, input.date, input.time, input.guests, input.name, input.phone, input.phoneE164, input.email, input.note, meal, over, actor.id],
      );
      if (updated.rowCount === 0) return conflict(client, input.id);
      await insertEvent(client, actor, {
        reservationId: input.id,
        type: 'edited',
        changes: { ...changes, ...(over !== before.over_capacity ? { over_capacity: [before.over_capacity, over] } : {}) },
        reason: over && meal ? input.overCapacityReason : null,
      });
      return { ok: true, data: { version: updated.rows[0].version, changed: true } };
    });
  } catch (err) {
    if (constraintOf(err) === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
    throw err;
  }
}

// ── internal notes ──────────────────────────────────────────────────────────

export async function addReservationNote(
  pool: Pool,
  actor: ReservationActor,
  input: { id: string; body: string },
): Promise<{ ok: true; data: { noteId: string } } | Failure<'not_found'>> {
  return withTransaction(pool, async (client) => {
    const exists = await client.query('SELECT 1 FROM reservations WHERE id = $1', [input.id]);
    if (exists.rowCount === 0) return { ok: false, code: 'not_found' } as const;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reservation_notes (reservation_id, author_id, author_label, body) VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [input.id, actor.id, actor.label, input.body],
    );
    // The timeline records that a note was added, never its text (notes stay internal; the anonymiser deletes them).
    await insertEvent(client, actor, { reservationId: input.id, type: 'note_added', changes: { note_id: rows[0].id } });
    return { ok: true, data: { noteId: rows[0].id } } as const;
  });
}
