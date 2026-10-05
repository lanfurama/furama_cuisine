import 'server-only';
import type { Pool } from 'pg';
import { closureApplies, findPlannedSlot, planDay, type PlannedPeriod } from '@/lib/booking/resolve-day';
import type { BookingRules, ClosureRule, ReservationStatus } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import { UPCOMING_STATUSES } from '@/lib/reservations/lifecycle';
import { minutesUntil, venueNow, type IsoDate } from '@/lib/venue-time';
import { loadBookedCovers, loadBookingRules } from './rules';

/*
 * "Affected reservations" (spec §10.1): upcoming bookings (requested or
 * confirmed, sitting not started) that the rules as they are now leave out:
 * a closure takes out their service, the hours no longer include their time,
 * or their slot holds more covers (every holding status counts) than its new
 * capacity. Worked out with the engine's planDay and closureApplies, never
 * stored, and never acted on: staff tick and cancel.
 */

export type AffectedKind = 'closed' | 'outside_hours' | 'over_capacity';

/**
 * Why a booking is listed, for staff. A slot over its capacity is not always
 * a "new capacity": staff may have overbooked it on purpose, with a reason,
 * and the list then names that slot too (phase-4 ledger T11).
 */
export const AFFECTED_WHY: Record<AffectedKind, string> = {
  closed: 'Rơi vào ngày đóng cửa',
  outside_hours: 'Ngoài giờ phục vụ mới',
  over_capacity: 'Khung giờ đang có nhiều khách hơn sức chứa',
};

export type AffectedReservation = {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  status: ReservationStatus;
  version: number;
  /** The guest gave an email: a cancel with "Báo khách qua email" ticked sends them the reason (R8). */
  hasEmail: boolean;
  kind: AffectedKind;
  /** For `closed`: the closure that takes the sitting out. */
  closureId: string | null;
};

type Row = Omit<AffectedReservation, 'kind' | 'closureId'> & { meal: Meal };

/** Staff screens never show a closure's public reason, so any language reads the same rules. */
const STAFF_LOCALE = 'vi';

/** The upcoming bookings in range whose sitting has not started yet. */
async function upcoming(pool: Pool, options: { restaurantIds?: readonly string[]; from: IsoDate; to?: IsoDate; now: Date }): Promise<Row[]> {
  const { rows } = await pool.query<Row>(
    `SELECT r.id::text, r.reference, r.restaurant_id AS "restaurantId", t.name AS "restaurantName",
            to_char(r.reserved_on, 'YYYY-MM-DD') AS date, r.reserved_at AS time, r.guests, r.guest_name AS name, r.phone,
            r.status, r.version, r.meal, coalesce(r.email, '') <> '' AS "hasEmail"
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.status = ANY ($1::text[]) AND r.reserved_on >= $2::date
        AND ($3::date IS NULL OR r.reserved_on <= $3::date)
        AND ($4::text[] IS NULL OR r.restaurant_id = ANY ($4::text[]))
      ORDER BY r.reserved_on, r.reserved_at, r.id`,
    [UPCOMING_STATUSES, options.from, options.to ?? null, options.restaurantIds ? [...options.restaurantIds] : null],
  );
  // A sitting that has started is the service's to settle (seated, no-show), not a schedule problem.
  return rows.filter((r) => minutesUntil(r.date, r.time, options.now) >= 0);
}

/** One day's plan per restaurant and date, worked out once. */
function planner(rules: Map<string, { rules: BookingRules }>) {
  const plans = new Map<string, { periods: PlannedPeriod[] }>();
  return (restaurantId: string, date: IsoDate) => {
    const key = `${restaurantId}|${date}`;
    let plan = plans.get(key);
    if (!plan) {
      const loaded = rules.get(restaurantId);
      plan = loaded ? planDay(loaded.rules, date) : { periods: [] };
      plans.set(key, plan);
    }
    return plan;
  };
}

const affected = ({ meal: _meal, ...row }: Row, kind: AffectedKind, closureId: string | null): AffectedReservation => ({ ...row, kind, closureId });

/**
 * Rules mode: every upcoming booking (of these restaurants, from..to) the
 * current rules leave out. Closure mode (`closureId`): every upcoming booking
 * that one closure takes out, even one another closure also covers.
 */
export async function findAffected(
  pool: Pool,
  options: { restaurantIds?: readonly string[]; from?: IsoDate; to?: IsoDate; closureId?: string; now?: Date } = {},
): Promise<AffectedReservation[]> {
  const now = options.now ?? new Date();
  if (options.closureId) return closureAffected(pool, options.closureId, now);
  const from = options.from ?? venueNow(now).date;
  const rows = await upcoming(pool, { ...options, from, now });
  if (rows.length === 0) return [];

  const restaurantIds = [...new Set(rows.map((r) => r.restaurantId))];
  const last = rows[rows.length - 1].date;
  const [rules, covers] = await Promise.all([
    loadBookingRules(pool, restaurantIds, STAFF_LOCALE, from),
    Promise.all(restaurantIds.map(async (id) => [id, await loadBookedCovers(pool, id, from, last)] as const)),
  ]);
  const held = new Map(covers);
  const planOf = planner(rules);

  return rows.flatMap((row): AffectedReservation[] => {
    const loaded = rules.get(row.restaurantId);
    const hit = findPlannedSlot(planOf(row.restaurantId, row.date), row.time);
    if (!loaded || !hit) return [affected(row, 'outside_hours', null)];
    if (hit.period.closed) {
      // The closure planDay applied: a whole-day one first, else one of this meal.
      const reaching = loaded.rules.closures.filter((c) => closureApplies(c, loaded.rules, row.date));
      const closure = reaching.find((c) => c.meals === null) ?? reaching.find((c) => c.meals?.includes(hit.period.meal));
      return [affected(row, 'closed', closure?.id ?? null)];
    }
    const booked = held.get(row.restaurantId)?.[row.date]?.[row.time] ?? 0;
    return booked > hit.capacity ? [affected(row, 'over_capacity', null)] : [];
  });
}

/** One closure's list: its scope (closureApplies, the engine's own rule), its dates, and the meal of each booking's slot. */
async function closureAffected(pool: Pool, closureId: string, now: Date): Promise<AffectedReservation[]> {
  const { rows: found } = await pool.query<ClosureRule>(
    `SELECT id::text, scope, destination_id AS "destinationId", restaurant_id AS "restaurantId",
            to_char(starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(ends_on, 'YYYY-MM-DD') AS "endsOn", meals, NULL AS "publicReason"
       FROM closures WHERE id = $1`,
    [closureId],
  );
  const closure = found[0];
  if (!closure) return [];
  const today = venueNow(now).date;
  const from = closure.startsOn > today ? closure.startsOn : today;
  const rows = await upcoming(pool, { from, to: closure.endsOn, now });
  if (rows.length === 0) return [];
  const rules = await loadBookingRules(pool, [...new Set(rows.map((r) => r.restaurantId))], STAFF_LOCALE, from);
  const planOf = planner(rules);
  return rows.flatMap((row) => {
    const loaded = rules.get(row.restaurantId);
    if (!loaded || !closureApplies(closure, loaded.rules, row.date)) return [];
    // The meal of the slot as the day is planned now; the booking's own meal for a time the hours no longer have.
    const meal = findPlannedSlot(planOf(row.restaurantId, row.date), row.time)?.period.meal ?? row.meal;
    return closure.meals === null || closure.meals.includes(meal) ? [affected(row, 'closed', closure.id)] : [];
  });
}
