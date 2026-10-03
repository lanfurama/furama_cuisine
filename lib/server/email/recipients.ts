import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { StaffEmailEventName } from '@/lib/email/events';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import { US, conflictBy, type Conflict } from '@/lib/server/booking/config';
import { loadSiteSettings } from '@/lib/server/content/settings.queries';

/*
 * Who receives staff notifications (spec §5.2 notification_recipients, §10.4),
 * and the shared inbox that receives them when nobody matches
 * (site_settings.email). Admin only (spec §7.1 "Cài đặt … thông báo"):
 * settings:read / settings:update. Saves follow spec §7.4: one transaction
 * with its audit_log row, optimistic concurrency on updated_at (the token).
 */

type Db = Pool | PoolClient;
type NotFound = { ok: false; code: 'not_found' };
/** The same address on the same target already exists (notification_recipients_target_email_idx). */
type Duplicate = { ok: false; code: 'duplicate' };

/**
 * SQL: notification_recipients row `n` reaches a booking at the restaurant
 * whose id and destination are the given SQL expressions: a row for that
 * restaurant, for its destination (restaurants.destination_id), or for 'all'
 * (spec §10.4, R4). The one definition: the queue (outbox.ts queueStaffNew)
 * and the overview's "Nhà hàng chưa có người nhận thông báo" both use it, so
 * they can never disagree about who hears about a booking. Callers add
 * `n.active AND 'staff.new' = ANY (n.events)`.
 */
export const reachesSql = (n: string, restaurantId: string, destination: string): string =>
  `(${n}.scope = 'all' OR (${n}.scope = 'destination' AND ${n}.destination_id = ${destination})` +
  ` OR (${n}.scope = 'restaurant' AND ${n}.restaurant_id = ${restaurantId}))`;

/** Restaurants taking online bookings that no active staff.new recipient reaches: their staff.new goes to the shared inbox (R21). */
export async function restaurantsWithoutRecipient(db: Db): Promise<{ id: string; name: string }[]> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT r.id, r.name FROM restaurants r
      WHERE r.booking_enabled
        AND NOT EXISTS (SELECT 1 FROM notification_recipients n
                         WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'r.id', 'r.destination_id')})
      ORDER BY r.sort_order, r.id`,
  );
  return rows;
}

// ── the recipients ─────────────────────────────────────────────────────────

export type RecipientScope = 'all' | 'destination' | 'restaurant';

export type RecipientInput = {
  scope: RecipientScope;
  destinationId: string | null;
  restaurantId: string | null;
  email: string;
  events: StaffEmailEventName[];
  locale: string;
  active: boolean;
};

export type Recipient = RecipientInput & { id: string; token: string; restaurantName: string | null };

const COLUMNS = `n.id::text, n.scope, n.destination_id AS "destinationId", n.restaurant_id AS "restaurantId", n.email, n.events,
  n.locale, n.active, t.name AS "restaurantName", ${US('n.updated_at')} AS token`;

/** Every recipient: the widest scope first, then by target and address. */
export async function listRecipients(db: Db): Promise<Recipient[]> {
  const { rows } = await db.query<Recipient>(
    `SELECT ${COLUMNS}
       FROM notification_recipients n LEFT JOIN restaurants t ON t.id = n.restaurant_id
      ORDER BY CASE n.scope WHEN 'all' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END,
               n.destination_id NULLS FIRST, t.sort_order NULLS FIRST, lower(n.email), n.id`,
  );
  return rows;
}

/** The row as audit_log keeps it: the same keys before and after, no token. */
async function snapshot(client: PoolClient, id: string): Promise<RecipientInput | null> {
  const { rows } = await client.query<Recipient>(
    `SELECT ${COLUMNS} FROM notification_recipients n LEFT JOIN restaurants t ON t.id = n.restaurant_id WHERE n.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { id: _id, token: _token, restaurantName: _name, ...rest } = rows[0];
  return rest;
}

const isDuplicate = (err: unknown) => (err as { constraint?: string } | null)?.constraint === 'notification_recipients_target_email_idx';

export async function createRecipient(pool: Pool, actor: AuditActor, input: RecipientInput): Promise<{ ok: true; data: { id: string } } | Duplicate> {
  try {
    return await withTransaction(pool, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO notification_recipients (scope, destination_id, restaurant_id, email, events, locale, active, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $8) RETURNING id::text`,
        [input.scope, input.destinationId, input.restaurantId, input.email, input.events, input.locale, input.active, actor.id],
      );
      const id = rows[0].id;
      await insertAudit(client, actor, { action: 'create', entityType: 'notification_recipient', entityId: id, after: await snapshot(client, id) });
      return { ok: true, data: { id } } as const;
    });
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, code: 'duplicate' };
    throw err;
  }
}

async function lockRecipient(client: PoolClient, id: string, token: string): Promise<NotFound | Conflict | null> {
  const { rows } = await client.query<{ token: string; updated_by: string | null; updated_at: Date }>(
    `SELECT ${US('updated_at')} AS token, updated_by, updated_at FROM notification_recipients WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) return { ok: false, code: 'not_found' };
  if (rows[0].token !== token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
  return null;
}

export async function updateRecipient(
  pool: Pool,
  actor: AuditActor,
  input: RecipientInput & { id: string; token: string },
): Promise<{ ok: true; data: null } | NotFound | Conflict | Duplicate> {
  try {
    return await withTransaction(pool, async (client) => {
      const locked = await lockRecipient(client, input.id, input.token);
      if (locked) return locked;
      const before = await snapshot(client, input.id);
      await client.query(
        `UPDATE notification_recipients
            SET scope = $2, destination_id = $3, restaurant_id = $4, email = $5, events = $6::text[], locale = $7, active = $8,
                updated_at = now(), updated_by = $9
          WHERE id = $1`,
        [input.id, input.scope, input.destinationId, input.restaurantId, input.email, input.events, input.locale, input.active, actor.id],
      );
      await insertAudit(client, actor, {
        action: 'update',
        entityType: 'notification_recipient',
        entityId: input.id,
        before,
        after: await snapshot(client, input.id),
      });
      return { ok: true, data: null } as const;
    });
  } catch (err) {
    if (isDuplicate(err)) return { ok: false, code: 'duplicate' };
    throw err;
  }
}

export async function deleteRecipient(pool: Pool, actor: AuditActor, input: { id: string; token: string }): Promise<{ ok: true; data: null } | NotFound | Conflict> {
  return withTransaction(pool, async (client) => {
    const locked = await lockRecipient(client, input.id, input.token);
    if (locked) return locked;
    const before = await snapshot(client, input.id);
    await client.query('DELETE FROM notification_recipients WHERE id = $1', [input.id]);
    await insertAudit(client, actor, { action: 'delete', entityType: 'notification_recipient', entityId: input.id, before });
    return { ok: true, data: null } as const;
  });
}

// ── the shared inbox (site_settings.email) ─────────────────────────────────

export async function getSharedInbox(db: Db): Promise<{ email: string; token: string }> {
  const settings = await loadSiteSettings(db);
  if (!settings) throw new Error('site_settings has no row (migration 007 seeds it)');
  return { email: settings.email, token: settings.token };
}

/**
 * R3: the same address is the general email of the site footer and the
 * privacy page (site_settings, read by the guest site under content:contact):
 * the action expires that tag after this commits (saveInbox).
 */
export async function saveSharedInbox(pool: Pool, actor: AuditActor, input: { email: string; token: string }): Promise<{ ok: true; data: null } | Conflict> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ email: string; token: string; updated_by: string | null; updated_at: Date }>(
      `SELECT email, ${US('updated_at')} AS token, updated_by, updated_at FROM site_settings WHERE id FOR UPDATE`,
    );
    if (rows[0].token !== input.token) return conflictBy(client, rows[0].updated_by, rows[0].updated_at);
    await client.query('UPDATE site_settings SET email = $1, updated_at = now(), updated_by = $2 WHERE id', [input.email, actor.id]);
    await insertAudit(client, actor, {
      action: 'settings',
      entityType: 'site_settings',
      entityId: null,
      before: { email: rows[0].email },
      after: { email: input.email },
    });
    return { ok: true, data: null } as const;
  });
}
