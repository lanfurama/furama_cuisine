import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { EmailAudience, EmailEvent, EmailStatus } from '@/lib/email/events';
import { insertAudit, withTransaction, type AuditActor } from '@/lib/server/audit';
import type { OutboxEnv } from './env';
import { restaurantsWithoutRecipient } from './recipients';

/*
 * What staff see of email_outbox (spec §7.2 /admin/reservations/emails, the
 * booking's own emails, the overview), and the one write they make on it,
 * "Gửi lại". Every read and the write are limited to this deployment's env: a
 * Preview's branch carries production's rows, and must neither show them as
 * its own nor send them. Email history lives here only (R2): no
 * reservation_events row, ever.
 *
 * created_at travels as microseconds since the epoch in the cursor (exact; a
 * JS Date keeps only milliseconds), like the reservations inbox.
 */

type Db = Pool | PoolClient;

export const EMAIL_LOG_PAGE_SIZE = 50;
export const EMAIL_LOG_TABS = ['all', 'failed', 'queued', 'sent', 'skipped'] as const;
export type EmailLogTab = (typeof EMAIL_LOG_TABS)[number];

export type EmailLogRow = {
  id: string;
  event: EmailEvent;
  audience: EmailAudience;
  reservationId: string;
  reference: string;
  restaurantName: string;
  toEmail: string;
  locale: string;
  status: EmailStatus;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  cursor: string;
};

const COLUMNS = `o.id::text, o.event, o.audience, o.reservation_id::text AS "reservationId", r.reference, t.name AS "restaurantName",
  o.to_email AS "toEmail", o.locale, o.status, o.attempts::int,
  o.next_attempt_at AS "nextAttemptAt", o.last_error AS "lastError", o.sent_at AS "sentAt", o.created_at AS "createdAt",
  (extract(epoch FROM o.created_at) * 1000000)::bigint::text || '_' || o.id::text AS cursor`;

const FROM = `email_outbox o JOIN reservations r ON r.id = o.reservation_id JOIN restaurants t ON t.id = r.restaurant_id`;
const CURSOR = /^(\d{1,17})_(\d{1,18})$/;

/** The statuses one tab shows: "Đang chờ" includes a row a sender holds right now. */
const TAB_STATUSES: Record<Exclude<EmailLogTab, 'all'>, EmailStatus[]> = {
  failed: ['failed'],
  queued: ['queued', 'sending'],
  sent: ['sent'],
  skipped: ['skipped'],
};

/** One page of the log, newest first; `tab` filters by status, `after` is the previous page's cursor. */
export async function listEmailLog(
  db: Db,
  options: { env: OutboxEnv; tab: EmailLogTab; after?: string | null },
): Promise<{ rows: EmailLogRow[]; next: string | null }> {
  const values: unknown[] = [options.env];
  const where = ['o.env = $1'];
  if (options.tab !== 'all') where.push(`o.status = ANY ($${values.push(TAB_STATUSES[options.tab])}::text[])`);
  const m = CURSOR.exec(options.after ?? '');
  if (m) {
    where.push(
      `(o.created_at, o.id) < (timestamptz 'epoch' + $${values.push(m[1])}::bigint * interval '1 microsecond', $${values.push(m[2])}::bigint)`,
    );
  }
  const { rows } = await db.query<EmailLogRow>(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, o.id DESC LIMIT ${EMAIL_LOG_PAGE_SIZE + 1}`,
    values,
  );
  const page = rows.slice(0, EMAIL_LOG_PAGE_SIZE);
  return { rows: page, next: rows.length > EMAIL_LOG_PAGE_SIZE ? page[page.length - 1].cursor : null };
}

/** The emails of one booking, oldest first (the booking's page). */
export async function listReservationEmails(db: Db, reservationId: string, env: OutboxEnv): Promise<EmailLogRow[]> {
  const { rows } = await db.query<EmailLogRow>(`SELECT ${COLUMNS} FROM ${FROM} WHERE o.reservation_id = $1 AND o.env = $2 ORDER BY o.created_at, o.id`, [
    reservationId,
    env,
  ]);
  return rows;
}

/**
 * The overview's email block (spec §7.2, §10.4 "hiện trên Tổng quan", §12,
 * R21): this env's emails that used up their attempts, and the restaurants
 * taking bookings whose staff.new goes to the shared inbox.
 */
export async function emailOverview(db: Db, env: OutboxEnv): Promise<{ failed: number; unrouted: { id: string; name: string }[] }> {
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM email_outbox WHERE env = $1 AND status = 'failed'`, [env]);
  return { failed: rows[0].n, unrouted: await restaurantsWithoutRecipient(db) };
}

/** A row "Gửi lại" may touch: one that failed for good, or one waiting for its next attempt. */
export const resendable = (status: EmailStatus) => status === 'failed' || status === 'queued';

export type RequeueResult =
  | { ok: true; data: { id: string; reservationId: string } }
  | { ok: false; code: 'not_found' }
  /** Sent or skipped (nothing to resend), or a sender holds it right now. */
  | { ok: false; code: 'not_allowed' };

/**
 * "Gửi lại" (C9, R2, R6): a failed row goes back to the queue with fresh
 * attempts (a new ≈19.4-hour schedule; it reached no one, so the same
 * Message-ID); a waiting row is simply due now. The decision is made on the
 * row locked FOR UPDATE, never on an earlier read, so a row a sender claimed
 * meanwhile ('sending') is refused, not pulled out from under it. Sent and
 * skipped rows are refused: sending those again would be a new email. One
 * audit_log row in the same transaction, with no address in it; the caller
 * drains the row after COMMIT.
 */
export async function requeueEmail(pool: Pool, actor: AuditActor, input: { id: string; env: OutboxEnv }): Promise<RequeueResult> {
  return withTransaction(pool, async (client): Promise<RequeueResult> => {
    const { rows } = await client.query<{ status: EmailStatus; attempts: number; reservation_id: string }>(
      `SELECT status, attempts::int, reservation_id::text FROM email_outbox WHERE id = $1 AND env = $2 FOR UPDATE`,
      [input.id, input.env],
    );
    const row = rows[0];
    if (!row) return { ok: false, code: 'not_found' };
    if (!resendable(row.status)) return { ok: false, code: 'not_allowed' };
    await client.query(
      `UPDATE email_outbox
          SET status = 'queued', next_attempt_at = now(), locked_until = NULL, updated_at = now(),
              attempts = CASE WHEN status = 'failed' THEN 0 ELSE attempts END
        WHERE id = $1`,
      [input.id],
    );
    await insertAudit(client, actor, {
      action: 'update',
      entityType: 'email_outbox',
      entityId: input.id,
      before: { status: row.status, attempts: row.attempts },
      after: { status: 'queued' },
    });
    return { ok: true, data: { id: input.id, reservationId: row.reservation_id } };
  });
}
