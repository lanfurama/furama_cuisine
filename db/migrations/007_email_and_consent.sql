-- Phase 5: booking email over SMTP (spec §5.2, §10.4) and the guest's privacy
-- consent (spec §11).
--
-- Expand only, one transaction, safe to re-run: three new tables, their
-- indexes, and two nullable columns on reservations. Nothing else in 001–006
-- changes. In particular reservation_events keeps 006's type CHECK: email
-- history lives in email_outbox (one row per recipient, with its status and
-- attempts), and the booking page reads it beside the timeline. A send is not
-- a change to the booking, so it stays out of reservation_events and out of
-- /admin/audit.

-- ── site_settings (early, phase 6 extends it) ─────────────────────────────
-- Spec §5.2 lists site_settings under phase 6; phase 5 needs one of its
-- columns now: the general email, where staff.new goes when no
-- notification_recipients row matches (§10.4), and where a guest's reply to a
-- booking email lands. One row, so the footer's general email (phase 6/7) and
-- the fallback are the same address. PHASE 6: add the other columns with
-- ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS …, never CREATE TABLE.
CREATE TABLE IF NOT EXISTS site_settings (
  id         boolean     PRIMARY KEY DEFAULT true CONSTRAINT site_settings_single_row CHECK (id),
  email      text        NOT NULL CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

-- CONTACT.email of lib/data.ts, the address the guest site already shows.
INSERT INTO site_settings (id, email) VALUES (true, 'fb@furamavietnam.com') ON CONFLICT DO NOTHING;

-- ── notification_recipients ───────────────────────────────────────────────
-- Who hears about new bookings. A booking reaches the union of the active rows
-- for its restaurant, its destination and 'all', deduplicated by address
-- (lib/server/email/recipients.ts holds the one predicate).
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

-- One row per address and target, whatever its case; the same address may sit on several targets.
CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_target_email_idx
  ON notification_recipients (scope, coalesce(destination_id, ''), coalesce(restaurant_id, ''), lower(email));

-- ── email_outbox ──────────────────────────────────────────────────────────
-- One row per email and recipient, written in the transaction of the booking
-- change that causes it (§10.4), drained after COMMIT by after(), by the cron
-- and by "Gửi lại". SMTP has no idempotency key, so delivery is at least
-- once: a row is claimed with a lease (status 'sending', locked_until) before
-- the send and marked sent right after; a crash in between re-sends it once
-- the lease ends, with the same Message-ID (message_id, fixed at the first
-- claim) so the copy is recognisable. "Gửi email thử" sends directly and
-- writes no row, so every row belongs to a booking.
CREATE TABLE IF NOT EXISTS email_outbox (
  id                   bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- VERCEL_ENV of the writer ('development' off Vercel). A sender drains only its own env's rows,
  -- so a Preview branch forked from production never sends production's queue.
  env                  text        NOT NULL CHECK (env IN ('production', 'preview', 'development')),
  -- lib/email/events.ts EMAIL_EVENTS.
  event                text        NOT NULL CHECK (event IN ('staff.new', 'guest.ack', 'guest.confirmed', 'guest.declined', 'guest.cancelled')),
  audience             text        NOT NULL CHECK (audience IN ('staff', 'guest')),
  reservation_id       bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  -- The timeline event that queued it (created / status_changed).
  reservation_event_id bigint      REFERENCES reservation_events (id) ON DELETE SET NULL,
  -- One @ (the guest form is looser; the queue filters first). Phase 10's anonymiser
  -- overwrites it with a placeholder that still passes, e.g. 'anonymized@invalid'.
  to_email             text        NOT NULL CHECK (to_email ~ '^[^@\s]+@[^@\s]+$' AND length(to_email) <= 254),
  locale               text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE,
  -- staff.new sent to site_settings.email because no recipient matched.
  fallback             boolean     NOT NULL DEFAULT false,
  -- Spec §5.2's key. STORED: Postgres 18 makes a generated column VIRTUAL by default, which cannot be UNIQUE.
  idempotency_key      text        GENERATED ALWAYS AS ('outbox:' || id::text) STORED
                       CONSTRAINT email_outbox_idempotency_key_key UNIQUE,
  -- lib/email/events.ts EMAIL_STATUSES.
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
  -- The SMTP server's reply to the message ("250 2.0.0 Ok: queued as …"), or the mode in log mode.
  provider_id          text        CHECK (length(provider_id) <= 300),
  sent_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_audience_event CHECK ((audience = 'guest') = (event LIKE 'guest.%')),
  CONSTRAINT email_outbox_sending_leased CHECK (status <> 'sending' OR locked_until IS NOT NULL),
  CONSTRAINT email_outbox_sent_at CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- The drain: due rows of one env, oldest first.
CREATE INDEX IF NOT EXISTS email_outbox_due_idx
  ON email_outbox (env, next_attempt_at, id) WHERE status IN ('queued', 'sending');
-- The booking page's email list.
CREATE INDEX IF NOT EXISTS email_outbox_reservation_idx ON email_outbox (reservation_id, id);
-- The email log (newest first) and the overview's failed count.
CREATE INDEX IF NOT EXISTS email_outbox_log_idx ON email_outbox (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS email_outbox_failed_idx ON email_outbox (created_at DESC, id DESC) WHERE status = 'failed';

-- ── reservations: the guest's consent (spec §11) ──────────────────────────
-- Which version of the privacy policy a web guest agreed to (lib/legal.ts)
-- and when. Every web booking from phase 5 on carries both; staff-entered
-- bookings and older rows carry neither, which is why no CHECK ties them to
-- source = 'web'. Neither column is personal data: the phase-10 anonymiser
-- keeps them. The second branch names consent_version IS NOT NULL itself: a
-- CHECK that evaluates to NULL passes, so length(NULL) alone would let a
-- version-less row with a time through.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at    timestamptz;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_consent_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_consent_check
  CHECK ((consent_version IS NULL AND consented_at IS NULL)
      OR (consent_version IS NOT NULL AND consented_at IS NOT NULL AND length(consent_version) BETWEEN 1 AND 40));
