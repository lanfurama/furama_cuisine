import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { formatDateTimeVi } from '@/lib/admin/format';
import { seatings } from '@/lib/booking/resolve-day';
import type { PeriodRule } from '@/lib/booking/rules';
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { writeChangedTranslations, type ItemDef } from '@/lib/server/content-admin/snapshot';
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

export type Conflict = { ok: false; code: 'conflict'; params: { by: string; at: string } };
type NotFound = { ok: false; code: 'not_found' };
type Invalid = { ok: false; code: 'invalid'; fieldErrors: Record<string, string[]> };

/** "Vừa được {tên} thay đổi lúc {giờ}": updated_by holds the staff id (spec §5.1.6). */
export async function conflictBy(client: PoolClient, staffId: string | null, at: Date): Promise<Conflict> {
  const { rows } = staffId ? await client.query<{ name: string }>('SELECT name FROM staff_user WHERE id = $1', [staffId]) : { rows: [] };
  return { ok: false, code: 'conflict', params: { by: rows[0]?.name ?? 'người khác', at: formatDateTimeVi(at) } };
}

/**
 * A conflict on a record with a History (spec §7.5): named for the newest
 * audit row of that record (entity_id null: a list's order), which is who
 * changed it last, even by a write that leaves the row's updated_by alone
 * (R19: a restaurant's rename rewrites its card picture's alt; a string
 * reset to its default has no row left) or that is not the row's own (a
 * reorder). With no History yet, the row's updated_by (7A review).
 */
export async function conflictFromHistory(
  client: PoolClient,
  entityType: string,
  entityId: string | null,
  fallback: { by: string | null; at: Date },
): Promise<Conflict> {
  const { rows } = await client.query<{ actor_id: string | null; at: Date }>(
    `SELECT actor_id, at FROM audit_log WHERE entity_type = $1 AND entity_id IS NOT DISTINCT FROM $2 ORDER BY at DESC, id DESC LIMIT 1`,
    [entityType, entityId],
  );
  return rows[0] ? conflictBy(client, rows[0].actor_id, rows[0].at) : conflictBy(client, fallback.by, fallback.at);
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

const RESTAURANT_COLUMNS = `id, name, destination_id AS "destinationId", booking_enabled AS "bookingEnabled",
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

// ── auto_confirm per restaurant (Admin: reservations:auto-confirm) ──────────

/** null follows booking_settings.auto_confirm. */
export async function saveAutoConfirm(
  pool: Pool,
  actor: AuditActor,
  input: { restaurantId: string; token: string; autoConfirm: boolean | null },
): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockRestaurant(client, input.restaurantId, input.token);
    if (locked) return locked;
    const before = await getRestaurantBooking(client, input.restaurantId);
    await client.query('UPDATE restaurants SET auto_confirm = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [
      input.restaurantId,
      input.autoConfirm,
      actor.id,
    ]);
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'restaurant_booking',
      entityId: input.restaurantId,
      before: { auto_confirm: before?.autoConfirm ?? null },
      after: { auto_confirm: input.autoConfirm },
    });
    return { ok: true, data: null } as const;
  });
}

// ── booking_settings (Admin: settings:update) ───────────────────────────────

export async function saveBookingSettings(pool: Pool, actor: AuditActor, input: BookingSettings): Promise<{ ok: true; data: null } | Conflict> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
      `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM booking_settings FOR UPDATE`,
    );
    if (rows[0]?.token !== input.token) return conflictBy(client, rows[0]?.updated_by ?? null, rows[0]?.updated_at ?? new Date());
    const { token: _before, ...before } = await getBookingSettings(client);
    await client.query(
      `UPDATE booking_settings
          SET window_days = $1, lead_minutes = $2, same_day_cutoff = $3::time, max_party = $4, auto_confirm = $5,
              guest_ack_email = $6, pii_retention_months = $7, updated_at = now(), updated_by = $8`,
      [input.windowDays, input.leadMinutes, input.sameDayCutoff, input.maxParty, input.autoConfirm, input.guestAckEmail, input.piiRetentionMonths, actor.id],
    );
    const { token: _after, ...after } = await getBookingSettings(client);
    await insertAudit(client, actor, { action: 'settings', entityType: 'booking_settings', entityId: null, before, after });
    return { ok: true, data: null } as const;
  });
}

// ── closures (schedule:update) ──────────────────────────────────────────────

export type ClosureScope = { scope: 'all' | 'destination' | 'restaurant'; destinationId: string | null; restaurantId: string | null };

export type ClosureInput = ClosureScope & {
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** null: the whole day. */
  meals: Meal[] | null;
  showReason: boolean;
  /** locale → the guest-facing reason (closure_i18n.public_reason); a blank one is left out. */
  publicReason: Record<string, string>;
  internalNote: string | null;
};

export type ClosureView = ClosureInput & { id: string; token: string };

const CLOSURE_COLUMNS = `c.id::text, c.scope, c.destination_id AS "destinationId", c.restaurant_id AS "restaurantId",
  to_char(c.starts_on, 'YYYY-MM-DD') AS "startsOn", to_char(c.ends_on, 'YYYY-MM-DD') AS "endsOn", c.meals,
  c.show_reason AS "showReason", c.internal_note AS "internalNote",
  coalesce((SELECT jsonb_object_agg(i.locale, i.public_reason) FROM closure_i18n i WHERE i.closure_id = c.id), '{}'::jsonb) AS "publicReason",
  ${US('c.updated_at')} AS token`;

/** The closures that have not ended before `from`, soonest first. */
export async function listClosures(db: Db, from: IsoDate): Promise<ClosureView[]> {
  const { rows } = await db.query<ClosureView>(`SELECT ${CLOSURE_COLUMNS} FROM closures c WHERE c.ends_on >= $1::date ORDER BY c.starts_on, c.id`, [from]);
  return rows;
}

type LockedClosure = ClosureView & { updatedBy: string | null; updatedAt: Date };

async function lockClosure(client: PoolClient, id: string): Promise<LockedClosure | null> {
  const { rows } = await client.query<LockedClosure>(
    `SELECT ${CLOSURE_COLUMNS}, c.updated_by AS "updatedBy", c.updated_at AS "updatedAt" FROM closures c WHERE c.id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

/** The closure as audit_log keeps it: the same keys before and after. */
async function closureSnapshot(client: PoolClient, id: string): Promise<ClosureInput | null> {
  const { rows } = await client.query<ClosureView>(`SELECT ${CLOSURE_COLUMNS} FROM closures c WHERE c.id = $1`, [id]);
  if (!rows[0]) return null;
  const { id: _id, token: _token, ...snapshot } = rows[0];
  return snapshot;
}

/** closure_i18n as a translation table, for writeChangedTranslations (the closure row itself is written here). */
const CLOSURE_TEXT: ItemDef = {
  entityType: 'closure',
  table: 'closures',
  idType: 'bigint',
  columns: [],
  i18n: { table: 'closure_i18n', fk: 'closure_id', columns: ['public_reason'] },
  tables: [],
};

/**
 * The guest-facing reason in each language the form posted (phase 4 ledger
 * T13): only a language whose text changed is written, reviewed by this
 * member of staff (spec §5.1.4); an emptied one is deleted, English included
 * (no language needs a reason); a language the form did not post keeps its
 * row, a machine translation among them.
 */
async function writeReasons(client: PoolClient, actorId: string, closureId: string, reasons: Record<string, string>) {
  await writeChangedTranslations(
    client,
    CLOSURE_TEXT,
    closureId,
    Object.fromEntries(Object.entries(reasons).map(([locale, reason]) => [locale, { public_reason: reason.trim() || null }])),
    actorId,
    { defaultMayBeEmpty: true },
  );
}

export async function createClosure(pool: Pool, actor: AuditActor, input: ClosureInput): Promise<{ ok: true; data: { id: string } }> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO closures (scope, destination_id, restaurant_id, starts_on, ends_on, meals, show_reason, internal_note, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, $5::date, $6::text[], $7, $8, $9, $9)
       RETURNING id::text`,
      [input.scope, input.destinationId, input.restaurantId, input.startsOn, input.endsOn, input.meals, input.showReason, input.internalNote, actor.id],
    );
    const id = rows[0].id;
    await writeReasons(client, actor.id, id, input.publicReason);
    await insertAudit(client, actor, { action: 'create', entityType: 'closure', entityId: id, after: await closureSnapshot(client, id) });
    return { ok: true, data: { id } } as const;
  });
}

export async function updateClosure(
  pool: Pool,
  actor: AuditActor,
  input: ClosureInput & { id: string; token: string },
): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockClosure(client, input.id);
    if (!locked) return { ok: false, code: 'not_found' } as const;
    if (locked.token !== input.token) return conflictBy(client, locked.updatedBy, locked.updatedAt);
    const before = await closureSnapshot(client, input.id);
    await client.query(
      `UPDATE closures SET scope = $2, destination_id = $3, restaurant_id = $4, starts_on = $5::date, ends_on = $6::date,
              meals = $7::text[], show_reason = $8, internal_note = $9, updated_at = now(), updated_by = $10
        WHERE id = $1`,
      [input.id, input.scope, input.destinationId, input.restaurantId, input.startsOn, input.endsOn, input.meals, input.showReason, input.internalNote, actor.id],
    );
    await writeReasons(client, actor.id, input.id, input.publicReason);
    await insertAudit(client, actor, { action: 'update', entityType: 'closure', entityId: input.id, before, after: await closureSnapshot(client, input.id) });
    return { ok: true, data: null } as const;
  });
}

export async function deleteClosure(
  pool: Pool,
  actor: AuditActor,
  input: { id: string; token: string },
): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockClosure(client, input.id);
    if (!locked) return { ok: false, code: 'not_found' } as const;
    if (locked.token !== input.token) return conflictBy(client, locked.updatedBy, locked.updatedAt);
    const before = await closureSnapshot(client, input.id);
    await client.query('DELETE FROM closures WHERE id = $1', [input.id]);
    await insertAudit(client, actor, { action: 'delete', entityType: 'closure', entityId: input.id, before });
    return { ok: true, data: null } as const;
  });
}

/** The restaurants a closure's scope reaches, for their booking-rules:<id> tags. */
export async function restaurantsInScope(db: Db, scope: ClosureScope): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM restaurants
      WHERE $1 = 'all' OR ($1 = 'destination' AND destination_id = $2) OR ($1 = 'restaurant' AND id = $3)
      ORDER BY sort_order, id`,
    [scope.scope, scope.destinationId, scope.restaurantId],
  );
  return rows.map((r) => r.id);
}
