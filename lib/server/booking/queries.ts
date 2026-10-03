import 'server-only';
import type { Pool } from 'pg';
import { findPlannedSlot, planDay, type PlannedPeriod } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES, type ReservationStatus } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import { escapeLike, parseSearch } from '@/lib/reservations/search';
import type { IsoDate } from '@/lib/venue-time';
import { loadBookingRules } from './rules';

/*
 * The admin's reservation reads. Keyset pagination (no OFFSET): the cursor
 * holds the sort key of the last row shown. Dates leave SQL through to_char
 * (node-pg would turn a `date` into a JS Date at the server's midnight), and
 * created_at travels as microseconds since the epoch (exact; a JS Date keeps
 * only milliseconds and would skip or repeat rows that share one).
 */

export const INBOX_PAGE_SIZE = 30;
export const INBOX_TABS = ['pending', 'today', 'upcoming', 'all'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export type InboxRow = {
  id: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  date: IsoDate;
  time: string;
  guests: number;
  name: string;
  phone: string;
  email: string | null;
  status: ReservationStatus;
  source: string;
  version: number;
  overCapacity: boolean;
  isTest: boolean;
  createdAt: Date;
  /** The row's sort key, opaque to the page. */
  cursor: string;
};

const SITTING_CURSOR = /^(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})_(\d{1,18})$/;
const CREATED_CURSOR = /^(\d{1,17})_(\d{1,18})$/;

const COLUMNS = `r.id::text, r.reference, r.restaurant_id AS "restaurantId", t.name AS "restaurantName",
  to_char(r.reserved_on, 'YYYY-MM-DD') AS date, r.reserved_at AS time, r.guests, r.guest_name AS name, r.phone, r.email,
  r.status, r.source, r.version, r.over_capacity AS "overCapacity", r.is_test AS "isTest", r.created_at AS "createdAt"`;

/**
 * One page of a tab, or of a search. Cần xử lý: requested, soonest sitting
 * first. Hôm nay: every booking of `today` (Da Nang's date). Sắp tới:
 * requested or confirmed after today. Tất cả: newest first. A search looks
 * through every booking, newest first, whatever the tab.
 */
export async function listInbox(
  pool: Pool,
  options: { tab: InboxTab; q?: string | null; after?: string | null; today: IsoDate },
): Promise<{ rows: InboxRow[]; next: string | null; searched: boolean }> {
  const search = parseSearch(options.q);
  const tab: InboxTab = search ? 'all' : options.tab;
  const bySitting = tab !== 'all';
  const where: string[] = [];
  const values: unknown[] = [];
  const param = (v: unknown) => `$${values.push(v)}`;

  if (tab === 'pending') where.push(`r.status = 'requested'`);
  if (tab === 'today') where.push(`r.reserved_on = ${param(options.today)}::date`);
  if (tab === 'upcoming') where.push(`r.reserved_on > ${param(options.today)}::date`, `r.status IN ('requested', 'confirmed')`);

  if (search?.kind === 'reference') where.push(`r.reference = ${param(search.value)}`);
  if (search?.kind === 'phone') where.push(`r.phone_e164 = ${param(search.value)}`);
  if (search?.kind === 'text') where.push(`r.search_text LIKE '%' || fold_search(${param(escapeLike(search.value))}) || '%'`);

  const cursor = options.after ?? '';
  if (bySitting) {
    const m = SITTING_CURSOR.exec(cursor);
    if (m) where.push(`(r.reserved_on, r.reserved_at, r.id) > (${param(m[1])}::date, ${param(m[2])}, ${param(m[3])}::bigint)`);
  } else {
    const m = CREATED_CURSOR.exec(cursor);
    if (m) {
      where.push(`(r.created_at, r.id) < (timestamptz 'epoch' + ${param(m[1])}::bigint * interval '1 microsecond', ${param(m[2])}::bigint)`);
    }
  }

  const order = bySitting ? 'r.reserved_on, r.reserved_at, r.id' : 'r.created_at DESC, r.id DESC';
  const key = bySitting
    ? `to_char(r.reserved_on, 'YYYY-MM-DD') || '_' || r.reserved_at || '_' || r.id::text`
    : `(extract(epoch FROM r.created_at) * 1000000)::bigint::text || '_' || r.id::text`;
  const { rows } = await pool.query<InboxRow>(
    `SELECT ${COLUMNS}, ${key} AS cursor
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT ${INBOX_PAGE_SIZE + 1}`,
    values,
  );
  const page = rows.slice(0, INBOX_PAGE_SIZE);
  return { rows: page, next: rows.length > INBOX_PAGE_SIZE ? page[page.length - 1].cursor : null, searched: search !== null };
}

export type ReservationDetail = Omit<InboxRow, 'cursor'> & {
  meal: Meal;
  note: string | null;
  locale: string;
  statusReason: string | null;
};

export async function getReservation(pool: Pool, id: string): Promise<ReservationDetail | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await pool.query<ReservationDetail>(
    `SELECT ${COLUMNS}, r.meal, r.note, r.locale, r.status_reason AS "statusReason"
       FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
      WHERE r.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export type ReservationEvent = {
  id: string;
  at: Date;
  actorKind: string;
  actorLabel: string | null;
  type: string;
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus | null;
  changes: Record<string, unknown> | null;
  reason: string | null;
};

/** The timeline of one booking, newest first. */
export async function listEvents(pool: Pool, reservationId: string): Promise<ReservationEvent[]> {
  const { rows } = await pool.query<ReservationEvent>(
    `SELECT id::text, at, actor_kind AS "actorKind", actor_label AS "actorLabel", type,
            from_status AS "fromStatus", to_status AS "toStatus", changes, reason
       FROM reservation_events WHERE reservation_id = $1 ORDER BY at DESC, id DESC`,
    [reservationId],
  );
  return rows;
}

export type ReservationNote = { id: string; authorLabel: string; body: string; createdAt: Date };

/** Internal notes, oldest first, for several bookings at once (the detail page, the day sheet). */
export async function listNotes(pool: Pool, reservationIds: readonly string[]): Promise<Map<string, ReservationNote[]>> {
  const out = new Map<string, ReservationNote[]>();
  if (reservationIds.length === 0) return out;
  const { rows } = await pool.query<ReservationNote & { reservationId: string }>(
    `SELECT id::text, reservation_id::text AS "reservationId", author_label AS "authorLabel", body, created_at AS "createdAt"
       FROM reservation_notes WHERE reservation_id = ANY ($1::bigint[]) ORDER BY created_at, id`,
    [[...reservationIds]],
  );
  for (const { reservationId, ...note } of rows) out.set(reservationId, [...(out.get(reservationId) ?? []), note]);
  return out;
}

/** /admin: requests waiting for staff (any date), and today's bookings and covers that hold seats. */
export async function overviewCounts(pool: Pool, today: IsoDate): Promise<{ pending: number; today: number; todayCovers: number }> {
  const { rows } = await pool.query<{ pending: number; today: number; todayCovers: number }>(
    `SELECT (SELECT count(*)::int FROM reservations WHERE status = 'requested') AS pending,
            count(*)::int AS today,
            coalesce(sum(guests), 0)::int AS "todayCovers"
       FROM reservations
      WHERE reserved_on = $1::date AND status = ANY ($2::text[])`,
    [today, HOLDING_STATUSES],
  );
  return rows[0];
}

/** Every restaurant, for the pickers of the new-booking and day-sheet screens. */
export async function listRestaurantOptions(pool: Pool): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>('SELECT id, name FROM restaurants ORDER BY sort_order, id');
  return rows;
}

/**
 * The destinations staff pick from (a closure's or a recipient's scope) and
 * the names the admin prints for them (R1: DESTS is gone): every venue,
 * published or not, by its name in the default language, in display order.
 * The teaser card ("Future Locations") is not a place, so it is left out.
 */
export async function listDestinationOptions(pool: Pool): Promise<{ id: string; name: string }[]> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT d.id, coalesce(dt.name, d.id) AS name
       FROM destinations d
       LEFT JOIN destination_i18n dt ON dt.destination_id = d.id AND dt.locale = (SELECT code FROM locales WHERE is_default)
      WHERE d.kind = 'venue'
      ORDER BY d.sort_order, d.id`,
  );
  return rows;
}

export type GuestContact = { reference: string; name: string; phone: string };

/** Whom to phone, and on which number, for these bookings, in the order of `ids` (a bulk cancel's unemailed guests). */
export async function listGuestContacts(pool: Pool, ids: readonly string[]): Promise<GuestContact[]> {
  if (ids.length === 0) return [];
  const { rows } = await pool.query<GuestContact>(
    `SELECT reference, guest_name AS name, phone FROM reservations WHERE id = ANY ($1::bigint[]) ORDER BY array_position($1::bigint[], id)`,
    [[...ids]],
  );
  return rows;
}

/** The languages a guest may speak, enabled on the site or not: staff record the guest's, the email follows it from phase 5. */
export async function listLocales(pool: Pool): Promise<{ code: string; name: string; isDefault: boolean }[]> {
  const { rows } = await pool.query<{ code: string; name: string; isDefault: boolean }>(
    `SELECT code, native_name AS name, is_default AS "isDefault" FROM locales ORDER BY sort_order, code`,
  );
  return rows;
}

// ── the day sheet (spec §7.2 "Bảng theo ngày", printable) ───────────────────

export type SheetRow = Omit<InboxRow, 'cursor'> & { meal: Meal; note: string | null };

export type DaySheetRestaurant = {
  id: string;
  name: string;
  /** The day's services from planDay, each slot with the covers held now. */
  periods: (Omit<PlannedPeriod, 'slots'> & { slots: { time: string; capacity: number; booked: number }[] })[];
  /** Bookings that still count (not cancelled or declined), by time. */
  reservations: SheetRow[];
  /** Those whose time is no longer a slot of the day (the hours changed after they were made). */
  outside: SheetRow[];
};

/** Every restaurant (or one) on a date: its services and slots with the covers held, and its bookings. */
export async function daySheet(pool: Pool, date: IsoDate, restaurantId?: string | null): Promise<DaySheetRestaurant[]> {
  const restaurants = (await listRestaurantOptions(pool)).filter((r) => !restaurantId || r.id === restaurantId);
  const ids = restaurants.map((r) => r.id);
  const [rules, bookings] = await Promise.all([
    loadBookingRules(pool, ids, 'vi', date),
    pool.query<SheetRow>(
      `SELECT ${COLUMNS}, r.meal, r.note
         FROM reservations r JOIN restaurants t ON t.id = r.restaurant_id
        WHERE r.reserved_on = $1::date AND r.restaurant_id = ANY ($2::text[]) AND r.status NOT IN ('cancelled', 'declined')
        ORDER BY r.reserved_at, r.id`,
      [date, ids],
    ),
  ]);
  return restaurants.flatMap((r) => {
    const loaded = rules.get(r.id);
    if (!loaded) return [];
    const plan = planDay(loaded.rules, date);
    const mine = bookings.rows.filter((b) => b.restaurantId === r.id);
    const booked: Record<string, number> = {};
    for (const b of mine) if ((HOLDING_STATUSES as readonly string[]).includes(b.status)) booked[b.time] = (booked[b.time] ?? 0) + b.guests;
    return [
      {
        id: r.id,
        name: r.name,
        periods: plan.periods.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s, booked: booked[s.time] ?? 0 })) })),
        reservations: mine,
        outside: mine.filter((b) => !findPlannedSlot(plan, b.time)),
      },
    ];
  });
}
