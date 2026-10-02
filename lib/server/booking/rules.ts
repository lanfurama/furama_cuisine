import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { HOLDING_STATUSES, type BookedCovers, type BookingRules, type GroupPhone } from '@/lib/booking/rules';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The booking rules as resolveDay and planDay read them, loaded live. Nothing
 * here is cached (spec §6.2 "Không cache: đặt bàn, availability"): a 'use
 * cache' entry does not persist on serverless and is revalidated per instance
 * (node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:247-252),
 * and submitReservation must re-read the rules under its lock anyway.
 *
 * Dates leave SQL through to_char: node-pg turns a `date` into a JS Date at
 * local midnight, which shifts the day on a UTC server.
 */

export type Db = Pool | PoolClient;

export type LoadedRules = { rules: BookingRules; groupPhone: GroupPhone | null };

type RulesRow = {
  id: string;
  name: string;
  destination: string;
  booking_enabled: boolean;
  window_days: number;
  lead_minutes: number;
  same_day_cutoff: string | null;
  max_party: number;
  auto_confirm: boolean;
  group_phone: GroupPhone | null;
  periods: BookingRules['periods'];
  closures: BookingRules['closures'];
};

/**
 * One round trip for any number of restaurants. `from` is the earliest date of
 * interest: closures that ended before it are left out. The closure reason is
 * the guest's language when that language is on (a reviewed row, or a machine
 * row with serve_machine), else the default language's; NULL when the closure
 * hides its reason. Unknown ids are simply missing from the map.
 */
export async function loadBookingRules(db: Db, restaurantIds: readonly string[], locale: string, from: IsoDate): Promise<Map<string, LoadedRules>> {
  const { rows } = await db.query<RulesRow>(
    `SELECT r.id, r.name, r.destination, r.booking_enabled,
            COALESCE(r.window_days, s.window_days)::int   AS window_days,
            COALESCE(r.lead_minutes, s.lead_minutes)::int AS lead_minutes,
            to_char(s.same_day_cutoff, 'HH24:MI')         AS same_day_cutoff,
            COALESCE(r.max_party, s.max_party)::int       AS max_party,
            COALESCE(r.auto_confirm, s.auto_confirm)      AS auto_confirm,
            (SELECT json_build_object('display', d.phone_display, 'tel', d.phone_e164)
               FROM destinations d
              WHERE d.phone_e164 IS NOT NULL
              ORDER BY (d.id = r.destination) DESC, d.sort_order, d.id
              LIMIT 1) AS group_phone,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', p.id::text, 'meal', p.meal, 'weekdays', p.weekdays,
                       'firstSeating', to_char(p.first_seating, 'HH24:MI'),
                       'lastSeating', to_char(p.last_seating, 'HH24:MI'),
                       'intervalMin', p.interval_min, 'coversPerSlot', p.covers_per_slot,
                       'sortOrder', p.sort_order)
                     ORDER BY p.sort_order, p.first_seating, p.id)
                FROM service_periods p
               WHERE p.restaurant_id = r.id AND p.active), '[]') AS periods,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', c.id::text, 'scope', c.scope,
                       'destinationId', c.destination_id, 'restaurantId', c.restaurant_id,
                       'startsOn', to_char(c.starts_on, 'YYYY-MM-DD'), 'endsOn', to_char(c.ends_on, 'YYYY-MM-DD'),
                       'meals', c.meals,
                       'publicReason', CASE WHEN c.show_reason THEN COALESCE(t.public_reason, d.public_reason) END)
                     ORDER BY c.starts_on, c.id)
                FROM closures c
                LEFT JOIN locales l ON l.code = $2 AND l.is_enabled
                LEFT JOIN closure_i18n t
                       ON t.closure_id = c.id AND t.locale = l.code AND (t.status = 'reviewed' OR l.serve_machine)
                LEFT JOIN closure_i18n d
                       ON d.closure_id = c.id AND d.locale = (SELECT code FROM locales WHERE is_default)
               WHERE c.ends_on >= $3::date
                 AND (c.scope = 'all'
                      OR (c.scope = 'destination' AND c.destination_id = r.destination)
                      OR (c.scope = 'restaurant' AND c.restaurant_id = r.id))), '[]') AS closures
       FROM restaurants r
      CROSS JOIN booking_settings s
      WHERE r.id = ANY ($1::text[])
      ORDER BY r.sort_order`,
    [restaurantIds, locale, from],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        rules: {
          restaurantId: r.id,
          restaurantName: r.name,
          destinationId: r.destination,
          bookingEnabled: r.booking_enabled,
          windowDays: r.window_days,
          leadMinutes: r.lead_minutes,
          sameDayCutoff: r.same_day_cutoff,
          maxParty: r.max_party,
          autoConfirm: r.auto_confirm,
          periods: r.periods,
          closures: r.closures,
        },
        groupPhone: r.group_phone,
      },
    ]),
  );
}

/** loadBookingRules for one restaurant; null when it does not exist. */
export async function loadRestaurantRules(db: Db, restaurantId: string, locale: string, from: IsoDate): Promise<LoadedRules | null> {
  return (await loadBookingRules(db, [restaurantId], locale, from)).get(restaurantId) ?? null;
}

/** Covers held per date and "HH:MM" for one restaurant, from..to inclusive (holding statuses only). */
export async function loadBookedCovers(db: Db, restaurantId: string, from: IsoDate, to: IsoDate): Promise<Record<IsoDate, BookedCovers>> {
  const { rows } = await db.query<{ day: string; reserved_at: string; covers: number }>(
    `SELECT to_char(reserved_on, 'YYYY-MM-DD') AS day, reserved_at, SUM(guests)::int AS covers
       FROM reservations
      WHERE restaurant_id = $1 AND reserved_on BETWEEN $2::date AND $3::date AND status = ANY ($4::text[])
      GROUP BY reserved_on, reserved_at`,
    [restaurantId, from, to, HOLDING_STATUSES],
  );
  const out: Record<IsoDate, BookedCovers> = {};
  for (const row of rows) (out[row.day] ??= {})[row.reserved_at] = row.covers;
  return out;
}
