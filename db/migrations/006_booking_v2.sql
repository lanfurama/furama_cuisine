-- Phase 4: booking v2 (spec §5.2 "Đặt bàn (đợt 4)", §7.4, §10).
--
-- Expand only: every existing column and row stays. Safe on a database that
-- already holds phase-1 bookings: they become source 'legacy' and is_test,
-- with their meal backfilled and a 'created' event from the system. Re-running
-- the file changes nothing apart from re-validating the named CHECKs.
-- notification_recipients and email_outbox belong to phase 5.
--
-- From here on this file owns the audit_feed view (re-running 005 would drop
-- its reservation branch), so test/integration/migration-005.test.ts stops at 005.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── booking_settings ──────────────────────────────────────────────────────
-- One row: the defaults every restaurant inherits (the restaurant columns
-- below override them when not NULL).
CREATE TABLE IF NOT EXISTS booking_settings (
  id                   boolean     PRIMARY KEY DEFAULT true CONSTRAINT booking_settings_single_row CHECK (id),
  window_days          smallint    NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 90),
  lead_minutes         smallint    NOT NULL DEFAULT 30 CHECK (lead_minutes BETWEEN 0 AND 1440),
  -- NULL: no cut-off. '17:00': from 17:00 Da Nang time, no online booking for the same day.
  same_day_cutoff      time        CHECK (extract(second FROM same_day_cutoff) = 0),
  max_party            smallint    NOT NULL DEFAULT 12 CHECK (max_party BETWEEN 1 AND 50),
  auto_confirm         boolean     NOT NULL DEFAULT false,
  guest_ack_email      boolean     NOT NULL DEFAULT true,   -- read from phase 5
  pii_retention_months smallint    NOT NULL DEFAULT 24 CHECK (pii_retention_months BETWEEN 1 AND 120),  -- read from phase 10
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);

INSERT INTO booking_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ── restaurants: the booking switch and per-restaurant overrides ──────────
-- NULL = inherit booking_settings. same_day_cutoff is global only (spec §5.2).
-- updated_at/updated_by are also in the phase-6 column list; IF NOT EXISTS
-- keeps whichever migration runs second harmless.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS booking_enabled boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS window_days     smallint    CHECK (window_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS lead_minutes    smallint    CHECK (lead_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS max_party       smallint    CHECK (max_party BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS auto_confirm    boolean,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by      text;

-- ── service_periods ───────────────────────────────────────────────────────
-- The weekly template. Slots run first_seating, + interval_min, … last_seating.
-- A service may not cross midnight (last_seating >= first_seating).
CREATE TABLE IF NOT EXISTS service_periods (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id   text        NOT NULL REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  meal            text        NOT NULL CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks')),
  -- ISO weekdays: 1 = Monday … 7 = Sunday.
  weekdays        smallint[]  NOT NULL DEFAULT '{1,2,3,4,5,6,7}'
                  CONSTRAINT service_periods_weekdays_check
                  CHECK (cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  first_seating   time        NOT NULL,
  last_seating    time        NOT NULL,
  interval_min    smallint    NOT NULL DEFAULT 30 CHECK (interval_min IN (15, 20, 30, 45, 60, 90, 120)),
  covers_per_slot integer     NOT NULL CHECK (covers_per_slot BETWEEN 0 AND 1000),
  active          boolean     NOT NULL DEFAULT true,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text,
  CONSTRAINT service_periods_order CHECK (last_seating >= first_seating),
  -- Whole minutes, and last_seating is itself a slot.
  CONSTRAINT service_periods_grid CHECK (
    extract(second FROM first_seating) = 0
    AND extract(second FROM last_seating) = 0
    AND (extract(epoch FROM last_seating - first_seating)::integer / 60) % interval_min = 0
  )
);

CREATE INDEX IF NOT EXISTS service_periods_restaurant_idx ON service_periods (restaurant_id, sort_order);

-- Seed: today's behaviour exactly, i.e. the global SLOTS of lib/data.ts for
-- each meal in restaurants.meals, every weekday, slot_capacity covers per slot
-- (test/integration/booking-seed.test.ts compares the two for every restaurant
-- and weekday). Skips a restaurant that already has periods.
INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, interval_min, covers_per_slot, sort_order)
SELECT r.id, s.meal, s.first_seating, s.last_seating, s.interval_min, r.slot_capacity, s.sort_order
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.meals) AS m(meal)
  JOIN (VALUES ('Breakfast', time '06:30', time '09:30', 30, 10),
               ('Lunch',     time '11:30', time '13:30', 30, 20),
               ('Drinks',    time '17:00', time '22:00', 60, 30),
               ('Dinner',    time '18:00', time '21:00', 30, 40))
       AS s(meal, first_seating, last_seating, interval_min, sort_order)
    ON s.meal = m.meal
 WHERE NOT EXISTS (SELECT 1 FROM service_periods p WHERE p.restaurant_id = r.id);

-- ── closures → closure_i18n ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS closures (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text        NOT NULL CHECK (scope IN ('all', 'destination', 'restaurant')),
  destination_id text        REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  restaurant_id  text        REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Inclusive on both ends.
  starts_on      date        NOT NULL,
  ends_on        date        NOT NULL,
  -- NULL: the whole day. Otherwise only these services close.
  meals          text[]      CONSTRAINT closures_meals_check
                 CHECK (meals IS NULL OR (cardinality(meals) BETWEEN 1 AND 4
                        AND meals <@ ARRAY['Breakfast', 'Lunch', 'Dinner', 'Drinks'])),
  show_reason    boolean     NOT NULL DEFAULT true,
  internal_note  text        CHECK (length(internal_note) <= 2000),  -- never sent to guests
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text,
  CONSTRAINT closures_dates CHECK (starts_on <= ends_on),
  CONSTRAINT closures_scope_target CHECK (
    (scope = 'all'         AND destination_id IS NULL     AND restaurant_id IS NULL) OR
    (scope = 'destination' AND destination_id IS NOT NULL AND restaurant_id IS NULL) OR
    (scope = 'restaurant'  AND restaurant_id IS NOT NULL  AND destination_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS closures_dates_idx ON closures (ends_on, starts_on);

-- The guest-facing reason, per language; a row exists only when a reason was
-- typed. Same translation columns as content_strings (spec §5.1).
CREATE TABLE IF NOT EXISTS closure_i18n (
  closure_id    bigint      NOT NULL REFERENCES closures (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  -- Blank counts as empty, as for reservation_notes.body: a reason of spaces
  -- would reach the guest in place of the default "Closed" (and hide the
  -- default language's reason), so only real text may make a row.
  public_reason text        NOT NULL CHECK (btrim(public_reason) <> '' AND length(public_reason) <= 160),
  status        text        NOT NULL DEFAULT 'reviewed' CHECK (status IN ('machine', 'reviewed')),
  origin        text        NOT NULL DEFAULT 'human'    CHECK (origin IN ('human', 'ai', 'seed')),
  ai_model      text,
  source_hash   text,
  reviewed_by   text,
  reviewed_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text,
  PRIMARY KEY (closure_id, locale)
);

-- ── search folding ────────────────────────────────────────────────────────
-- Lower case without accents, the SQL twin of fold() in lib/booking.ts, step
-- for step: lower, NFD, strip U+0300–U+036F, then translate the letters NFD
-- leaves whole (test/integration/migration-006.test.ts pins the two together),
-- so decomposed input (Unikey's "Unicode tổ hợp", pasted text) folds like
-- precomposed. The lists are generated from fold(). Beyond đ/Đ they lower what
-- lower() leaves under a C collation (the database's collation is not ours to
-- choose): it skips non-ASCII capitals, so Ấ only becomes A after NFD, and Æ,
-- Ø, Ł, Œ… never decompose. Under C, other scripts' capitals keep their case.
CREATE OR REPLACE FUNCTION fold_search(value text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT
AS $$
  SELECT translate(regexp_replace(normalize(lower(value), NFD), '[\u0300-\u036f]', '', 'g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' || 'ÆÐØÞĐđĦĲĿŁŊŒŦ',
    'abcdefghijklmnopqrstuvwxyz' || 'æðøþddħĳŀłŋœŧ')
$$;

-- What the inbox search matches (spec §5.2 search_text): the folded name,
-- email, reference, the phone's digits and its Vietnamese national form, and
-- the typed phone's digits when they say something new.
CREATE OR REPLACE FUNCTION reservation_search_text(guest_name text, email text, phone text, phone_e164 text, reference text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT concat_ws(' ',
    fold_search(guest_name),
    lower(email),
    lower(reference),
    substr(phone_e164, 2),
    CASE WHEN phone_e164 LIKE '+84%' THEN '0' || substr(phone_e164, 4) END,
    NULLIF(NULLIF(NULLIF(regexp_replace(phone, '\D', '', 'g'), ''), substr(phone_e164, 2)),
           CASE WHEN phone_e164 LIKE '+84%' THEN '0' || substr(phone_e164, 4) END))
$$;

-- ── reservations: the v2 columns ──────────────────────────────────────────
-- reserved_at stays text; compare it in SQL as reserved_at::time. Check the old
-- rows before adding the CHECK, so a bad row stops the migration with a message.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
  IF n > 0 THEN
    RAISE EXCEPTION '% booking(s) have a reserved_at that is not HH:MM; correct them, then migrate again', n;
  END IF;
END $$;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_reserved_at_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_reserved_at_check
  CHECK (reserved_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- The phase-1 statuses keep their names; three are new.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check
  CHECK (status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'));

-- The real limit is max_party; this is only a sanity bound.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_guests_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 50);

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS meal          text,
  ADD COLUMN IF NOT EXISTS locale        text        NOT NULL DEFAULT 'en'
                                         REFERENCES locales (code) ON UPDATE CASCADE,
  -- Rows that exist now are phase-1 bookings: 'legacy'. The default is dropped
  -- just below, so every new row names its source.
  ADD COLUMN IF NOT EXISTS source        text        NOT NULL DEFAULT 'legacy'
                                         CHECK (source IN ('web', 'phone', 'walk_in', 'staff', 'legacy')),
  -- The FK to offers arrives with the offers table (phase 6).
  ADD COLUMN IF NOT EXISTS offer_id      bigint,
  -- Staff may book past capacity with a reason, which goes on the event (spec §10.3).
  ADD COLUMN IF NOT EXISTS over_capacity boolean     NOT NULL DEFAULT false,
  -- Why staff declined or cancelled: free text staff type about a guest, so
  -- phase 10's anonymiser sets it to NULL.
  ADD COLUMN IF NOT EXISTS status_reason text        CHECK (length(status_reason) <= 500),
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  -- Kept by the reservations_before_write trigger; NULL once anonymised.
  ADD COLUMN IF NOT EXISTS search_text   text,
  ADD COLUMN IF NOT EXISTS is_test       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  -- Optimistic concurrency: the trigger bumps it on every UPDATE.
  ADD COLUMN IF NOT EXISTS version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by    text;

ALTER TABLE reservations ALTER COLUMN source DROP DEFAULT;

-- Backfill the phase-1 rows. The meal is the restaurant's period that serves
-- the time (just seeded from the same SLOTS the booking was made against).
UPDATE reservations r
   SET meal = COALESCE(
         (SELECT p.meal FROM service_periods p
           WHERE p.restaurant_id = r.restaurant_id
             AND r.reserved_at::time BETWEEN p.first_seating AND p.last_seating
           ORDER BY p.sort_order, p.first_seating
           LIMIT 1),
         CASE WHEN r.reserved_at < '11:00' THEN 'Breakfast'
              WHEN r.reserved_at < '17:00' THEN 'Lunch'
              ELSE 'Dinner' END)
 WHERE r.meal IS NULL;

-- Before the trigger exists, so the old rows keep version 1.
UPDATE reservations
   SET search_text = reservation_search_text(guest_name, email, phone, phone_e164, reference),
       -- Every booking made before launch is test data (spec §11): purge before launch A.
       is_test = true
 WHERE source = 'legacy' AND search_text IS NULL AND anonymized_at IS NULL;

UPDATE reservations SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE reservations
  ALTER COLUMN meal SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_meal_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_meal_check
  CHECK (meal IN ('Breakfast', 'Lunch', 'Dinner', 'Drinks'));

-- search_text, version and updated_at belong to the database, so no write path
-- can forget them: every UPDATE bumps the version (spec §10.3), and an
-- anonymised row keeps no search text (spec §11). App SQL never sets them.
CREATE OR REPLACE FUNCTION reservations_before_write() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_text := CASE WHEN NEW.anonymized_at IS NULL THEN
    reservation_search_text(NEW.guest_name, NEW.email, NEW.phone, NEW.phone_e164, NEW.reference)
  END;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_before_write ON reservations;
CREATE TRIGGER reservations_before_write
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_before_write();

-- ── reservations: indexes ─────────────────────────────────────────────────
-- reservations_dedupe_v2_idx (migration 003) stays as it is.
-- Covers held per slot: the availability read and the capacity check. Holding
-- statuses are requested, confirmed and seated (spec §10.3).
DROP INDEX IF EXISTS reservations_slot_idx;
CREATE INDEX IF NOT EXISTS reservations_load_idx
  ON reservations (restaurant_id, reserved_on, reserved_at) INCLUDE (guests)
  WHERE status IN ('requested', 'confirmed', 'seated');
CREATE INDEX IF NOT EXISTS reservations_inbox_idx ON reservations (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_created_idx ON reservations (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_pending_idx
  ON reservations (reserved_on, reserved_at, id) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS reservations_day_idx ON reservations (reserved_on, restaurant_id, reserved_at);
CREATE INDEX IF NOT EXISTS reservations_phone_idx ON reservations (phone_e164, reserved_on);
CREATE INDEX IF NOT EXISTS reservations_search_trgm_idx ON reservations USING gin (search_text gin_trgm_ops);

-- ── reservation_events, reservation_notes ─────────────────────────────────
-- The booking timeline. Booking writes go here INSTEAD of audit_log (spec §7.4).
-- actor_* are snapshots without FKs, like audit_log. Phase 5 replaces
-- reservation_events_type_check when it adds the email events.
CREATE TABLE IF NOT EXISTS reservation_events (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_kind     text        NOT NULL CHECK (actor_kind IN ('guest', 'staff', 'system')),
  actor_id       text,
  actor_label    text,
  type           text        NOT NULL CHECK (type IN ('created', 'status_changed', 'edited', 'note_added')),
  from_status    text        CHECK (from_status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined')),
  to_status      text        CHECK (to_status IN ('requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined')),
  -- What changed. An edit records each changed field as [before, after]:
  -- date, time, guests, name, phone, phone_e164, email and note (the guest's
  -- own words, often allergies or health details), and over_capacity. A staff
  -- booking records source (and over_capacity), a note only its note_id.
  -- Phase 10 anonymises by an allowlist, not a blocklist: it keeps date, time,
  -- guests, over_capacity, source and note_id and drops every other key, so a
  -- key added later is treated as personal unless it joins that list.
  changes        jsonb,
  -- Free text staff type about a guest (a status change's reason, or why a
  -- booking may go over capacity): phase 10's anonymiser sets it to NULL.
  reason         text        CHECK (length(reason) <= 500),
  CONSTRAINT reservation_events_staff_actor CHECK (actor_kind <> 'staff' OR actor_id IS NOT NULL),
  CONSTRAINT reservation_events_created_status CHECK (type <> 'created' OR to_status IS NOT NULL),
  CONSTRAINT reservation_events_transition CHECK (
    type <> 'status_changed' OR (from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status)
  )
);

CREATE INDEX IF NOT EXISTS reservation_events_reservation_idx ON reservation_events (reservation_id, at, id);
CREATE INDEX IF NOT EXISTS reservation_events_at_idx ON reservation_events (at DESC, id DESC);

-- Internal staff notes: never shown or sent to the guest.
CREATE TABLE IF NOT EXISTS reservation_notes (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint      NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  author_id      text        NOT NULL,
  author_label   text        NOT NULL,
  body           text        NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reservation_notes_reservation_idx ON reservation_notes (reservation_id, created_at);

-- The phase-1 rows get their 'created' event, once. A migration is not a guest.
INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_label, type, to_status, reason)
SELECT r.id, r.created_at, 'system', 'migration 006', 'created', r.status, 'phase-1 booking'
  FROM reservations r
 WHERE r.source = 'legacy'
   AND NOT EXISTS (SELECT 1 FROM reservation_events e WHERE e.reservation_id = r.id);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- Exactly the columns of migration 005, in its order (CREATE OR REPLACE VIEW
-- may only append, and /admin/audit reads these); reservation events join the
-- feed. `id` is the numeric id as text in both branches. A guest's event has no
-- label: the feed calls it 'Khách', so /admin/audit does not show it as the
-- system's.
CREATE OR REPLACE VIEW audit_feed AS
SELECT 'audit'::text   AS source,
       a.id::text      AS id,
       a.at,
       a.actor_id,
       a.actor_email   AS actor_label,
       a.action,
       a.entity_type,
       a.entity_id,
       a.locale,
       a.before,
       a.after
  FROM audit_log a
UNION ALL
SELECT 'reservation'::text,
       e.id::text,
       e.at,
       e.actor_id,
       COALESCE(e.actor_label, CASE e.actor_kind WHEN 'guest' THEN 'Khách' END),
       'reservation.' || e.type,
       'reservation'::text,
       e.reservation_id::text,
       NULL::text,
       CASE WHEN e.from_status IS NOT NULL THEN jsonb_build_object('status', e.from_status) END,
       jsonb_strip_nulls(jsonb_build_object('status', e.to_status, 'changes', e.changes, 'reason', e.reason))
  FROM reservation_events e;
