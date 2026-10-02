# Phase 5 spike: the email outbox over SMTP, verified end to end

> Spike report, key `outbox-core` (clone `p5-outbox`). Topic: the email outbox over traditional SMTP (nodemailer), migration 007, same-transaction outbox writes, a lease-based drain, `after()` plus Vercel Cron, and Resend removed. Verified end to end against a local in-process SMTP sink.
> Where this report and `00-plan-outline.md` disagree, **the outline wins** (see its §0 and §2). In particular the outline drops the `staff.test` outbox event (R9), keeps `guest.confirmed` for `confirmed` only, and names the migration `007_email_and_consent.sql`.

**Where it is**
- Clone (kept for the plan writer): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-outbox`
- Base: HEAD `04e0692`. In the clone the other agent's four uncommitted RED test files were reverted to HEAD (see errors, item 1).
- Full patch of the spike (35 files, +2336/−268): `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p5-outbox.patch`. Generated with `git diff HEAD` plus intent-to-add for new files.
- The main checkout, Neon, Vercel and every external service were never touched. The only SMTP traffic went to an in-process sink on 127.0.0.1.

## 0. Final gate (all run in the clone)

| Check | Result |
|---|---|
| `npm run typecheck` | ✓ (next typegen + tsc 7.0.2, `--incremental false`) |
| `npm run lint` | exit 0, 19 warnings: the same as HEAD, none in the new files |
| Unit + integration (`TEST_DB_TAG=p5out TEST_DATABASE_URL=…/furama_cuisine_p5out_test npm test`) | 57 files, 629 tests passed. Baseline at HEAD: 53 files, 580 tests. |
| `npm run build` ×2 (CI=1, local `_test` DB) | ✓, no warnings. `ƒ /api/cron/outbox` is dynamic. `.next/server/functions-config-manifest.json` has `"/api/cron/outbox": { "maxDuration": 300 }`. |
| `node scripts/check-prerender.mjs` | passed (prerender, admin, uncached and font checks) |
| Targeted E2E, `next start` on :3220 (`booking-email.spec.ts` new, `admin-reservations`, `admin-closures`) | 15 passed, `--retries=0` |

Two late edits came after build 2 and the E2E run, and only unit/integration covered them: the `[:space:]` SQL regex fix and the test-isolation cleanups.

**E2E evidence.** The real `next start` server ran with `EMAIL_DELIVERY=log` and `EMAIL_LOG_FILE` (and a `CRON_SECRET` in the server's env). A guest booking made through the drawer produced two NDJSON lines after the action had answered: `staff.new` to `fb@furamavietnam.com` (fallback; no recipients) with subject `Đặt bàn mới FC-…`, and `guest.ack` to the guest with `We received your request FC-…`. An Editor pressing "Xác nhận" produced `guest.confirmed`, `Your table is confirmed FC-…`. In the DB the rows ended `sent`, attempt 1, `provider_id='log'`, with `fallback=true` on the staff row. `GET /api/cron/outbox` answered 401 without a header and with a wrong one, and 200 with the right one. This proves `after()` inside a Server Action really runs post-response in Next 16.3.7.

## 1. Rulings and decisions made in the spike

1. **Email history lives only in `email_outbox`.** The `reservation_events` type CHECK of 006 stays as it is; the migration test pins its definition.
   - Why: a send is not a booking change. Writing it into `reservation_events` would fill `/admin/audit` (via `audit_feed`) with `reservation.email_*` rows, and it would duplicate per-attempt state. The outbox row already holds status, attempts, last_error, sent_at and message_id per recipient.
   - The detail page reads `email_outbox WHERE reservation_id` (index `email_outbox_reservation_idx`) beside the timeline.
   - Phase 4's deferred item "audit-label guard reads 006's CHECK" becomes moot.
   - `conflict()` is unaffected.
2. **Fallback store: create `site_settings` early in 007**, one row, `email` NOT NULL, seeded with `CONTACT.email` = `fb@furamavietnam.com`.
   - Phase 6 adds its other columns with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. It must not use `CREATE TABLE`, or the table already exists.
   - Rejected: `booking_settings.notify_email`, a second "general email" that phase 6/7 would have to reconcile with the footer contact email; and an env var, which staff cannot edit.
3. **Recipients.**
   - Scopes resolve as restaurant ∪ destination (`restaurants.destination`, the text FK of 004) ∪ all.
   - `DISTINCT ON (lower(email))`; the most specific scope wins for spelling and locale.
   - Only `active` rows whose `events[]` contains `staff.new`.
   - When nobody matches, one row goes to `site_settings.email`, locale `vi`, `fallback=true`.
   - The predicate is written once (`reachesSql`) and shared with the overview query `emailOverview()`, which returns `{ failed, unrouted: restaurants with booking_enabled and no recipient }`.
4. **Which change queues what** (spec §10.3). All writes run on the transaction's own client.
   - Web submit: `staff.new` + (`guest.confirmed` if auto-confirmed, else `guest.ack` when `booking_settings.guest_ack_email`).
   - Transitions use `transition.guestEmail`: confirm and decline always; cancel only with `notifyGuest`; seated, no_show and corrections never.
   - Staff create: `guest.confirmed` only when `notifyGuest` and status `confirmed` (a phone booking). A walk-in never gets one.
   - A guest row needs a booking email matching `^[^@[:space:]]+@[^@[:space:]]+$`. The guest zod allows `a@b@c.vn`, which the outbox CHECK would reject and so abort the booking; such an address is now simply not queued, and a test pins it.
5. **Skip rules** (`EVENT_STATUSES`). The drain re-reads the booking and skips the row unless the booking is in a matching status:

   | Event | Sent only while the booking is |
   |---|---|
   | `staff.new` | requested, confirmed or seated |
   | `guest.ack` | requested |
   | `guest.confirmed` | confirmed |
   | `guest.declined` | declined |
   | `guest.cancelled` | cancelled |

   A row is also skipped when the booking was anonymised or deleted, or when the guest email changed since queueing. `last_error` records why (`skipped: the booking is now cancelled`).
6. **Delivery is at least once.**
   1. Claim **one row at a time** with `FOR UPDATE SKIP LOCKED`, then `status='sending'`, `attempts+1` (counted *at claim*, so a send that crashes the function still uses an attempt), `locked_until = now()+120 s`, and a `message_id` fixed at the first claim.
   2. Re-read the booking with autocommit queries; no pool client is held during SMTP I/O.
   3. Send.
   4. Mark `sent`, or schedule the retry. Both marks are fenced by `WHERE attempts=$n AND status='sending'`.

   An expired lease (crash) makes the row reclaimable. A row that died on attempt 7 is reaped to `failed` (`lease_expired: …`).
7. **Message-ID.** Outbox: `<outbox-{id}.{12 hex random}@{EMAIL_FROM domain}>`, persisted in `email_outbox.message_id` at the first claim and reused by every retry. The random part exists because Preview branches, other forks and developers' DBs would otherwise mint the same `<outbox-12@…>`, and Gmail may drop a second message with an already-seen Message-ID. Staff invite/reset: derived from their idempotency key, e.g. `<invite-41-<sha16>@domain>`. The token never appears in a header (tested).
8. **Retries.** Waits after failed attempts 1–6 are 1 m, 5 m, 15 m, 1 h, 6 h and 12 h (1161 min ≈ 19.4 h). A failure at attempt 7 marks the row `failed`. A recipient refused for good (5xx at `RCPT TO`, code `rejected`) fails at once. Auth errors, 4xx, network problems, timeouts, config errors and `not_delivered` are retried, because someone may fix the env within the window. "Gửi lại" on a failed row is `requeueFailed()`: attempts reset to 0, same Message-ID.
9. **Env.** `outboxEnv() = VERCEL_ENV in (production, preview) ? it : 'development'`. The drain claims only rows of its own env (tested both ways).
10. **SMTP transport, created per drain and not pooled.**
    - Each message gets its own connection, so a Fluid instance suspended between invocations never holds a half-dead socket.
    - One `openMailer()` per drain is closed in `finally`. Invite/reset use a one-shot sender.
    - Timeouts: `dnsTimeout 5 s`, `connectionTimeout 10 s`, `greetingTimeout 10 s`, `socketTimeout 20 s`, plus a whole-send cap of 30 s. nodemailer's defaults are 2 min / 30 s / 10 min (`smtp-connection/index.d.ts:295-299`).
    - `requireTLS` is set whenever `secure` is false, so port 587 refuses to continue in clear. `tls.minVersion TLSv1.2`.
    - Settings are read at send time, never at import or build.
11. **Env names.** `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true`/`false`; unset → `port===465`), `SMTP_USER` + `SMTP_PASSWORD` (both or neither; the password is not trimmed), `EMAIL_FROM` (existing; must contain an address, which also gives the Message-ID domain), `EMAIL_DELIVERY`, `EMAIL_REDIRECT_TO`, `CRON_SECRET` (16+ characters, else every call is 401).
12. **Error codes.**
    - `missing_api_key` → `missing_smtp_config`.
    - New: `rejected`.
    - `provider_error` now means any SMTP/network failure.
    - `lib/admin/auth-errors.ts` `EMAIL_SETUP_ERRORS` is updated (the `Record` forces it).
    - `describeEmailError` redacts every e-mail address (`<redacted>`) before storing or logging.
13. **`after()`.** `drainAfterCommit(ids)` = `after(() => drainQuietly({ ids, limit: 10, budgetMs: 25_000 }))`. It runs the ids first, then other due rows of the env, as §10.4 allows. It is called only after COMMIT and only on success, and before `redirect()` in `createReservation`. Docs:
    - after() is usable in Server Functions: `01-app/03-api-reference/04-functions/after.md:8`
    - it runs up to the route's maxDuration: `after.md:50`
    - it runs even on throw or redirect, hence only after a successful commit: `after.md:54`
    - on serverless it uses `waitUntil`: `after.md:247-260`
    - Outside a request scope it throws E468 (`node_modules/next/dist/server/after/after.js`), so the tests that call actions directly mock it.
14. **Cron.** `GET /api/cron/outbox`, `export const maxDuration = 300`, drain budget 240 s / limit 500, `cache-control: no-store`. 401 without `Authorization: Bearer $CRON_SECRET`, compared in constant time (`lib/server/cron.ts`). Reading `request.headers` keeps it dynamic (`01-app/01-getting-started/15-route-handlers.md:124`). `maxDuration` is still a valid segment option under Cache Components (`02-route-segment-config/index.md:13,19`).
15. **vercel.json, not vercel.ts.** Exact config: `{"$schema":"https://openapi.vercel.sh/vercel.json","crons":[{"path":"/api/cron/outbox","schedule":"*/5 * * * *"}]}`. Evidence from installing `@vercel/config@0.7.2` in the clone, then reverting:
    - It pulls a nested `zod@3.25.76` and three **high** `npm audit` findings (path-to-regexp via `@vercel/routing-utils`).
    - Its `CronJob` type is just `{schedule: string; path: string}`, so it validates nothing about the cron.
    - Footgun: the README/skill form `export const config: VercelConfig = {crons:[…]}` compiles (`npx @vercel/config compile`) to `{"config":{"crons":[…]}}`, and `npx @vercel/config validate` still prints "✓ Config is valid". The cron would silently not register. Only `export default config` compiled to `{"crons":[…]}`.
    - vercel.json needs no dependency and has a JSON schema.
16. **UI wiring** (minimal; the screens spike owns real UI).
    - "Báo khách qua email khi hủy" checkbox (default on) in TransitionPanel when a cancel option exists.
    - "Báo khách qua email" (default on) on AffectedList bulk cancel.
    - "Gửi email xác nhận" (default on) in NewReservationForm.
    - zod `Checkbox` (`'on'|'true'` → true) added to `TransitionForm`, `NewReservationForm`, `CancelManyForm`.

## 2. New files (full contents in the patch)

### `db/migrations/007_email_outbox.sql`
```sql
-- Phase 5: booking email (spec §5.2, §10.4) over SMTP.
--
-- Expand only, one transaction, safe to re-run: three new tables and their
-- indexes, nothing in 001–006 changes. In particular reservation_events keeps
-- 006's type CHECK: email history lives in email_outbox (one row per
-- recipient, with its status and attempts), and the booking detail page reads
-- it beside the timeline. A send is not a change to the booking, so it stays
-- out of reservation_events and out of /admin/audit.

-- ── site_settings (early) ─────────────────────────────────────────────────
-- Spec §5.2 lists site_settings under phase 6; phase 5 needs one of its
-- columns now: the general email, where staff.new goes when no
-- notification_recipients row matches (§10.4). Creating the one-row table
-- here, with that column only, keeps a single "general email" for the site
-- footer (phase 6/7) and the fallback. Phase 6 adds its other columns with
-- ALTER TABLE … ADD COLUMN IF NOT EXISTS, not CREATE TABLE.
CREATE TABLE IF NOT EXISTS site_settings (
  id         boolean     PRIMARY KEY DEFAULT true CONSTRAINT site_settings_single_row CHECK (id),
  email      text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- CONTACT.email of lib/data.ts, the address the guest site already shows.
INSERT INTO site_settings (id, email) VALUES (true, 'fb@furamavietnam.com') ON CONFLICT DO NOTHING;

-- ── notification_recipients ───────────────────────────────────────────────
-- Who hears about new bookings. A booking reaches the union of the rows for
-- its restaurant, its destination and 'all', deduplicated by address.
CREATE TABLE IF NOT EXISTS notification_recipients (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text        NOT NULL CHECK (scope IN ('all', 'destination', 'restaurant')),
  destination_id text        REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  restaurant_id  text        REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  email          text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  -- Staff events only; a later phase that adds one replaces this CHECK.
  events         text[]      NOT NULL DEFAULT ARRAY['staff.new']
                 CONSTRAINT notification_recipients_events_check
                 CHECK (cardinality(events) >= 1 AND events <@ ARRAY['staff.new']),
  locale         text        NOT NULL DEFAULT 'vi' REFERENCES locales (code) ON UPDATE CASCADE,
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT notification_recipients_scope_target CHECK (
    (scope = 'all'         AND destination_id IS NULL     AND restaurant_id IS NULL) OR
    (scope = 'destination' AND destination_id IS NOT NULL AND restaurant_id IS NULL) OR
    (scope = 'restaurant'  AND restaurant_id IS NOT NULL  AND destination_id IS NULL)
  )
);

-- One row per address and target; the same address may sit on several targets.
CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_target_email_idx
  ON notification_recipients (scope, coalesce(destination_id, ''), coalesce(restaurant_id, ''), lower(email));

-- ── email_outbox ──────────────────────────────────────────────────────────
-- One row per email and recipient, written in the transaction of the booking
-- change that causes it (§10.4), drained after COMMIT by after(), by the cron
-- and by "Gửi lại". SMTP has no idempotency key, so delivery is at least
-- once: a row is claimed with a lease (status 'sending', locked_until) before
-- the send and marked sent right after; a crash in between re-sends it once
-- the lease ends, with the same Message-ID (message_id, fixed at the first
-- claim) so the copy is recognisable.
CREATE TABLE IF NOT EXISTS email_outbox (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- VERCEL_ENV of the writer ('development' off Vercel). A sender drains only its own env's rows,
  -- so a Preview branch forked from production never sends production's queue.
  env                  text        NOT NULL CHECK (env IN ('production', 'preview', 'development')),
  event                text        NOT NULL CHECK (event IN ('staff.new', 'guest.ack', 'guest.confirmed',
                                                             'guest.declined', 'guest.cancelled', 'staff.test')),
  audience             text        NOT NULL CHECK (audience IN ('staff', 'guest')),
  reservation_id       bigint      REFERENCES reservations (id) ON DELETE CASCADE,
  -- The timeline event that queued it (created / status_changed); NULL for "Gửi email thử".
  reservation_event_id bigint      REFERENCES reservation_events (id) ON DELETE SET NULL,
  -- Phase 10's anonymiser overwrites it with a placeholder that still passes this CHECK.
  to_email             text        NOT NULL CHECK (to_email ~ '^[^@\s]+@[^@\s]+$' AND length(to_email) <= 254),
  locale               text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE,
  -- staff.new sent to site_settings.email because no recipient matched.
  fallback             boolean     NOT NULL DEFAULT false,
  idempotency_key      text        GENERATED ALWAYS AS ('outbox:' || id::text) STORED
                       CONSTRAINT email_outbox_idempotency_key_key UNIQUE,
  status               text        NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  -- Claims so far; a claim counts before the send, so a send that crashes the function still uses one up.
  attempts             smallint    NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 7),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  locked_until         timestamptz,
  -- "<code>: <message>", e-mail addresses removed, as describeEmailError writes it.
  last_error           text        CHECK (length(last_error) <= 300),
  -- The <…> Message-ID header, fixed at the first claim and reused by every later attempt.
  message_id           text        CHECK (length(message_id) <= 300),
  -- The SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"), or the log/redirect marker.
  provider_id          text        CHECK (length(provider_id) <= 300),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,       -- staff id for "Gửi email thử"; NULL when a booking change queued it
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_audience_event CHECK ((audience = 'guest') = (event LIKE 'guest.%')),
  CONSTRAINT email_outbox_test_only_unbooked CHECK ((reservation_id IS NULL) = (event = 'staff.test')),
  CONSTRAINT email_outbox_sending_leased CHECK (status <> 'sending' OR locked_until IS NOT NULL),
  CONSTRAINT email_outbox_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- The drain: due rows of one env, oldest first.
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox (env, next_attempt_at, id) WHERE status IN ('queued', 'sending');
-- The booking detail page's email list.
CREATE INDEX IF NOT EXISTS email_outbox_reservation_idx ON email_outbox (reservation_id, id);
-- The email log (newest first) and the overview's failed count.
CREATE INDEX IF NOT EXISTS email_outbox_log_idx ON email_outbox (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS email_outbox_failed_idx ON email_outbox (created_at DESC, id DESC) WHERE status = 'failed';
```
A generated STORED column over the identity id was probed on PG 18.3 (`outbox:1`, `outbox:2`). Use STORED explicitly: PG18 defaults generated columns to VIRTUAL, which cannot carry UNIQUE.

*(Outline: `staff.test`, `created_by` and the `email_outbox_test_only_unbooked` CHECK go; `reservation_id` becomes NOT NULL; the guard spike's consent columns join this file.)*

### `lib/server/email/types.ts`
```ts
import type { ReactElement } from 'react';

export type EmailDeliveryMode = 'live' | 'redirect' | 'log';

/** Content is either a React Email element (rendered to html + text here) or ready-made html + text. */
export type EmailContent =
  | { react: ReactElement; html?: undefined; text?: undefined }
  | { react?: undefined; html: string; text: string };

export type SendEmailInput = EmailContent & {
  to: string;
  subject: string;
  /**
   * What makes a repeat of this send recognisable. SMTP has no idempotency key, so it becomes
   * the Message-ID header (`<invite-12-ab34@sending-domain>`) unless `messageId` is given.
   */
  idempotencyKey?: string;
  /** A ready Message-ID, `<…@…>`; the outbox passes the one it fixed at the first attempt. */
  messageId?: string;
};

/** What a sink / the SMTP server actually received, after redirect and rendering. */
export type DeliveredEmail = {
  mode: EmailDeliveryMode;
  to: string;
  /** Original recipient; differs from `to` only in redirect mode. */
  originalTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
  messageId?: string;
};

/** `id`: the SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"); none in log mode. */
export type SendEmailResult = { mode: EmailDeliveryMode; id?: string; messageId?: string };

export type EmailErrorCode =
  | 'invalid_delivery_mode'
  /** EMAIL_DELIVERY is live or redirect but SMTP_HOST, SMTP_PORT or the SMTP_USER/SMTP_PASSWORD pair is missing or wrong. */
  | 'missing_smtp_config'
  | 'missing_from'
  | 'missing_redirect_to'
  /** Log mode on a Vercel Production or Preview deployment: logged without its link, so it reached no one. */
  | 'not_delivered'
  /** The SMTP server refused the recipient for good (5xx at RCPT TO): retrying cannot help. */
  | 'rejected'
  /** Anything else on the way to the SMTP server: network, TLS, auth, 4xx, a timeout. Retried. */
  | 'provider_error';

/** Thrown by sendEmail. The invite flow stores describeEmailError(err) in staff_invitation.email_error. */
export class EmailSendError extends Error {
  readonly code: EmailErrorCode;
  constructor(code: EmailErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailSendError';
    this.code = code;
  }
}

export type EmailLogSink = (email: DeliveredEmail) => void | Promise<void>;

/** The message we hand the transport (nodemailer's SendMailOptions, narrowed to what we use). */
export type TransportMessage = { from: string; to: string; subject: string; html: string; text: string; messageId?: string };

/** The slice of a nodemailer transporter we use; tests inject a fake or the real one aimed at a local sink. */
export type MailTransport = {
  sendMail(message: TransportMessage): Promise<{ messageId: string; response: string }>;
  close(): void;
};

/** Addresses in an SMTP reply ("550 5.1.1 <guest@x.vn>: unknown") never reach a stored error or a log line. */
export function redactEmails(text: string): string {
  return text.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '<redacted>');
}

/** What goes in staff_invitation.email_error and email_outbox.last_error: "<code>: <message>", at most 300 characters, no addresses. */
export function describeEmailError(error: unknown): string {
  const text =
    error instanceof EmailSendError
      ? `${error.code}: ${error.message}`
      : `unknown: ${error instanceof Error ? error.message : String(error)}`;
  return redactEmails(text).slice(0, 300);
}

/** The code at the front of a stored email_error (an EmailErrorCode or "unknown"), or null when there is none. */
export function emailErrorCode(stored: string | null): string | null {
  return stored === null ? null : stored.split(':')[0];
}
```
(`TransportMessage` is written on one line here; the file has it multi-line. The outline adds `replyTo?: string` to `SendEmailInput` and `TransportMessage`, from the templates spike.)

### `lib/server/email/smtp.ts`
```ts
import 'server-only';
import { createTransport } from 'nodemailer';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { EmailSendError, type MailTransport } from './types';

/*
 * The SMTP connection (user decision: no Resend; a traditional SMTP account).
 * Settings come from the environment when a message is sent, never at import
 * or build time:
 *   SMTP_HOST      the provider's submission host
 *   SMTP_PORT      587 (STARTTLS, the default) or 465 (TLS from the first byte)
 *   SMTP_SECURE    "true" for implicit TLS, "false" for STARTTLS; unset: true only on port 465
 *   SMTP_USER      login, together with SMTP_PASSWORD (both or neither)
 *   SMTP_PASSWORD
 * Port 25 is not an option: Vercel functions are generally blocked from it.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  /** true: TLS from the first byte (465). false: plain connect, then a mandatory STARTTLS upgrade (587). */
  secure: boolean;
  auth?: { user: string; pass: string };
};

const missing = (message: string) => new EmailSendError('missing_smtp_config', message);

export function smtpConfigFromEnv(env: Record<string, string | undefined>): SmtpConfig {
  const host = env.SMTP_HOST?.trim();
  if (!host) throw missing('SMTP_HOST is required when EMAIL_DELIVERY is live or redirect');
  const rawPort = env.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);
  if (!/^\d{1,5}$/.test(rawPort) || port < 1 || port > 65535) throw missing(`SMTP_PORT must be a port number (got "${rawPort}")`);
  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== 'true' && rawSecure !== 'false') throw missing(`SMTP_SECURE must be true or false (got "${rawSecure}")`);
  const secure = rawSecure ? rawSecure === 'true' : port === 465;
  const user = env.SMTP_USER?.trim();
  // A password is taken as typed: spaces may be part of it.
  const pass = env.SMTP_PASSWORD;
  if (Boolean(user) !== Boolean(pass)) throw missing('SMTP_USER and SMTP_PASSWORD must be set together');
  return { host, port, secure, ...(user && pass ? { auth: { user, pass } } : {}) };
}

/** Sized for a serverless function, where nodemailer's defaults (2 minutes to connect, 10 minutes of socket inactivity) would outlive the invocation. Each limit applies to one step; send.ts also caps a whole send. */
export const SMTP_TIMEOUTS = { dnsTimeout: 5_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 } as const;

export function smtpTransportOptions(config: SmtpConfig): SMTPTransportOptions {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Without TLS on 587 the password and the guest's details would cross the network in clear: refuse instead.
    requireTLS: !config.secure,
    auth: config.auth,
    ...SMTP_TIMEOUTS,
    tls: { minVersion: 'TLSv1.2' },
  };
}

/** Not pooled: each message opens its own connection and closes it when the server has answered. Booking email is a few messages per drain, and a Fluid Compute instance that is suspended between invocations then never holds a half-dead SMTP socket. */
export function createSmtpTransport(options: SMTPTransportOptions): MailTransport {
  const transporter = createTransport(options);
  return {
    sendMail: async (message) => {
      const info = await transporter.sendMail(message);
      return { messageId: info.messageId, response: info.response };
    },
    close: () => transporter.close(),
  };
}
```
(Some comments are condensed onto one line here.)

### `lib/server/email/send.ts` (the EMAIL_DELIVERY gate, unchanged in behaviour for log and redirect)
```ts
import 'server-only';
import type { ReactElement } from 'react';
import { plainTextSelectors, render } from 'react-email';
import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';
import { createSmtpTransport, smtpConfigFromEnv, smtpTransportOptions } from './smtp';
import { EmailSendError, redactEmails, type DeliveredEmail, type EmailDeliveryMode, type EmailLogSink, type MailTransport, type SendEmailInput, type SendEmailResult } from './types';

export type EmailDeps = {
  /** Read at send time, never at import time, so `next build` needs no email env. */
  env: Record<string, string | undefined>;
  createTransport: (options: SMTPTransportOptions) => MailTransport;
  logSink: EmailLogSink;
  /** A cap on one whole send (connect, TLS, login, DATA), above the per-step SMTP timeouts. */
  sendTimeoutMs: number;
  /** Tests only: a local sink's self-signed certificate, shorter timeouts. Never read from the environment. */
  transportOverrides?: Partial<SMTPTransportOptions>;
};
export const SEND_TIMEOUT_MS = 30_000;
const DEPLOYED = new Set(['production', 'preview']);
export const consoleLogSink: EmailLogSink = async (email) => { /* unchanged from phase 3: redacted line on Vercel, full text + EMAIL_LOG_FILE NDJSON elsewhere */ };
const defaultDeps = (): EmailDeps => ({ env: process.env, createTransport: createSmtpTransport, logSink: consoleLogSink, sendTimeoutMs: SEND_TIMEOUT_MS });
function resolveMode(raw: string | undefined): EmailDeliveryMode { /* unchanged: '' → log; live|redirect|log; else throw invalid_delivery_mode */ }

/** The domain of EMAIL_FROM ("Furama Cuisine <no-reply@mail.furamavietnam.com>" → mail.furamavietnam.com). */
export function senderDomain(from: string | undefined): string | null {
  const match = from?.trim().match(/@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)>?$/);
  return match ? match[1].toLowerCase() : null;
}
/** A Message-ID made from an idempotency key: `invite:12:ab34` → `<invite-12-ab34@domain>`. */
export function messageIdFor(key: string, domain: string): string {
  return `<${key.replace(/[^A-Za-z0-9.-]+/g, '-')}@${domain}>`;
}
export async function renderEmail(element: ReactElement) { /* unchanged */ }

/** Rejects after `ms`, so one stuck server cannot hold a drain until the function's own limit. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
type SmtpFailure = { message?: string; code?: string; command?: string; responseCode?: number };
/** A refused recipient (5xx at RCPT TO) is final; anything else (network, TLS, login, 4xx, timeout) may pass later. */
function smtpError(cause: unknown): EmailSendError {
  const e = (cause ?? {}) as SmtpFailure;
  const where = [e.code, e.command].filter(Boolean).join(' at ');
  const message = redactEmails(`SMTP ${where ? `${where}: ` : ''}${e.message ?? String(cause)}`);
  const permanent = typeof e.responseCode === 'number' && e.responseCode >= 500 && e.responseCode < 600 && /^RCPT/i.test(e.command ?? '');
  return new EmailSendError(permanent ? 'rejected' : 'provider_error', message, { cause });
}

export type Mailer = { send(input: SendEmailInput): Promise<SendEmailResult>; close(): void };

export function openMailer(overrides: Partial<EmailDeps> = {}): Mailer {
  const deps = { ...defaultDeps(), ...overrides };
  let transport: MailTransport | null = null;
  return {
    async send(input) {
      const mode = resolveMode(deps.env.EMAIL_DELIVERY);
      const { html, text } = input.react ? await renderEmail(input.react) : { html: input.html, text: input.text };
      let to = input.to;
      let subject = input.subject;
      if (mode === 'redirect') {
        const target = deps.env.EMAIL_REDIRECT_TO?.trim();
        if (!target) throw new EmailSendError('missing_redirect_to', 'EMAIL_REDIRECT_TO is required when EMAIL_DELIVERY=redirect');
        to = target;
        subject = `[${input.to}] ${input.subject}`;
      }
      const from = deps.env.EMAIL_FROM?.trim();
      const domain = senderDomain(from);
      const messageId = input.messageId ?? (input.idempotencyKey && domain ? messageIdFor(input.idempotencyKey, domain) : undefined);
      const delivered: DeliveredEmail = { mode, to, originalTo: input.to, subject, html, text, idempotencyKey: input.idempotencyKey, messageId };
      if (mode === 'log') {
        await deps.logSink(delivered);
        const vercelEnv = deps.env.VERCEL_ENV ?? '';
        if (DEPLOYED.has(vercelEnv)) throw new EmailSendError('not_delivered', `EMAIL_DELIVERY is log (or unset) on a Vercel ${vercelEnv} deployment: … Set EMAIL_DELIVERY to live or redirect.`);
        return { mode, messageId };
      }
      if (!from || !domain) throw new EmailSendError('missing_from', `EMAIL_FROM with a sender address is required when EMAIL_DELIVERY=${mode}`);
      transport ??= deps.createTransport({ ...smtpTransportOptions(smtpConfigFromEnv(deps.env)), ...deps.transportOverrides });
      let info;
      try {
        info = await withDeadline(transport.sendMail({ from, to, subject, html, text, messageId }), deps.sendTimeoutMs);
      } catch (cause) {
        throw smtpError(cause);
      }
      return { mode, id: redactEmails(info.response).slice(0, 300), messageId: info.messageId };
    },
    close() {
      transport?.close();
      transport = null;
    },
  };
}

/** A sender for one message at a time (staff invitation and password reset). */
export function createEmailSender(overrides: Partial<EmailDeps> = {}) {
  return async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
    const mailer = openMailer(overrides);
    try { return await mailer.send(input); } finally { mailer.close(); }
  };
}
export const sendEmail = createEmailSender();
```
(`/* unchanged */` marks bodies kept verbatim from phase 3; the full file is in the patch.) `auth-emails.ts` changes only its comments ("SMTP", "Message-ID").

### `lib/server/email/outbox.ts`
Exports `outboxEnv`, `EVENT_STATUSES`, `reachesSql`, `queueGuestEmail`, `queueStaffNew`, `queueWebBookingEmails`, `outboxEffects`, `queueTestEmail`, `requeueFailed` and `emailOverview`.
```ts
export function outboxEnv(env = process.env): OutboxEnv { const v = env.VERCEL_ENV; return v === 'production' || v === 'preview' ? v : 'development'; }
export const EVENT_STATUSES = { 'staff.new': ['requested','confirmed','seated'], 'guest.ack': ['requested'], 'guest.confirmed': ['confirmed'], 'guest.declined': ['declined'], 'guest.cancelled': ['cancelled'] };
export const reachesSql = (n, restaurantId, destination) =>
  `(${n}.scope = 'all' OR (${n}.scope = 'destination' AND ${n}.destination_id = ${destination})` +
  ` OR (${n}.scope = 'restaurant' AND ${n}.restaurant_id = ${restaurantId}))`;

// queueGuestEmail(client, { reservationId, eventId, env, event, ackSetting })
`INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale)
 SELECT $1, $2, 'guest', r.id, $4, r.email, r.locale
   FROM reservations r
  WHERE r.id = $3 AND r.email ~ '^[^@[:space:]]+@[^@[:space:]]+$' AND length(r.email) <= 254
    AND (NOT $5 OR (SELECT guest_ack_email FROM booking_settings))
 RETURNING id::text`

// queueStaffNew(client, { reservationId, eventId, env })
`WITH booking AS (SELECT r.id, r.restaurant_id, rest.destination FROM reservations r JOIN restaurants rest ON rest.id = r.restaurant_id WHERE r.id = $2),
 matched AS (
   SELECT DISTINCT ON (lower(n.email)) n.email, n.locale
     FROM notification_recipients n, booking b
    WHERE n.active AND 'staff.new' = ANY (n.events) AND ${reachesSql('n', 'b.restaurant_id', 'b.destination')}
    ORDER BY lower(n.email), CASE n.scope WHEN 'restaurant' THEN 0 WHEN 'destination' THEN 1 ELSE 2 END, n.id),
 chosen AS (
   SELECT email, locale, false AS fallback FROM matched
   UNION ALL
   SELECT s.email, 'vi', true FROM site_settings s WHERE NOT EXISTS (SELECT 1 FROM matched))
 INSERT INTO email_outbox (env, event, audience, reservation_id, reservation_event_id, to_email, locale, fallback)
 SELECT $1, 'staff.new', 'staff', b.id, $3, c.email, c.locale, c.fallback FROM chosen c, booking b
 RETURNING id::text`

export async function queueWebBookingEmails(client, queue /* + status */) {
  const staff = await queueStaffNew(client, queue);
  const guest = queue.status === 'confirmed'
    ? await queueGuestEmail(client, { ...queue, event: 'guest.confirmed' })
    : await queueGuestEmail(client, { ...queue, event: 'guest.ack', ackSetting: true });
  return [...staff, ...guest];
}

export function outboxEffects(env = outboxEnv()): Required<ReservationEffects> & { queued: string[] } {
  const queued: string[] = [];
  return {
    queued,
    async afterTransition(client, { reservationId, transition, eventId, notifyGuest }) {
      const guest = transition.guestEmail;
      if (!guest || (guest.when === 'if_notify' && !notifyGuest)) return;
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: guest.event })));
    },
    async afterCreate(client, { reservationId, status, eventId, notifyGuest }) {
      if (!notifyGuest || status !== 'confirmed') return; // a walk-in is already at the table
      queued.push(...(await queueGuestEmail(client, { reservationId, eventId, env, event: 'guest.confirmed' })));
    },
  };
}
// queueTestEmail: INSERT … VALUES ($1,'staff.test','staff',$2,'vi',$3) RETURNING id — caller then drainOutbox({ ids:[id], alsoDue:false })
// requeueFailed: UPDATE … SET status='queued', attempts=0, next_attempt_at=now(), locked_until=NULL WHERE id=$1 AND status='failed'
// emailOverview(db, env): { failed: count(status='failed' AND env=$1), unrouted: restaurants WHERE booking_enabled AND NOT EXISTS(active recipient reaching it) ORDER BY sort_order, id }
```
**Gotcha:** SQL inside a JS template literal loses the backslash in `\s` (it becomes `s`). Use `[:space:]`. This bit once (errors, item 6).

### `lib/server/email/drain.ts`
```ts
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 360, 720] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1; // 7
export const LEASE_SECONDS = 120;

// claimOne(pool, env, ids|null, domain|null) — one statement, autocommit:
`WITH next AS (
   SELECT id FROM email_outbox
    WHERE env = $1
      AND (status = 'queued' OR (status = 'sending' AND locked_until < now()))
      AND attempts < $5
      AND next_attempt_at <= now()
      AND ($2::bigint[] IS NULL OR id = ANY ($2::bigint[]))
    ORDER BY next_attempt_at, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED)
 UPDATE email_outbox o
    SET status = 'sending', attempts = o.attempts + 1,
        locked_until = now() + make_interval(secs => $3),
        message_id = coalesce(o.message_id,
          CASE WHEN $4::text IS NOT NULL
               THEN '<outbox-' || o.id || '.' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@' || $4 || '>' END),
        updated_at = now()
   FROM next WHERE o.id = next.id
 RETURNING o.id::text, o.event, o.reservation_id::text, o.to_email, o.locale, o.attempts, o.idempotency_key, o.message_id`
// params: [env, ids, LEASE_SECONDS, senderDomain(env.EMAIL_FROM), MAX_ATTEMPTS]

// reapExhausted (start of every drain):
`UPDATE email_outbox SET status='failed', locked_until=NULL, updated_at=now(),
        last_error = coalesce(last_error, 'lease_expired: the last attempt never reported back')
  WHERE env=$1 AND status='sending' AND locked_until < now() AND attempts >= $2`

// every mark is fenced:  `${sql} WHERE id = $1 AND attempts = $2 AND status = 'sending'`; rowCount 0 → report.lost++
// sent:    SET status='sent', sent_at=now(), provider_id=$3 (SMTP reply or mode), locked_until=NULL, last_error=NULL
// skipped: SET status='skipped', locked_until=NULL, last_error=$3 ('skipped: the booking is now cancelled' | '…anonymised' | '…no longer exists' | 'skipped: the guest email changed')
// failure: SET status = CASE WHEN $4 THEN 'failed' ELSE 'queued' END,
//              next_attempt_at = CASE WHEN $4 THEN next_attempt_at ELSE now() + make_interval(mins => $5) END,
//              locked_until=NULL, last_error=$3   -- $4 = code 'rejected' OR attempts >= 7; $5 = RETRY_DELAYS_MINUTES[attempts-1]

export async function drainOutbox(o: DrainOptions = {}): Promise<DrainReport> {
  // pool = o.pool ?? getPool(); env = o.env ?? process.env; own = outboxEnv(env); limit 50; budget 20 s
  // report = { claimed, sent, skipped, retried, failed, lost }
  // reapExhausted → openMailer({ env, ...o.mailer }) → phases: [ids?] then [null] if alsoDue (default true)
  // while claimed < limit && elapsed < budget: claimOne → deliver (loadBooking via pool.query, staleReason,
  //   renderBookingEmail(event, locale, booking), mailer.send({ to, subject, react, idempotencyKey, messageId }), mark)
  // finally mailer.close()
}
export async function drainQuietly(o) { try { await drainOutbox(o); } catch (e) { console.error(`[outbox] drain failed code=${e?.code ?? 'unknown'}`); } }
```
- Logs carry ids, events and attempt numbers only: `[outbox] sent id=12 event=guest.ack attempt=1`, `[outbox] retry … code=provider_error in=5m`, `[outbox] failed …`. A test asserts no `@` in `[outbox]` lines.
- `loadBooking` reads status, reference, restaurant name, date (`to_char`), time, guests, name, phone, email, note, status_reason and anonymised. `adminUrl` = `${appOrigin()}/admin/reservations/${id}`.
- Read in full by the lead (`p5-outbox/lib/server/email/drain.ts`): one `try` wraps load, render, send and the `sent` mark, so a DB error on the `sent` UPDATE after a successful send falls into the failure path and schedules a retry (a duplicate). The outline's review focus 1 asks the plan to separate the two.

### `lib/server/email/after-commit.ts`
```ts
import 'server-only';
import { after } from 'next/server';
import { drainQuietly } from './drain';
export function drainAfterCommit(ids: readonly string[]): void {
  after(() => drainQuietly({ ids: [...ids], limit: 10, budgetMs: 25_000 }));
}
```

### `lib/server/cron.ts` and `app/api/cron/outbox/route.ts`
```ts
// lib/server/cron.ts — kept out of route.ts: route files should only export handlers and segment config
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}
// app/api/cron/outbox/route.ts
export const maxDuration = 300;
const NO_STORE = { 'cache-control': 'no-store' };
export async function GET(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get('authorization'), process.env.CRON_SECRET))
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
  try {
    return Response.json(await drainOutbox({ budgetMs: 240_000, limit: 500 }), { headers: NO_STORE });
  } catch (error) {
    console.error(`[cron:outbox] drain failed code=${(error as { code?: string } | null)?.code ?? 'unknown'}`);
    return Response.json({ error: 'drain_failed' }, { status: 500, headers: NO_STORE });
  }
}
```
The proxy matcher already excludes `/api/*`. The build lists the route as `ƒ`.

### Placeholder template seam
`lib/server/email/templates/booking.tsx` exports `renderBookingEmail(event, locale, data | null) → { subject, element }` with minimal inline EN/VI copy for the 5 events plus `staff.test`. Subjects:
- `Đặt bàn mới FC-…`
- `We received your request FC-…`
- `Your table is confirmed FC-…`
- `Email thử từ Furama Cuisine`

The templates spike replaces the copy with registry keys `email.<event>.<field>`. (The outline settles the seam: the drain uses the templates spike's loader and builder; see outline C8.)

### Modified existing files (in the patch)
- `lib/server/booking/create.ts`: the `created` event INSERT gains `RETURNING id::text`, then `queueWebBookingEmails(client, { reservationId, eventId, env: outboxEnv(), status })`. `CreateOutcome.ok` gains `outboxIds: string[]`.
- `app/actions.ts`: after `createWebReservation` ok, `drainAfterCommit(result.outboxIds)`.
- `app/admin/(shell)/reservations/actions.ts`:
  - `changeStatus` passes `notifyGuest` from the form, with `{ effects: outboxEffects() }` and `drainAfterCommit(effects.queued)` after ok.
  - `createReservation` passes `notifyGuest: input.notifyGuest`, with effects and the drain before `redirect()`.
  - `cancelReservations` uses one `outboxEffects()` across the loop and drains after it.
- `lib/admin/booking-schemas.ts`: `Checkbox` plus a `notifyGuest` field on three forms. Its tests are updated.
- `lib/admin/auth-errors.ts` (+test): the code map.
- `TransitionPanel.tsx`, `AffectedList.tsx`, `NewReservationForm.tsx`: the checkboxes.
- `README.md`: env table (`SMTP_*`, `CRON_SECRET`; `RESEND_API_KEY` removed) and an "Email (SMTP)" section in place of "Resend".
- `package.json`: −`resend`; +`nodemailer ^10.0.13`; dev +`smtp-server ^3.19.16`, `@types/smtp-server ^3.5.13`.
- `vercel.json` (new): the cron above.

## 3. Test harness patterns
- **`test/helpers/smtp-sink.ts`** wraps `smtp-server`. It binds `127.0.0.1:0` (an OS-assigned port, never in the agents' 32xx range) with `logger:false`, which silences smtp-server's warning about its default certificate.
  - Options: STARTTLS (default) or `secure` (465 style), `noStartTls`, `login`, `refuseRecipient(addr) → code`, `failData(index) → code`, `holdDataMs`.
  - It records `received` (accepted) and `seen` (every DATA) with the raw text, the `Message-ID`, the `Subject` (RFC 2047 encoded-words decoded), `secure` and `user`.
  - `clientOverrides = { tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' } }` reaches the transport only through `EmailDeps.transportOverrides`, never through env.
  - `startSilentServer()` is a TCP server that never greets.
- **Mocking `after()`** where an action is called directly (`submit-reservation.test.ts`):
  ```ts
  const afterTasks = vi.hoisted(() => [] as (() => unknown)[]);
  vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: (task: () => unknown) => void afterTasks.push(task) }));
  ```
- **Crash simulation:** a pool wrapper whose `UPDATE … 'sent'` never resolves.
- **Two concurrent drains:** a second `Pool`.
- **Fencing:** expire the lease while the first send is held at DATA.
- **Isolation:** booking-less `staff.test` rows and recipients survive `DELETE FROM reservations`. `submit-reservation` cleans `email_outbox` and `notification_recipients` in `beforeEach`; the outbox and cron files truncate in `afterAll`.

## 4. New tests (all green)

**`lib/server/email/smtp.test.ts` (9).** Wire tests against the sink: 587 STARTTLS + login + `<invite-41-{sha16}@mail.furama.test>`, token absent from headers; 465 implicit TLS; redirect; no STARTTLS → `provider_error: SMTP ETLS at STARTTLS…` with 0 DATA; wrong password → `provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535…`, password absent; RCPT 550 → `rejected`, address redacted, 451 → `provider_error`; silent server → `SMTP ETIMEDOUT at CONN: Greeting never received` in under 3 s; DATA held 800 ms with a 200 ms cap → `provider_error: SMTP ETIMEDOUT: no answer within 200 ms`, yet the sink still accepts the message afterwards (this is why delivery is at least once); one mailer sending three messages.

**`lib/server/email/email.test.ts` (21).** Unit tests with a fake transport: exact SMTP options for 587/465/2525; config errors raised at send time; `missing_from`; RCPT 5xx vs others; the 30 s cap; `senderDomain`/`messageIdFor`; redaction. The phase-3 template, log-sink and invite/reset tests are kept green.

**`lib/server/email/mail-transport.guard.test.ts` (3).** Only `lib/server/email/` imports `nodemailer`; nothing outside `test/` imports `smtp-server`; nothing imports `resend`. It replaces `resend-import.guard.test.ts`.

**`test/integration/migration-007.test.ts` (10).** Apply on a DB at 006 with data; the 006 CHECK is unchanged; the generated key, its UNIQUE and the "can only be updated to DEFAULT" refusal; re-run safety; every CHECK and FK; cascade and SET NULL; the recipient uniqueness index (case-insensitive); site_settings single row; indexes.

**`test/integration/email-outbox.test.ts` (21).**
- Queueing:
  - recipients restaurant ∪ destination ∪ all, deduplicated, inactive and others excluded, links to the `created` event;
  - fallback;
  - ack on/off, auto-confirm, no address, the odd `a@home@example.com` booking still succeeding;
  - duplicate queues nothing;
  - transitions confirm/decline/cancel±notify;
  - staff create phone/unticked/walk-in;
  - hook failure rolls back booking and rows;
  - overview;
  - env.
- Drain:
  - sent once each with the wire Message-ID equal to the stored `message_id` (`/^<outbox-{id}\.[0-9a-f]{12}@mail\.furama\.test>$/`) and `provider_id '250 Ok: queued as SINK0'`;
  - env isolation;
  - the full retry ladder, observed waits `[1,5,15,60,360,720]`, 7 wire attempts with one Message-ID, then `failed` and `requeueFailed`;
  - 550 fails at once;
  - skip-on-mismatch: four rows, three skipped, only `guest.cancelled` sent;
  - two concurrent drains: 12 rows, 12 distinct sends, each attempts=1;
  - crash between send and mark: lease blocks re-send, then expiry → second copy with the same Message-ID, attempts 2;
  - fencing: the stale drain's 451 does not requeue a row a newer claim sent (`lost:1`);
  - reaping;
  - log mode, and log on Preview → `not_delivered` retry;
  - "Gửi email thử";
  - SMTP down → `SMTP ESOCKET at CONN: connect ECONNREFUSED`, booking kept.

**`test/integration/cron-outbox.test.ts` (3).** `cronAuthorized` edge cases; 401 ×4 with no rows sent; 200 drains only due rows of its env.

**`test/integration/submit-reservation.test.ts` (+2).** Rows queued in the transaction, and `after` got exactly one task which, when run, marks both rows `sent` (log); a refused booking schedules no drain.

**`e2e/booking-email.spec.ts` (3, real server).** Described in §0.

## 5. Mutation checks (each guard removed → test goes red; restored after each)

| Mutation | Failing tests |
|---|---|
| M1: claim ignores the lease (`status IN ('queued','sending')`) | concurrent-drains, crash, fencing |
| M2: drop the `attempts=$n` fence | fencing |
| M3: no staleness check | skip-on-mismatch |
| M4: plain `FOR UPDATE` (no SKIP LOCKED) | concurrent-drains |
| M5: no env filter | env isolation, log-mode, cron 200 |
| M6: `requireTLS:false` | no-STARTTLS test |
| M7: no `DISTINCT ON` | recipient-dedupe |
| M8: no fallback | general-email |

## 6. Real SMTP error strings seen against the sink
- `provider_error: SMTP ETLS at STARTTLS: Error upgrading connection with STARTTLS: 500 Error: command not recognized`
- `provider_error: SMTP EAUTH at AUTH PLAIN: Invalid login: 535 Authentication failed`
- `rejected: SMTP EENVELOPE at RCPT TO: Can't send mail - all recipients were rejected: 550 <redacted>: Recipient address rejected`
- `provider_error: SMTP EENVELOPE at RCPT TO: … 451 Try again later`
- `provider_error: SMTP ETIMEDOUT at CONN: Greeting never received`
- `provider_error: SMTP EMESSAGE at DATA: Message failed: 554 Message rejected` (DATA 5xx is retried, not rejected)
- `provider_error: SMTP ESOCKET at CONN: connect ECONNREFUSED 127.0.0.1:3229`

## 7. Errors hit

1. **Baseline run at the snapshot: 8 tests failed** in `lib/booking/client.test.ts`, `lib/i18n/registry.test.ts` and `lib/server/booking/input.test.ts`.
   - Cause: the copy included the other agent's uncommitted, in-progress RED test edits from phase 4's final fix wave (the git status showed M on those files and on `e2e/availability-mock.ts`).
   - Fix: in this clone only, `git checkout --` of those four files back to HEAD `04e0692`. Baseline became 53 files, 580 tests, all green. The main checkout was not touched.
2. **11 submit-reservation tests failed, plus an unhandled rejection:** "`after` was called outside a request scope" (`__NEXT_ERROR_CODE E468`).
   - Cause: `submitReservation` now calls `next/server` `after()`, which throws without a request store (`node_modules/next/dist/server/after/after.js`). The integration test calls the action directly from Vitest.
   - Fix: `vi.mock('next/server')` with `importOriginal`, replacing `after` with a collector built by `vi.hoisted`. A new test runs the collected task and asserts that the rows become sent.
3. **migration-007 test: expected `email_outbox_event_check` but the insert hit `email_outbox_audience_event`.**
   - Cause: test bug: `'guest.edited'` with audience `'staff'` trips the audience CHECK first.
   - Fix: insert it with audience `'guest'`, so only the event CHECK can fail.
4. **Sink subjects arrived as `'=?UTF-8?Q?=C4=90=E1=BA=B7t_b=C3=A0n_m…?='`.**
   - Cause: nodemailer RFC 2047-encodes a non-ASCII Subject; the raw header is not decoded.
   - Fix: the sink's `header()` decodes Q and B encoded-words (joining adjacent words) and only looks in the header block.
5. **Skip test expected sent 2 / skipped 2 and got sent 1 / skipped 3; the overview test expected failed=1 and got 2.**
   - Cause: wrong expectations. `staff.new` is also stale once the booking is cancelled, and two staff rows existed when all rows were marked failed.
   - Fix: corrected to sent 1 / skipped 3 (with a reason row per event), and failed only `min(id)`.
6. **After adding the address filter, 9 email-outbox tests failed: no guest rows were queued.**
   - Cause: the SQL regex `'^[^@\s]+@[^@\s]+$'` sat inside a JS template literal, where `\s` becomes `s`. The pattern excluded every address containing an `s`.
   - Fix: use the POSIX class `[:space:]` in SQL held in template literals, and keep backslashes out of SQL comments in those literals too.
7. **An order-dependent failure when running a subset of files:** submit-reservation saw `staff.test` rows and recipients left behind by other files.
   - Cause: booking-less `staff.test` rows and `notification_recipients` survive `DELETE FROM reservations`. The full-suite file order had hidden it.
   - Fix: submit-reservation's `beforeEach` deletes `email_outbox` and `notification_recipients`; email-outbox and cron-outbox truncate in `afterAll`. The subset and the full suite both pass.
8. **Lint gained two warnings (19 → 21):** `import(no-named-as-default-member)` on `nodemailer.createTransport`, and `no-shadow` (`sink`) in a test.
   - Cause: default import of nodemailer used as a namespace; a local variable shadowed a helper.
   - Fix: `import { createTransport } from 'nodemailer'`; renamed the local to `logged`. Back to 19, the same as HEAD.
9. **Design trap found while evaluating vercel.ts:** `export const config: VercelConfig = { crons: [...] }` (the `@vercel/config` README and skill example) compiles to `{"config":{"crons":[...]}}`, and `npx @vercel/config validate` still says "✓ Config is valid".
   - Cause: the `@vercel/config` 0.7.2 CLI merges named exports as top-level keys; only the default export is the config root.
   - Fix: chose vercel.json; removed `@vercel/config`. It also pulls zod 3.25.76 and 3 high npm-audit findings via path-to-regexp. If vercel.ts is ever used, it must be `export default config`.
10. **A probe printing error strings through `console.log` inside Vitest showed nothing in the piped output.**
    - Cause: Vitest's reporter output did not reach `grep` in that run.
    - Fix: the probe wrote its results to a scratch file instead (the error strings are listed in §6).

## 8. Package versions
- **`nodemailer@10.0.13`** (dependency, `^10.0.13`). It ships its own TypeScript declarations (`dist/esm/*.d.ts` and `dist/cjs/*.d.ts`, beside the JS that its exports map points at; the map has no `types` condition, and TypeScript picks the sibling `.d.ts`). Under TypeScript 7.0.2 with `moduleResolution: 'bundler'`, both `import { createTransport } from 'nodemailer'` and `import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport'` typecheck (`./lib/smtp-transport` is in the exports map). Do NOT add `@types/nodemailer`. No peer deps; engines node >=20 (local Node 22.22.0, Vercel Node 24). Turbopack bundles it into a server chunk with no build warnings.
- **`smtp-server@3.19.16`** (devDependency): the in-process test sink. Depends on nodemailer 10.0.13 (deduped). Its built-in localhost TLS certificate is used in tests only; `logger: false` silences its warning.
- **`@types/smtp-server@3.5.13`** (devDependency). Brings `@types/nodemailer@8.0.2` transitively (its `index.d.ts` has `/// <reference types="nodemailer" />`); our imports never resolve to it, because nodemailer's own types win. Typecheck stays green.
- **`resend@6.31.0`**: removed from dependencies; no import remains (the new guard test enforces it).
- Evaluated and rejected: **`@vercel/config@0.7.2`**. It nests `zod@3.25.76` next to the app's zod 4.6.5, `npm audit` reports 3 high (path-to-regexp via `@vercel/routing-utils`), and it has the export-const footgun. Final `npm audit`: 0 vulnerabilities.
- Unchanged: next@16.3.7, react@19.3.0, typescript@7.0.2, pg@8.23.0, zod@4.6.5, react-email@6.11.0, better-auth@1.7.7, vitest@5.0.3, @playwright/test@1.63.0, oxlint@1.86.0, @vercel/functions@3.9.9; Postgres 18.3 locally (`gen_random_uuid` and STORED generated columns are used).

## 9. The spike's recommended task breakdown

Each task gets the phase-4 gate (typecheck, lint, unit + integration with `TEST_DB_TAG`, build, check-prerender, targeted E2E). Order and contents:

**T1. Migration 007 + `test/integration/migration-007.test.ts`** (and `TEST_DB_TAG` naming `migrate007`).
- `site_settings` created early, with email only. Tell phase 6 to use `ALTER … ADD COLUMN`, not `CREATE TABLE`.
- `notification_recipients`.
- `email_outbox`: generated STORED key, CHECKs, indexes.
- No change to `reservation_events`.

**T2. SMTP replaces Resend for ALL email.**
- `types.ts`: codes `missing_smtp_config` and `rejected`; `redactEmails`; `MailTransport`.
- `smtp.ts`: env parsing, timeouts, `requireTLS`, a non-pooled transport.
- `send.ts`: `openMailer`/`createEmailSender`, the Message-ID from key or explicit, the 30 s cap, error classification.
- `auth-emails.ts` comments; `lib/admin/auth-errors.ts` map + test.
- Remove resend; add nodemailer; dev smtp-server and @types/smtp-server.
- `test/helpers/smtp-sink.ts`; `lib/server/email/smtp.test.ts`; rewritten `email.test.ts`.
- `mail-transport.guard.test.ts` replaces `resend-import.guard.test.ts`.
- README env table and SMTP section; staff invite/reset tests stay green.

**T3. Outbox writes in the change's transaction.**
- `lib/server/email/outbox.ts`: `outboxEnv`, `EVENT_STATUSES`, `reachesSql`, queue functions, `outboxEffects`, `queueTestEmail`, `requeueFailed`, `emailOverview`.
- `create.ts`: event `RETURNING id`, `outboxIds`.
- The admin actions pass effects and `notifyGuest`.
- The `Checkbox` zod schema; the three UI checkboxes (defaults to confirm with the user).
- The queueing half of `email-outbox.test.ts`.

**T4. The drain and its triggers.**
- `drain.ts`: claim one row with lease, re-read/skip, render seam, send, fenced marks, retry ladder, reaping, PII-free logs.
- `after-commit.ts` plus wiring in `submitReservation` and the three admin actions.
- `lib/server/cron.ts` + `app/api/cron/outbox/route.ts` (`maxDuration 300`); `vercel.json` cron `"*/5 * * * *"`.
- The `vi.mock('next/server')` collector in `submit-reservation.test.ts`.
- The drain half of `email-outbox.test.ts` (retry, Message-ID, skip, concurrency, crash, fencing, reaping, env, log/preview, SMTP down); `cron-outbox.test.ts`.
- Optional: extend `check-prerender` to assert that `/api/cron/outbox` is not prerendered.

**T5. Templates** (from the templates spike). Replace the placeholder `templates/booking.tsx` copy with registry keys `email.<event>.<field>` in EN/VI. Keep the `renderBookingEmail(event, locale, data)` signature, and decide the language for a booking whose locale is disabled.

**T6. Screens** (from the screens spike).
- `/admin/reservations/emails`: the log, "Gửi lại" = `requeueFailed` for failed rows, a new row for sent ones.
- `/admin/settings/notifications`: recipients CRUD, the general email (`site_settings.email`), "Gửi email thử" = `queueTestEmail` + `drainOutbox({ids:[id], alsoDue:false})`.
- Overview counts via `emailOverview`.
- Email list on `/admin/reservations/[id]`.
- Each needs `requirePermission` plus a guard-table entry.

**T7. Anti-spam and privacy** (from the anti-spam spike), including SEC-2.

**T8. E2E acceptance** (`e2e/booking-email.spec.ts`: new booking → staff + guest, confirm → guest, cron 401/200, a failed email retried, no recipients → general email; bots blocked from T7) and the README runbook (user steps). Pre-flight for Neon: 007 adds only new tables, so nothing to check except that `gen_random_uuid` exists (PG13+).

**Merge note:** the phase-4 final fix wave is landing now on `create.ts`, the admin reservation actions, `TransitionPanel`/`AffectedList`/`NewReservationForm` and the booking tests. Rebase T3/T4 on that final code; the patch at `scratchpad/p5-outbox.patch` is against `04e0692`.

## 10. Risks and open questions
1. **At-least-once delivery** (accepted trade-off; the plan must say it). A duplicate is possible: (a) the function dies after the SMTP server answered 250 but before `sent` is written; (b) the 30 s cap fires while the server is still processing DATA (a test proves the server can accept the message after the client gave up); (c) the DB `sent` UPDATE fails after a successful send (the catch path schedules a retry). Mitigation: the lease (no re-send for 120 s), the attempts fence, and the same Message-ID on every copy, which mail clients and Gmail often collapse (not guaranteed).
2. **Vercel Cron runs only on Production deployments.** On Preview, retries happen only when a later write's `after()` drains due rows (or someone presses "Gửi lại"/"Gửi email thử"), so a failed Preview email can sit queued.
3. **Outbound SMTP from Vercel functions is unverified** (port 25 is normally blocked; 587/465 are expected to work). The first Preview with redirect mode and "Gửi email thử" must confirm it.
4. **Provider limits are unknown until the user picks an SMTP provider.** Examples: Microsoft 365 needs "Authenticated SMTP" enabled per mailbox (often off by default); Google Workspace needs an app password and has daily send caps. The cron drains at most 500 rows or 240 s per run, sequentially (about 1 connection per email).
5. **Deliverability:** `EMAIL_FROM` must be an address the SMTP login may send as. DKIM must sign for the From domain, and SPF/DMARC must align, or guest providers will spam-folder or reject. A new DMARC policy should start at `p=none`.
6. **Message-ID deviates from the literal `<outbox-{id}@domain>`:** it adds a 12-hex random part fixed at the first claim, so forked or Preview DBs and several dev DBs never mint the same ID, which Gmail could treat as a duplicate and drop. If `EMAIL_FROM` is missing at the first claim (log mode), `message_id` stays NULL and is set at the first claim that knows the domain.
7. **Skip semantics are a product decision:** `staff.new` is skipped once the booking no longer holds covers (e.g. staff cancelled it before the note went out); a guest email is skipped if the booking's email changed after queueing (a fixed typo is not re-sent automatically). 5xx at DATA (e.g. 554 spam rejection) is retried, not failed at once.
8. **UI defaults to confirm with the user:** "Báo khách" on for single cancel AND for bulk cancel from a closure's affected list (a closure may email many guests at once), and "Gửi email xác nhận" on for staff phone bookings. Walk-ins never get `guest.confirmed`, although the spec row lists both.
9. **A guest address that the phase-4 guest validator accepts but the outbox CHECK refuses (two `@`) is now silently not emailed.** Consider tightening the guest zod (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`) in the anti-spam task.
10. **Language:** guest emails use `reservations.locale`, so a staff booking in `vi` gets Vietnamese mail even while `vi` is disabled on the web (phase-4 risk 21). The templates task must decide.
11. **Phase-3 deferred items still open:** `appOrigin()` silently falls back to `http://localhost:3000`. `staff.new` links to `/admin/reservations/<id>` would then be wrong in live mode; make it fail closed when `EMAIL_DELIVERY` is live or redirect. Also split `staff.ts` `deliverInvite`'s send from its bookkeeping UPDATE.
12. **Bulk cancel:** if one transition throws mid-loop, the action returns an error and the already-committed cancellations' emails wait for the cron (up to 5 minutes) instead of `after()`.
13. **Phase-10 anonymiser** must overwrite `email_outbox.to_email` with a placeholder that passes the CHECK (e.g. `'anonymized@invalid'`). `last_error` and `provider_id` are already redacted of addresses; `message_id` holds no personal data.
14. **Preview branches fork production's `email_outbox` and `notification_recipients`.** Rows with `env='production'` are never drained on Preview (tested), but a Preview's own new bookings would email production's recipient list unless `EMAIL_DELIVERY=redirect`, so redirect must be set on Preview.
15. **The E2E run happened before two late SQL-only edits** (the `[:space:]` address filter and the overview query). Unit/integration tests cover both; a final build + E2E in the real phase-5 run should re-confirm.
16. **Rebase risk:** the other agent is committing phase 4's final fix wave on the same files (`create.ts`, the admin reservation actions, `TransitionPanel`, `AffectedList`, `NewReservationForm`, booking tests).

## 11. Spec deviations proposed by the spike
1. Spec §4/§10.4 Resend → traditional SMTP via nodemailer (user decision). The Resend Idempotency-Key becomes a deterministic, persisted Message-ID plus the claim/lease/fence protocol; delivery is at least once.
2. §15 items 4–5 (Resend account, DNS for a Resend subdomain) are replaced: the user provides the SMTP account, the From address, and SPF/DKIM/DMARC at their mail provider.
3. §5.2 `site_settings` is a phase-6 table: migration 007 creates it early, with only `email` (NOT NULL, seeded `fb@furamavietnam.com`), as the `staff.new` fallback store.
4. §10.4 email events are recorded only in `email_outbox`. `reservation_events`' type CHECK is not extended, so sends do not appear in `/admin/audit`; the booking detail page reads `email_outbox`.
5. `email_outbox` gains columns beyond §5.2: `reservation_event_id`, `fallback`, `message_id`, `created_by`, `created_at`, `updated_at`, plus an extra event `'staff.test'` (`reservation_id` NULL) for "Gửi email thử". `notification_recipients.events` is restricted to `['staff.new']` by CHECK.
6. Message-ID format is `'<outbox-{id}.{12-hex}@{EMAIL_FROM domain}>'` rather than `'<outbox-{id}@domain>'` (collision safety across DB forks).
7. Retry policy: an SMTP 5xx at RCPT TO (`rejected`) fails immediately instead of using all 7 attempts. Attempts are counted at claim time. A lease (120 s) and the reaping of a claim that died on attempt 7 are added.
8. Skip-on-mismatch rules made concrete: `staff.new` while requested/confirmed/seated; `guest.ack` while requested; `guest.confirmed` while confirmed; `guest.declined` while declined; `guest.cancelled` while cancelled. Guest rows are also skipped if the booking email changed or the booking was anonymised.
9. §10.3 staff create: `guest.confirmed` only for phone bookings (status confirmed); walk-ins are ignored even if ticked. "Gửi email xác nhận" defaults on; bulk cancel also has a "Báo khách" checkbox, default on.
10. `after()` drains the ids it queued, then other due rows of the env (limit 10, 25 s budget). It is scheduled on every successful booking write, including those that queued nothing.
11. Cron config is in `vercel.json`, not `vercel.ts`. The cron route requires a `CRON_SECRET` of 16+ characters (a shorter or unset secret makes every call 401).
12. Email error codes: `missing_api_key` → `missing_smtp_config`; new code `'rejected'`.

## 12. User steps
1. Choose and provide an SMTP account (traditional SMTP): host, port 587 (STARTTLS) or 465 (TLS), username and password (an app password if the provider requires one). Make sure the provider allows SMTP AUTH for that mailbox; for Microsoft 365, enable "Authenticated SMTP" for that mailbox.
2. Choose the From address (`EMAIL_FROM`, e.g. `'Furama Cuisine <no-reply@<domain>>'`). It must be an address or alias the SMTP login is allowed to send as.
3. Have IT Furama set SPF, DKIM and DMARC for that sending domain at the mail provider: SPF include of the provider, DKIM signing enabled for the From domain, and a DMARC record (start with `p=none`, then tighten). First check whether the root domain already has a DMARC record.
4. In Vercel → Project → Settings → Environment Variables, Production: `EMAIL_DELIVERY=live`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT` (587 or 465), `SMTP_USER`, `SMTP_PASSWORD` (optionally `SMTP_SECURE`), and `CRON_SECRET` = a fresh random value of 16+ characters (e.g. `openssl rand -hex 32`).
5. Same place, Preview: `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<team inbox>`, `EMAIL_FROM`, `SMTP_*` (a separate login if the provider allows). Remove `RESEND_API_KEY` from every environment; it is no longer used.
6. After the first Preview deploy, press "Gửi email thử" (or book a test table) and confirm the mail arrives. This checks that Vercel functions can reach the provider on 587/465 (port 25 is blocked).
7. After the first Production deploy (Vercel Pro is in place), check under Project → Settings → Cron Jobs that `/api/cron/outbox` runs every 5 minutes. The cron only runs on Production.
8. Give the notification recipients per restaurant or destination (and any "all" addresses). Confirm that the general email `fb@furamavietnam.com` (`site_settings.email`) should receive new-booking notices when nobody else is listed.
9. Run migration 007 on Neon after 006, in the deploy window of phase 5. It only adds tables, and needs `gen_random_uuid` (core in PG13+).
