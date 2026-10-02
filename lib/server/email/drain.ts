import 'server-only';
import type { Pool } from 'pg';
import { getPool } from '@/db/client';
import { EVENT_STATUSES, type EmailEvent } from '@/lib/email/events';
import { loadBookingEmailData, type BookingEmailData } from './booking/load';
import { renderOutboxEmail } from './booking/render';
import { outboxEnv } from './env';
import { openMailer, senderDomain, type EmailDeps, type Mailer } from './send';
import { EmailSendError, describeEmailError, type SendEmailResult } from './types';

/*
 * The outbox sender (spec §10.4). Called by after() once a booking change has
 * committed, by the cron every 5 minutes, and by "Gửi lại".
 *
 * SMTP has no idempotency key, so delivery is AT LEAST ONCE (R1):
 *   1. claim one due row: FOR UPDATE SKIP LOCKED, then status 'sending', a
 *      lease (locked_until), attempts + 1, and a Message-ID fixed for good;
 *   2. re-read the booking: an event that no longer matches its status is
 *      marked skipped, never sent (R7);
 *   3. send over SMTP, holding no database connection meanwhile;
 *   4. mark it sent, or schedule the next attempt, fenced by `attempts` so a
 *      drain whose lease ran out cannot overwrite a newer claim.
 * A crash between 3 and 4 leaves the row 'sending' until the lease ends; the
 * next drain sends it again with the same Message-ID. Two drains never claim
 * the same row while its lease holds. Rows are claimed one at a time, so the
 * lease only has to cover one send. Every statement is autocommitted (code
 * rule 2). Log lines carry ids, events, codes and attempts, never an address.
 */

/** Wait after failed attempt n (1-based): 1 m, 5 m, 15 m, 1 h, 6 h, 12 h. Attempt 7 failing marks the row failed. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;
/** Longer than one send can take (send.ts caps it at 30 s), short enough that a crashed claim is picked up by the next cron. */
export const LEASE_SECONDS = 120;

export type DrainOptions = {
  /** Rows to send first (the ids a write just queued); then any other due row of this env. */
  ids?: readonly string[];
  /** At most this many claims in one drain. */
  limit?: number;
  /** Stop claiming once this much time has passed; a claim already made is finished. */
  budgetMs?: number;
  pool?: Pool;
  env?: Record<string, string | undefined>;
  /** Tests: the mailer's transport, sink and timeouts. */
  mailer?: Partial<EmailDeps>;
};

/**
 * `lost`: claims whose outcome this drain could not record: a newer claim took
 * the row over (the fence), or the 'sent' mark failed twice (the lease then
 * hands the row to a later drain, which sends it again with its Message-ID).
 */
export type DrainReport = { claimed: number; sent: number; skipped: number; retried: number; failed: number; lost: number };

export type ClaimedRow = {
  id: string;
  event: EmailEvent;
  reservation_id: string;
  to_email: string;
  locale: string;
  attempts: number;
  idempotency_key: string;
  message_id: string | null;
};

async function claimOne(pool: Pool, env: string, ids: readonly string[] | null, domain: string | null): Promise<ClaimedRow | null> {
  const { rows } = await pool.query<ClaimedRow>(
    `WITH next AS (
       SELECT id FROM email_outbox
        WHERE env = $1
          AND (status = 'queued' OR (status = 'sending' AND locked_until < now()))
          AND attempts < $5
          AND next_attempt_at <= now()
          AND ($2::bigint[] IS NULL OR id = ANY ($2::bigint[]))
        ORDER BY next_attempt_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE email_outbox o
        SET status = 'sending',
            attempts = o.attempts + 1,
            locked_until = now() + make_interval(secs => $3),
            -- Fixed at the first claim that knows the sending domain (R5); a random part keeps two
            -- databases (a Preview branch, two developers) from ever minting the same Message-ID.
            message_id = coalesce(o.message_id,
              CASE WHEN $4::text IS NOT NULL
                   THEN '<outbox-' || o.id || '.' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@' || $4 || '>' END),
            updated_at = now()
       FROM next
      WHERE o.id = next.id
      RETURNING o.id::text, o.event, o.reservation_id::text, o.to_email, o.locale, o.attempts, o.idempotency_key, o.message_id`,
    [env, ids, LEASE_SECONDS, domain, MAX_ATTEMPTS],
  );
  return rows[0] ?? null;
}

/** A claim whose function died on its last attempt: nothing will report back, so it ends here (R6). */
async function reapExhausted(pool: Pool, env: string): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE email_outbox
        SET status = 'failed', locked_until = NULL, updated_at = now(),
            last_error = coalesce(last_error, 'lease_expired: the last attempt never reported back')
      WHERE env = $1 AND status = 'sending' AND locked_until < now() AND attempts >= $2`,
    [env, MAX_ATTEMPTS],
  );
  return rowCount ?? 0;
}

/** Why a claimed row must not be sent any more (R7), or null when it still holds. */
function staleReason(row: ClaimedRow, booking: BookingEmailData | null): string | null {
  if (!booking) return 'skipped: the booking no longer exists';
  if (booking.anonymized) return 'skipped: the booking was anonymised';
  if (!EVENT_STATUSES[row.event].includes(booking.status)) return `skipped: the booking is now ${booking.status}`;
  // A guest email goes only to the address the booking still has; a corrected one is not emailed automatically.
  if (row.event.startsWith('guest.') && booking.email?.trim().toLowerCase() !== row.to_email.trim().toLowerCase()) {
    return 'skipped: the guest email changed';
  }
  return null;
}

/** Every mark after a claim is fenced (code rule 3): a drain whose lease ran out must not overwrite the newer claim. */
async function mark(pool: Pool, row: ClaimedRow, sql: string, values: unknown[]): Promise<boolean> {
  const { rowCount } = await pool.query(`${sql} WHERE id = $1 AND attempts = $2 AND status = 'sending'`, [row.id, row.attempts, ...values]);
  return rowCount === 1;
}

export async function drainOutbox(options: DrainOptions = {}): Promise<DrainReport> {
  const pool = options.pool ?? getPool();
  const env = options.env ?? process.env;
  const own = outboxEnv(env);
  const domain = senderDomain(env.EMAIL_FROM);
  const limit = options.limit ?? 50;
  const budgetMs = options.budgetMs ?? 20_000;
  const started = Date.now();
  const report: DrainReport = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, lost: 0 };

  report.failed += await reapExhausted(pool, own);
  const mailer = openMailer({ env, ...options.mailer });
  try {
    const phases: (readonly string[] | null)[] = options.ids?.length ? [options.ids, null] : [null];
    for (const ids of phases) {
      while (report.claimed < limit && Date.now() - started < budgetMs) {
        const row = await claimOne(pool, own, ids, domain);
        if (!row) break;
        report.claimed += 1;
        await deliver(pool, mailer, row, report);
      }
    }
  } finally {
    mailer.close();
  }
  return report;
}

async function deliver(pool: Pool, mailer: Mailer, row: ClaimedRow, report: DrainReport): Promise<void> {
  const tag = `id=${row.id} event=${row.event} attempt=${row.attempts}`;
  let result: SendEmailResult;
  try {
    const booking = await loadBookingEmailData(pool, row.reservation_id);
    const stale = staleReason(row, booking);
    if (stale) {
      if (await mark(pool, row, `UPDATE email_outbox SET status = 'skipped', locked_until = NULL, last_error = $3, updated_at = now()`, [stale])) {
        report.skipped += 1;
        console.info(`[outbox] skipped ${tag} (${stale.slice('skipped: '.length)})`);
      } else report.lost += 1;
      return;
    }
    const email = await renderOutboxEmail(pool, row, booking!);
    result = await mailer.send({
      to: row.to_email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      replyTo: email.replyTo,
      idempotencyKey: row.idempotency_key,
      messageId: row.message_id ?? undefined,
    });
  } catch (error) {
    await scheduleRetry(pool, row, error, report, tag);
    return;
  }
  // The SMTP server has the message: from here on nothing may schedule a second send (C14).
  await markSent(pool, row, result, report, tag);
}

async function scheduleRetry(pool: Pool, row: ClaimedRow, error: unknown, report: DrainReport, tag: string): Promise<void> {
  // A recipient refused for good fails at once (R6); everything else waits for the next step of the ladder.
  const final = (error instanceof EmailSendError && error.code === 'rejected') || row.attempts >= MAX_ATTEMPTS;
  const delay = RETRY_DELAYS_MINUTES[Math.min(row.attempts, RETRY_DELAYS_MINUTES.length) - 1];
  const ok = await mark(
    pool,
    row,
    `UPDATE email_outbox
        SET status = CASE WHEN $4 THEN 'failed' ELSE 'queued' END,
            next_attempt_at = CASE WHEN $4 THEN next_attempt_at ELSE now() + make_interval(mins => $5) END,
            locked_until = NULL, last_error = $3, updated_at = now()`,
    [describeEmailError(error), final, delay],
  );
  const code = error instanceof EmailSendError ? error.code : 'unknown';
  if (!ok) report.lost += 1;
  else if (final) {
    report.failed += 1;
    console.error(`[outbox] failed ${tag} code=${code}`);
  } else {
    report.retried += 1;
    console.warn(`[outbox] retry ${tag} code=${code} in=${delay}m`);
  }
}

/**
 * Records a send the server accepted. A database error here is not a send
 * failure: the mark is tried once more, and if it still fails the row stays
 * 'sending' (logged as mark_failed). Its lease then runs out and a later drain
 * sends it again with the same Message-ID, a duplicate R1 accepts, instead of
 * a retry being scheduled for an email that already went out.
 */
async function markSent(pool: Pool, row: ClaimedRow, result: SendEmailResult, report: DrainReport, tag: string): Promise<void> {
  const sql = `UPDATE email_outbox SET status = 'sent', sent_at = now(), provider_id = $3, locked_until = NULL, last_error = NULL, updated_at = now()`;
  for (let attempt = 1; ; attempt++) {
    try {
      if (await mark(pool, row, sql, [result.id ?? result.mode])) {
        report.sent += 1;
        console.info(`[outbox] sent ${tag}`);
      } else report.lost += 1;
      return;
    } catch (error) {
      if (attempt === 2) {
        report.lost += 1;
        console.error(`[outbox] sent but not recorded ${tag} code=mark_failed`, { pg: (error as { code?: string } | null)?.code ?? 'unknown' });
        return;
      }
    }
  }
}

/** For after(): never throws (a drain that cannot run is retried by the cron), logs no personal data. */
export async function drainQuietly(options: DrainOptions): Promise<void> {
  try {
    await drainOutbox(options);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code ?? 'unknown';
    console.error(`[outbox] drain failed code=${code}`);
  }
}
