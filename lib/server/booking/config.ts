import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';
import { seatings } from '@/lib/booking/resolve-day';
import type { PeriodRule } from '@/lib/booking/rules';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import type { Db } from './rules';

/*
 * Booking configuration as staff edit it (spec §7.4 save flow): one
 * transaction with its audit_log row, optimistic concurrency on updated_at.
 * The token is updated_at in microseconds since the epoch, as text: exact,
 * where a JS Date keeps only milliseconds. One token per restaurant
 * (restaurants.updated_at) guards both its rules form and its periods editor
 * (R16). The Server Action expires the cache tags afterwards: 'restaurants'
 * and 'booking-rules:<id>' (spec §10.1). The guest-facing reads are in
 * rules.ts; these are the edit screens' own.
 */

/** A timestamptz column as the concurrency token. */
export const US = (column: string) => `(extract(epoch FROM ${column}) * 1000000)::bigint::text`;

type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };
type NotFound = { ok: false; code: 'not_found' };
type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };

/** "Vừa được {tên} thay đổi lúc {giờ}": updated_by holds the staff id (spec §5.1.6). */
async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
  const { rows } = staffId ? await client.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]) : { rows: [] };
  return { ok: false, code: 'conflict', params: { by: rows[0]?.name ?? 'người khác', at: formatDateTimeVi(at) } };
}

/** Locks the restaurant's row for the save and checks the page's token. */
async function lockRestaurant(client: PoolClient, id: string, token: string): Promise<NotFound | Conflict | null> {
  const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
    `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM restaurants WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return { ok: false, code: 'not_found' };
  if (rows[0].token !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return null;
}

// ── reads for the edit screens ──────────────────────────────────────────────

export type BookingSettings = {
  windowDays: number;
  leadMinutes: number;
  /** "HH:MM" or null. */
  sameDayCutoff: string | null;
  maxParty: number;
  autoConfirm: boolean;
  guestAckEmail: boolean;
  piiRetentionMonths: number;
  token: string;
};

export async function getBookingSettings(db: Db): Promise<BookingSettings> {
  const { rows } = await db.query<BookingSettings>(
    `SELECT window_days AS "windowDays", lead_minutes AS "leadMinutes", to_char(same_day_cutoff, 'HH24:MI') AS "sameDayCutoff",
            max_party AS "maxParty", auto_confirm AS "autoConfirm", guest_ack_email AS "guestAckEmail",
            pii_retention_months AS "piiRetentionMonths", ${US('updated_at')} AS token
       FROM booking_settings`,
  );
  if (!rows[0]) throw new Error('booking_settings has no row (migration 006 seeds it)');
  return rows[0];
}

export type RestaurantBooking = {
  id: string;
  name: string;
  destinationId: string;
  bookingEnabled: boolean;
  /** Overrides; null follows booking_settings. */
  windowDays: number | null;
  leadMinutes: number | null;
  maxParty: number | null;
  autoConfirm: boolean | null;
  token: string;
};

const RESTAURANT_COLUMNS = `id, name, destination AS "destinationId", booking_enabled AS "bookingEnabled",
  window_days AS "windowDays", lead_minutes AS "leadMinutes", max_party AS "maxParty",
  auto_confirm AS "autoConfirm", ${US('updated_at')} AS token`;

export async function listRestaurantBookings(db: Db): Promise<RestaurantBooking[]> {
  const { rows } = await db.query<RestaurantBooking>(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants ORDER BY sort_order, id`);
  return rows;
}

export async function getRestaurantBooking(db: Db, id: string): Promise<RestaurantBooking | null> {
  const { rows } = await db.query<RestaurantBooking>(`SELECT ${RESTAURANT_COLUMNS} FROM restaurants WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Every period of one restaurant, switched off ones included, as the editor lists them. */
export type StoredPeriod = PeriodRule & { active: boolean };

export async function loadPeriods(db: Db, restaurantId: string): Promise<StoredPeriod[]> {
  const { rows } = await db.query<StoredPeriod>(
    `SELECT id::text, meal, weekdays::int[] AS weekdays,
            to_char(first_seating, 'HH24:MI') AS "firstSeating", to_char(last_seating, 'HH24:MI') AS "lastSeating",
            interval_min AS "intervalMin", covers_per_slot AS "coversPerSlot", active, sort_order AS "sortOrder"
       FROM service_periods
      WHERE restaurant_id = $1
      ORDER BY sort_order, first_seating, id`,
    [restaurantId],
  );
  return rows;
}

// ── service periods (schedule:update) ───────────────────────────────────────

export type PeriodInput = Omit<StoredPeriod, 'id' | 'sortOrder'> & { id: string | null };

/**
 * Within one restaurant a time belongs to one service on any weekday they
 * share (R6): capacity is kept per time, so a booking's slot must map to one
 * capacity and one meal. The first clash, or null.
 */
export function overlappingPeriods(periods: readonly PeriodInput[]): string | null {
  const active = periods.filter((p) => p.active);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const [a, b] = [active[i], active[j]];
      if (!a.weekdays.some((d) => b.weekdays.includes(d))) continue;
      const times = new Set(seatings(b));
      const shared = seatings(a).find((t) => times.has(t));
      if (shared) return `${a.meal} và ${b.meal} cùng có giờ ${shared}.`;
    }
  }
  return null;
}

/** Saves the whole list: periods left out are deleted, the rest updated or added, in the order given. */
export async function saveServicePeriods(
  pool: Pool,
  actor: AuditActor,
  input: { restaurantId: string; token: string; periods: PeriodInput[] },
): Promise<{ ok: true; data: null } | NotFound | Conflict | Invalid> {
  const overlap = overlappingPeriods(input.periods);
  if (overlap) return { ok: false, code: 'invalid', fieldErrors: { periods: [`Hai ca trùng giờ: ${overlap}`] } };
  return withTransaction(pool, async (client) => {
    const locked = await lockRestaurant(client, input.restaurantId, input.token);
    if (locked) return locked;
    const before = await loadPeriods(client, input.restaurantId);
    const known = new Set(before.map((p) => p.id));
    // An id this restaurant does not have: the page is older than a save that removed it.
    if (input.periods.some((p) => p.id !== null && !known.has(p.id))) {
      return { ok: false, code: 'conflict', params: { by: 'người khác', at: '' } } as const;
    }

    const keep = input.periods.flatMap((p) => (p.id ? [p.id] : []));
    await client.query('DELETE FROM service_periods WHERE restaurant_id = $1 AND NOT (id = ANY ($2::bigint[]))', [input.restaurantId, keep]);
    for (const [index, p] of input.periods.entries()) {
      const values = [p.meal, p.weekdays, p.firstSeating, p.lastSeating, p.intervalMin, p.coversPerSlot, p.active, (index + 1) * 10, actor.id];
      if (p.id) {
        await client.query(
          `UPDATE service_periods
              SET meal = $1, weekdays = $2::smallint[], first_seating = $3::time, last_seating = $4::time, interval_min = $5,
                  covers_per_slot = $6, active = $7, sort_order = $8, updated_by = $9, updated_at = now()
            WHERE id = $10 AND restaurant_id = $11`,
          [...values, p.id, input.restaurantId],
        );
      } else {
        await client.query(
          `INSERT INTO service_periods (meal, weekdays, first_seating, last_seating, interval_min, covers_per_slot, active, sort_order, updated_by, restaurant_id)
           VALUES ($1, $2::smallint[], $3::time, $4::time, $5, $6, $7, $8, $9, $10)`,
          [...values, input.restaurantId],
        );
      }
    }
    // The restaurant's token moves, so the rules form open elsewhere goes stale too.
    await client.query('UPDATE restaurants SET updated_at = now(), updated_by = $2 WHERE id = $1', [input.restaurantId, actor.id]);
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'service_periods',
      entityId: input.restaurantId,
      before,
      after: await loadPeriods(client, input.restaurantId),
    });
    return { ok: true, data: null } as const;
  });
}

// ── the booking switch and the overrides (reservations:configure) ───────────

export type RulesInput = {
  restaurantId: string;
  token: string;
  bookingEnabled: boolean;
  windowDays: number | null;
  leadMinutes: number | null;
  maxParty: number | null;
};

const rulesSnapshot = (r: RestaurantBooking | null) =>
  r && { booking_enabled: r.bookingEnabled, window_days: r.windowDays, lead_minutes: r.leadMinutes, max_party: r.maxParty };

export async function saveRestaurantRules(pool: Pool, actor: AuditActor, input: RulesInput): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockRestaurant(client, input.restaurantId, input.token);
    if (locked) return locked;
    const before = await getRestaurantBooking(client, input.restaurantId);
    await client.query(
      `UPDATE restaurants SET booking_enabled = $2, window_days = $3, lead_minutes = $4, max_party = $5, updated_at = now(), updated_by = $6
        WHERE id = $1`,
      [input.restaurantId, input.bookingEnabled, input.windowDays, input.leadMinutes, input.maxParty, actor.id],
    );
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'restaurant_booking',
      entityId: input.restaurantId,
      before: rulesSnapshot(before),
      after: rulesSnapshot(await getRestaurantBooking(client, input.restaurantId)),
    });
    return { ok: true, data: null } as const;
  });
}
