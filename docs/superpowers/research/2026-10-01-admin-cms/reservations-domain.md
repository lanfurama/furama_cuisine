# Reservations domain redesign for the Furama Cuisine admin: hours, capacity, closures, status lifecycle, the timezone fix, notifications and migration

# Reservations domain redesign (admin CMS)

Scope: I read all the files in the brief plus `db/client.ts`, `scripts/migrate.mjs`, `db/migrations/002_seed_restaurants.sql`, `lib/data.ts`, `app/layout.tsx` and `components/site/Chrome.tsx`. I edited no project files and installed nothing. I reproduced the timezone and reference bugs with a throwaway Node script in the scratchpad.

---

## 0. How it works today (verified)

| Concern | Today | Where |
|---|---|---|
| Hours | One global `SLOTS` table for each meal (Breakfast 06:30–09:30/30′, Lunch 11:30–13:30/30′, Dinner 18:00–21:00/30′, Drinks 17:00–22:00/60′). A restaurant only lists `meals text[]` | `lib/data.ts:39-44`, `lib/booking.ts:46-53`, `001_init.sql:11` |
| Capacity | One `slot_capacity` per restaurant, applied to every slot | `001_init.sql:13`, `db/queries.ts:50-56` |
| Concurrency | One transaction: `SELECT … FOR UPDATE` on the restaurant row, sum the covers, then insert | `db/queries.ts:79-140` |
| Date on the wire | The client sends `day` as an offset from 0 to 13. The server turns it back into a date with `days()[day]` | `SiteProvider.tsx:324-333`, `actions.ts:38-41,62` |
| Status | `requested / confirmed / cancelled` only. No `updated_at`, no history, no locale, no source | `001_init.sql:29-31` |
| Reference | `FC-` plus 5 random digits from `Math.random` | `lib/booking.ts:142` |
| Dedupe | Unique on `(restaurant_id, reserved_on, reserved_at, phone)` using the **raw** phone text | `001_init.sql:40-42` |
| Caching | The root layout has `revalidate = 3600`. `BookingBar` sits in `Chrome` and calls `days()` during SSR | `app/layout.tsx:36`, `Chrome.tsx:39`, `BookingBar.tsx:15` |

## 1. Bugs to fix as part of this work

1. **Wrong date stored for bookings made between 00:00 and 06:59 Vietnam time (Asia/Ho_Chi_Minh, UTC+7).** `days()` sets midnight using the server's clock (`lib/booking.ts:22-30`). `TZ` is a reserved variable on Vercel, so functions run in UTC. I reproduced it with `TZ=UTC` at 2026-10-01T18:00Z (01:00 on 2 Oct in Vietnam): `days()[0] = 2026-10-01` and `days()[13] = 2026-10-14`. A guest in Vietnam picks "Today, 2 Oct 19:00". `actions.ts:62` stores it as **1 Oct**, which is already in the past. Every date picked in that 7-hour window is stored one day early, and `/api/availability` reads covers for the wrong date (`actions.ts:94`).
2. **The server's cutoff runs 7 hours behind.** `isPast()` uses `now.getHours()` (`lib/booking.ts:56-58`). At 19:00 Vietnam time (12:00Z) under `TZ=UTC`, `isPast(0,'13:00')` and `isPast(0,'18:00')` both return **false**. The server would therefore accept today's lunch and dinner slots after they have started. The client check stops this only when the guest's device is set to Vietnam time.
3. **The client uses the device's timezone.** This affects `SiteProvider.tsx:150` (`getHours() >= 21`), `days()` in `BookingBar.tsx:15` and `ReserveDrawer.tsx:46`, and `fmtDay` (`getDay()`/`getMonth()`). A hotel guest whose phone is still on Seoul or Paris time sees a different "today" and a different cutoff from the venue.
4. **The date gets baked into cached HTML.** ISR (`layout.tsx:36`) caches the BookingBar's "Today" label for up to 1 hour, in UTC, so hydration mismatches around midnight Vietnam time.
5. **Reference collisions are reported as duplicates.** There are 90,000 possible references. I computed a 50% chance of at least one collision after **354** bookings. Once 1,000 rows exist, each new booking has a ~1.1% chance of colliding; at 10,000 rows it is ~11%. `db/queries.ts:132-135` treats every `23505` as `duplicate`, so the guest is told "We already have a request…" and the booking is lost.
6. **Dedupe misses the same number written differently.** Because the raw phone text is compared, "0905 000 000" and "+84 905 000 000" don't count as the same guest.
7. **Limits are hard-coded:** 1–12 guests appears in three places (`001_init.sql:24`, `actions.ts:34`, `ReserveDrawer.tsx:172`), and the 14-day window in another (`lib/booking.ts:19`).
8. **Errors come back as English strings** (`actions.ts:31-82`). They need to become error codes so the guest site can show them in every language.
9. **Server actions are public endpoints.** `fetchAvailability` is exported from a `'use server'` file, so anyone can call it with a direct POST (`node_modules/next/dist/docs/01-app/02-guides/data-security.md:281-291`). It only reads data. Every new admin action must re-check the user's session and role (`data-security.md:337-368`).

---

## 2. Target model

```
restaurants ─┬─< service_periods ─< service_slot_overrides     (weekly template)
             ├─< closures (also scoped to a destination or to all)  (date exceptions)
             ├─< notification_recipients (also by destination or all)
             └─< reservations ─┬─< reservation_events   (timeline / audit)
                               ├─< reservation_notes    (internal staff notes)
                               └─< email_outbox         (notifications, retried)
booking_settings (singleton defaults; restaurant columns override when not NULL)
email_templates (key × locale, editable, AI-translatable)
```

Design rules:
- **Reservations never reference a service period by foreign key.** Schedules change, and a booking keeps the `meal` and time it was made for. The admin warns when future bookings fall outside newly edited hours.
- **Meal keys stay `'Breakfast' | 'Lunch' | 'Dinner' | 'Drinks'`.** These match the existing `Meal` type and the Finder's "occasion" filter. Each label is translated through the i18n dictionary.
- **One definition of statuses that use up seats:** `status IN ('requested','confirmed','seated')`. The same list is used in partial indexes, availability and the capacity check.
- **"Today" in SQL is always `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`.** Never use `CURRENT_DATE`, which depends on the session's timezone.

---

## 3. DDL sketch: `db/migrations/003_reservations_v2.sql` (expand step)

`scripts/migrate.mjs:48-60` runs each file once, inside a single transaction. So there is no `CREATE INDEX CONCURRENTLY` (fine for a table this small), and the whole file rolls back if anything fails.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;          -- Neon supports pg_trgm 1.6

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION touch_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); NEW.version := OLD.version + 1; RETURN NEW; END $$;

-- ── 1. Booking rules: global defaults + per-restaurant overrides ──────────────
CREATE TABLE IF NOT EXISTS booking_settings (
  id                   boolean     PRIMARY KEY DEFAULT true CHECK (id),   -- singleton
  window_days          smallint    NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 180),
  lead_minutes         smallint    NOT NULL DEFAULT 30 CHECK (lead_minutes BETWEEN 0 AND 2880),
  same_day_cutoff      time,                         -- NULL = none; '17:00' = no same-day online after 5pm
  max_party            smallint    NOT NULL DEFAULT 12 CHECK (max_party BETWEEN 1 AND 50),
  auto_confirm         boolean     NOT NULL DEFAULT false,
  guest_ack_email      boolean     NOT NULL DEFAULT true,   -- "request received" mail
  pii_retention_months smallint    NOT NULL DEFAULT 24 CHECK (pii_retention_months BETWEEN 1 AND 120),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);
INSERT INTO booking_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE restaurants                             -- NULL = inherit booking_settings
  ADD COLUMN IF NOT EXISTS booking_enabled boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS window_days     smallint CHECK (window_days BETWEEN 1 AND 180),
  ADD COLUMN IF NOT EXISTS lead_minutes    smallint CHECK (lead_minutes BETWEEN 0 AND 2880),
  ADD COLUMN IF NOT EXISTS max_party       smallint CHECK (max_party BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS auto_confirm    boolean,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now();

-- ── 2. Weekly service template ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_periods (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurant_id     text     NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  meal              text     NOT NULL CHECK (meal IN ('Breakfast','Lunch','Dinner','Drinks')),
  weekdays          smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}'      -- ISO 1=Mon … 7=Sun
                    CHECK (cardinality(weekdays) BETWEEN 1 AND 7
                           AND weekdays <@ '{1,2,3,4,5,6,7}'::smallint[]),
  first_seating     time     NOT NULL,
  last_seating      time     NOT NULL,
  interval_min      smallint NOT NULL DEFAULT 30 CHECK (interval_min IN (15,20,30,45,60,90,120)),
  covers_per_slot   integer  NOT NULL CHECK (covers_per_slot >= 0),       -- per-slot cap
  covers_per_period integer  CHECK (covers_per_period >= 0),              -- optional kitchen cap per service
  valid_from        date,                                                 -- optional seasonal schedule
  valid_until       date,
  active            boolean  NOT NULL DEFAULT true,
  sort_order        integer  NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  CHECK (last_seating >= first_seating),            -- v1: no service crossing midnight
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS service_periods_restaurant_idx ON service_periods (restaurant_id) WHERE active;

CREATE TABLE IF NOT EXISTS service_slot_overrides (     -- e.g. 19:00 gets 30 covers, 21:00 gets 0 (hidden)
  period_id  bigint  NOT NULL REFERENCES service_periods (id) ON DELETE CASCADE,
  slot_time  time    NOT NULL,
  covers     integer NOT NULL CHECK (covers >= 0),
  PRIMARY KEY (period_id, slot_time)
);

-- Seed: reproduce today's behaviour exactly (global SLOTS × restaurants.meals × slot_capacity)
INSERT INTO service_periods (restaurant_id, meal, first_seating, last_seating, interval_min, covers_per_slot, sort_order)
SELECT r.id, s.meal, s.first_s, s.last_s, s.step, r.slot_capacity, s.ord
  FROM restaurants r
  CROSS JOIN LATERAL unnest(r.meals) AS rm(meal)
  JOIN (VALUES ('Breakfast', time '06:30', time '09:30', 30, 1),
               ('Lunch',     time '11:30', time '13:30', 30, 2),
               ('Dinner',    time '18:00', time '21:00', 30, 3),
               ('Drinks',    time '17:00', time '22:00', 60, 4)) AS s(meal, first_s, last_s, step, ord)
    ON s.meal = rm.meal
 WHERE NOT EXISTS (SELECT 1 FROM service_periods p WHERE p.restaurant_id = r.id);

-- ── 3. Closures / blackout dates ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS closures (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text   NOT NULL CHECK (scope IN ('all','destination','restaurant')),
  destination    text,                                         -- 'resort' | 'dining-house' | 'mm'
  restaurant_id  text   REFERENCES restaurants (id) ON DELETE CASCADE,
  starts_on      date   NOT NULL,
  ends_on        date   NOT NULL,
  meals          text[] CHECK (meals <@ ARRAY['Breakfast','Lunch','Dinner','Drinks']),  -- NULL = whole day
  kind           text   NOT NULL DEFAULT 'closed' CHECK (kind IN ('closed','private_event','reduced')),
  capacity_pct   smallint CHECK (capacity_pct BETWEEN 0 AND 100),     -- only for kind='reduced'
  public_reason  jsonb  NOT NULL DEFAULT '{}'::jsonb,               -- {"en":"Private event","vi":"…"}
  show_reason    boolean NOT NULL DEFAULT true,
  internal_note  text,                                            -- never sent to guests
  created_by     text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_by     text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK ((scope = 'restaurant')  = (restaurant_id IS NOT NULL)),
  CHECK ((scope = 'destination') = (destination  IS NOT NULL)),
  CHECK ((kind = 'reduced') = (capacity_pct IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS closures_window_idx ON closures (ends_on, starts_on);

-- ── 4. Reservations: widen + new columns ──────────────────────────────────────
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD  CONSTRAINT reservations_status_check
  CHECK (status IN ('requested','confirmed','seated','no_show','cancelled','declined'));
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_guests_check;
ALTER TABLE reservations ADD  CONSTRAINT reservations_guests_check CHECK (guests BETWEEN 1 AND 50);

ALTER TABLE reservations
  ALTER COLUMN reserved_at TYPE time USING reserved_at::time,   -- '19:00' casts cleanly; indexes rebuild
  ADD COLUMN IF NOT EXISTS meal          text,
  ADD COLUMN IF NOT EXISTS phone_e164    text,
  ADD COLUMN IF NOT EXISTS locale        text    NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS source        text    NOT NULL DEFAULT 'web'
        CHECK (source IN ('web','phone','walk_in','email','staff','legacy')),
  ADD COLUMN IF NOT EXISTS over_capacity boolean NOT NULL DEFAULT false,  -- staff override
  ADD COLUMN IF NOT EXISTS status_reason text,                            -- guest-facing decline/cancel reason
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS search_text   text    NOT NULL DEFAULT '',     -- fold(name)+digits+email+ref
  ADD COLUMN IF NOT EXISTS is_test       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS version       integer NOT NULL DEFAULT 1,      -- optimistic concurrency
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by    text;

-- Backfill (rough SQL VN normalisation; a one-off Node script re-runs libphonenumber + JS fold())
UPDATE reservations r SET
  phone_e164  = CASE WHEN p.d LIKE '84%' THEN '+' || p.d
                     WHEN p.d LIKE '0%'  THEN '+84' || substr(p.d, 2)
                     ELSE '+' || p.d END,
  meal        = COALESCE((SELECT sp.meal FROM service_periods sp
                           WHERE sp.restaurant_id = r.restaurant_id
                             AND r.reserved_at BETWEEN sp.first_seating AND sp.last_seating
                           ORDER BY sp.sort_order LIMIT 1), 'Dinner'),
  source      = 'legacy',
  search_text = lower(r.guest_name) || ' ' || p.d || ' ' || coalesce(lower(r.email), '') || ' ' || r.reference
FROM (SELECT id, regexp_replace(phone, '\D', '', 'g') AS d FROM reservations) p
WHERE p.id = r.id AND r.phone_e164 IS NULL;

ALTER TABLE reservations ALTER COLUMN phone_e164 SET NOT NULL, ALTER COLUMN meal SET NOT NULL;

-- Normalisation can merge two rows into one dedupe key: stop with a clear message instead of a bare 23505
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM (SELECT 1 FROM reservations WHERE status IN ('requested','confirmed')
     GROUP BY restaurant_id, reserved_on, reserved_at, phone_e164 HAVING count(*) > 1) x;
  IF n > 0 THEN RAISE EXCEPTION '% duplicate active bookings after phone normalisation', n; END IF;
END $$;

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS reservations_dedupe_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_dedupe_v2_idx
  ON reservations (restaurant_id, reserved_on, reserved_at, phone_e164)
  WHERE status IN ('requested','confirmed');
DROP INDEX IF EXISTS reservations_slot_idx;
CREATE INDEX IF NOT EXISTS reservations_load_idx                 -- availability + capacity check
  ON reservations (restaurant_id, reserved_on, meal, reserved_at) INCLUDE (guests)
  WHERE status IN ('requested','confirmed','seated');
CREATE INDEX IF NOT EXISTS reservations_inbox_idx                -- list by status, newest first (keyset)
  ON reservations (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_pending_idx              -- "Needs action", soonest sitting first
  ON reservations (reserved_on, reserved_at) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS reservations_day_idx                  -- day sheet across restaurants
  ON reservations (reserved_on, restaurant_id, reserved_at);
CREATE INDEX IF NOT EXISTS reservations_phone_idx ON reservations (phone_e164);
CREATE INDEX IF NOT EXISTS reservations_search_trgm_idx ON reservations USING gin (search_text gin_trgm_ops);
-- reference lookup: the existing UNIQUE constraint reservations_reference_key already indexes it.

DROP TRIGGER IF EXISTS reservations_touch ON reservations;
CREATE TRIGGER reservations_touch BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION touch_reservation();

-- ── 6. Timeline / audit + internal notes ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reservation_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_kind     text NOT NULL CHECK (actor_kind IN ('guest','staff','system')),
  actor_id       text,            -- auth user id, deliberately no FK (survives user deletion)
  actor_label    text,            -- snapshot, e.g. 'Lan · editor'
  type           text NOT NULL CHECK (type IN ('created','status_changed','edited','note_added',
                                               'email_queued','email_sent','email_failed')),
  from_status    text,
  to_status      text,
  changes        jsonb,           -- {"guests":[2,4],"reserved_at":["19:00","19:30"]}
  reason         text
);
CREATE INDEX IF NOT EXISTS reservation_events_res_idx ON reservation_events (reservation_id, at);

CREATE TABLE IF NOT EXISTS reservation_notes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reservation_id bigint NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  author_id      text NOT NULL,
  author_label   text NOT NULL,
  body           text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservation_notes_res_idx ON reservation_notes (reservation_id, created_at);

INSERT INTO reservation_events (reservation_id, at, actor_kind, type, to_status)
SELECT id, created_at, 'guest', 'created', status FROM reservations r
 WHERE NOT EXISTS (SELECT 1 FROM reservation_events e WHERE e.reservation_id = r.id);

-- ── 7. Notifications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_recipients (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope         text NOT NULL CHECK (scope IN ('all','destination','restaurant')),
  destination   text,
  restaurant_id text REFERENCES restaurants (id) ON DELETE CASCADE,
  email         text NOT NULL CHECK (email ~ '^\S+@\S+\.\S+$'),
  events        text[] NOT NULL DEFAULT '{reservation.created}',
  locale        text NOT NULL DEFAULT 'vi',          -- staff mail language
  active        boolean NOT NULL DEFAULT true,
  updated_by    text, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'restaurant')  = (restaurant_id IS NOT NULL)),
  CHECK ((scope = 'destination') = (destination  IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_uq   -- works on any PG version (no NULLS NOT DISTINCT)
  ON notification_recipients (scope, coalesce(destination,''), coalesce(restaurant_id,''), lower(email));

CREATE TABLE IF NOT EXISTS email_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  env             text NOT NULL,                    -- VERCEL_ENV at enqueue; drainer only sends its own env
  event           text NOT NULL,                    -- reservation.created | .ack | .confirmed | .cancelled | .declined | .updated
  audience        text NOT NULL CHECK (audience IN ('staff','guest')),
  reservation_id  bigint REFERENCES reservations (id) ON DELETE CASCADE,
  to_email        text NOT NULL,
  locale          text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,             -- also sent as Resend Idempotency-Key (≤256 chars)
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed','skipped')),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  provider_id     text,                             -- Resend email id
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_due_idx ON email_outbox (next_attempt_at)
  WHERE status IN ('pending','sending','failed');

CREATE TABLE IF NOT EXISTS email_templates (       -- guest-visible copy → CMS-editable, AI-translatable
  key        text NOT NULL,                        -- guest.ack | guest.confirmed | guest.cancelled | guest.declined | staff.new
  locale     text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,                        -- markdown + {{guest_name}} {{restaurant}} {{date}} {{time}} {{guests}} {{reference}} {{reason}}
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),  -- AI output lands as draft
  updated_by text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, locale)
);
```

To match the CMS's i18n storage, `closures.public_reason` and `email_templates` should follow whatever pattern the i18n/CMS research chooses (jsonb keyed by locale, or a shared translations table). I sketched jsonb.

**Later contract migration (`004_…`):** drop `restaurants.slot_capacity`, drop the global `SLOTS`, and derive `meals` with `ARRAY(SELECT DISTINCT meal FROM service_periods WHERE restaurant_id = r.id AND active)` or drop it. Do this only after the code has stopped reading those columns.

---

## 4. Availability and capacity

**How one (restaurant, date) is resolved.** Write this as a pure function shared by the API, the server action and the admin:
1. Reject the date unless `booking_enabled` is on and the date falls in `[venueToday, venueToday + window_days − 1]`.
2. Find the periods whose `weekdays` contain `isoWeekday(date)` and that are active and inside `valid_from`/`valid_until`. If any dated period exists for a meal, it replaces the undated one for that meal on that date.
3. Apply closures where `starts_on <= date <= ends_on` and the scope matches (`all`, the restaurant's destination, or the restaurant):
   - `meals IS NULL` closes the whole day.
   - Otherwise only those services are removed.
   - `reduced` scales each slot's capacity by `capacity_pct`.
4. Build the slots as `first_seating … last_seating` in steps of `interval_min`. Each slot's capacity is its override if one exists, otherwise `covers_per_slot`. Drop any slot with capacity 0.
5. A slot is bookable when all of these hold:
   - `minutesUntil(date, time) >= lead_minutes`
   - same-day bookings are allowed (`same_day_cutoff`)
   - `slot_booked + party <= slot_cap`
   - if `covers_per_period` is set, `period_booked + party <= covers_per_period`
   - `party <= max_party`

**The insert transaction** (it replaces the `FOR UPDATE` on the restaurant row, which serialises every date and blocks CMS edits to that row):
```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('res:' || $1 || ':' || $2, 0));  -- per restaurant+date
SELECT COALESCE(SUM(guests) FILTER (WHERE reserved_at = $3), 0)::int AS slot_covers,
       COALESCE(SUM(guests), 0)::int                               AS period_covers
  FROM reservations
 WHERE restaurant_id = $1 AND reserved_on = $2::date AND meal = $4
   AND status IN ('requested','confirmed','seated');
-- re-resolve the day plan (periods/closures) inside the tx, compare, then:
INSERT INTO reservations (...) RETURNING id;
INSERT INTO reservation_events (... 'created' ...);
INSERT INTO email_outbox (...);          -- staff recipients + guest ack, same commit
COMMIT;
```
- **Advisory lock:** I expect `pg_advisory_xact_lock` to work through Neon's pooled (PgBouncer transaction-mode) URL because the lock only lasts for the transaction; session-level advisory locks would not. I have not tested this.
- **Telling 23505 errors apart:** use `err.constraint`.
  - `reservations_reference_key` means a reference collision: generate a new reference and retry, up to 3 times.
  - `reservations_dedupe_v2_idx` means a genuine duplicate booking.
- **Staff bookings** (phone or walk-in) may set `over_capacity = true` with a reason. The override is logged as an event.

**Guest API** (replaces `?day=`; keep `cache-control: no-store`):
- `GET /api/availability?restaurant=taya-house&from=2026-10-01&to=2026-10-14` returns `{ today, nowMinutes, maxParty, days:[{date, state:'open'|'closed'|'full'|'outside', reason?}] }`. The day strip and dropdown use it to grey out closed days. It needs one `GROUP BY reserved_on, meal, reserved_at` query on `reservations_load_idx`.
- `GET /api/availability?restaurant=…&date=2026-10-02&guests=2` returns `{ date, state, reason?, periods:[{meal, slots:[{time, left, bookable}]}] }`.

**Showing closures to guests (recommended).** Show a short public reason, translated and optional, e.g. "Closed for a private event". Give the day chip the existing `data-taken` look plus a label. For a single-service closure, keep the meal heading and show "Not available on this date — {reason}". Never expose `internal_note`. When there is no reason, show the generic "Closed".

---

## 5. Status lifecycle

| From → To | Who | Guest email | Notes |
|---|---|---|---|
| (new) → requested | guest / staff | `guest.ack` (if email and setting on) | → `confirmed` directly when `auto_confirm` |
| requested → confirmed | Editor/Admin | `guest.confirmed` | sets `confirmed_at` |
| requested → declined | Editor/Admin | `guest.declined` (with `status_reason`) | "could not accommodate" is a different message from a cancellation |
| requested/confirmed → cancelled | Editor/Admin (or the guest later) | `guest.cancelled` when "Notify guest" is ticked (default on) | sets `cancelled_at`; reason required |
| confirmed → seated ("Arrived") | Editor/Admin | none | only from 60 minutes before the sitting; enables a no-show rate |
| confirmed → no_show | Editor/Admin | none | only after the sitting time + 15 minutes |
| no_show → seated / seated → confirmed | Editor/Admin | none | correction, same service day only |
| cancelled/declined → requested/confirmed | Admin | `guest.confirmed` if confirmed | "Reinstate": capacity re-checked under the advisory lock |

- **Transitions live in one TypeScript map, enforced by the data layer.** Each one runs `UPDATE reservations SET status=$to,… WHERE id=$1 AND version=$2 AND status = ANY($allowedFrom) RETURNING *`. In the same transaction it inserts a `reservation_events` row (`from_status`, `to_status`, actor, reason) and the outbox rows. If 0 rows come back, show "Changed by {actor_label} at {time}, reload" (optimistic concurrency).
- **Seats held** = `requested`, `confirmed` and `seated`.
- **Two kinds of note:**
  - Guest's request: the existing `note`. It is shown to staff and appears in the staff email.
  - Staff notes: `reservation_notes`. They are append-only and never appear in guest emails or responses.
- **Global audit log.** For the CMS-wide "who changed what", create a view that unions `reservation_events` into the global audit log rather than writing every action twice.

## 6. Reference format

```ts
// server-only module (node:crypto must not be bundled into lib/booking.ts, which the client imports)
import { randomInt } from 'node:crypto';
const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';            // Crockford base32: no I, L, O, U
export const newReference = () => 'FC-' + Array.from({ length: 8 }, () => A[randomInt(32)]).join('');
export function normaliseReference(input: string): string | null {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^FC/, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (/^\d{5}$/.test(s)) return `FC-${s}`;                       // legacy FC-12345 rows stay valid
  if (/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return `FC-${s}`;
  return null;
}
```
- **Collision odds:** 32⁸ = 1,099,511,627,776 values. Even with 1 million rows, a new booking has about a 1-in-a-million chance (9×10⁻⁷) of colliding, and the retry loop handles that case.
- **Readability:** it is readable over the phone because there are no confusable characters, and lookup accepts lowercase, a missing dash, O/0 and I/L/1.
- **Not guessable:** references are random, not sequential, so they don't reveal booking volume.

## 7. Timezone fix (client and server)

```ts
// lib/venue-time.ts — isomorphic, no dependencies (Vietnam is UTC+7 with no DST)
export const VENUE_TZ = 'Asia/Ho_Chi_Minh';
export type IsoDate = string;                                   // 'YYYY-MM-DD'
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: VENUE_TZ, year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });   // h23 avoids a "24:xx" hour
export function venueNow(now = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}
export const addDays = (d: IsoDate, n: number) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
};
export const isValidIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
export const isoWeekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay() || 7;   // 1=Mon..7=Sun
export function minutesUntil(d: IsoDate, hhmm: string, now = new Date()) {
  const v = venueNow(now);
  const dayDiff = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${v.date}T00:00:00Z`)) / 86_400_000;
  return dayDiff * 1440 + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) - v.minutes;
}
export const formatDay = (d: IsoDate, locale: string) =>           // replaces WD/MO arrays + fmtDay
  new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${d}T00:00:00Z`));
```
- **Locale formatting checked in Node 22:** `en` "Fri, Oct 2", `vi` "Th 6, 2 thg 10", `ko` "10월 2일 (금)", `zh-CN` "10月2日周五". This also covers the multi-language requirement.
- **Wire format:** `Booking.day: number` becomes `date: IsoDate`. `submitReservation({ restaurant, date, time, guests, name, phone, email, note, locale })`.
- **The server is the authority on "now".** It validates the ISO date (`isValidIsoDate`), the window and the lead time against its own clock in Vietnam time. It never maps an offset.
- **The client takes "today" from the server.** It reads `today` and the first bookable date from `/api/availability` (the `days` response). This removes `SiteProvider.tsx:150`'s `>= 21` heuristic and the device-timezone dependence. SSR renders a placeholder, which fixes the ISR/hydration problem.
- **SQL:** `(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` wherever SQL needs "today" (for example the admin "Today" tab or the anonymisation job).
- **Don't add a generated `starts_at` column.** I could not confirm that `timestamp AT TIME ZONE text` counts as immutable, which a generated column requires. Compute it in the app or the query instead.

## 8. Notifications

| Event | Trigger | Recipients | Locale | Template |
|---|---|---|---|---|
| `reservation.created` | web submit, or a staff booking with "notify team" ticked | staff recipients: union of the restaurant, its destination and `all` scopes, deduplicated | recipient's `locale` (staff, likely VI) | `staff.new` (summary + deep link `/admin/reservations/{id}`) |
| `reservation.ack` | web submit, guest gave an email, `guest_ack_email` on | guest | `reservations.locale` | `guest.ack` |
| `reservation.confirmed` | → confirmed (or auto-confirm) | guest | guest locale | `guest.confirmed` |
| `reservation.cancelled` / `.declined` | staff transition with "notify guest" | guest | guest locale | `guest.cancelled` / `guest.declined` (+ `status_reason`) |
| `reservation.updated` (optional) | date, time or party changed on a confirmed booking | guest | guest locale | `guest.updated` |

Email is optional on the form (phone is required), so guests without one are confirmed by phone.

**Where to hook it so a failed email never fails the booking.** Use a transactional outbox plus `after()`:
1. Insert the `email_outbox` rows **inside the same transaction** as the reservation insert or status change. A rolled-back booking therefore never emails, and a committed booking never loses its email.
2. After COMMIT, call `after(() => drainOutbox({ ids }).catch(log))` from `next/server` inside the Server Action.
   - `after` runs once the response has finished, so the guest's response time does not wait on email.
   - Server Functions are a supported caller (`after.md:6-8`, `64-66`).
   - On Vercel it uses `waitUntil` (`after.md:250`), and it can run only as long as the route's `maxDuration` (`after.md:48-50`).
   - It also runs when the response fails (`after.md:54`), so only schedule it once the commit has succeeded.
   - A throw inside `after` never reaches the guest, so failures must be recorded in the outbox row.
3. **The drainer:**
   - Claim due rows with `UPDATE … SET status='sending', locked_until=now()+'2 min', attempts=attempts+1 WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT 10) RETURNING *`.
   - Before sending, re-read the reservation. If the event no longer matches its status (for example it was confirmed and then cancelled before the email went out), mark the row `skipped`.
   - Render the template in the row's locale, falling back to the default locale when that translation isn't `published`.
   - Send with `resend.emails.send(payload, { idempotencyKey })`, using a key such as `res:{id}:{event}:v{version}:{audience}`.
   - Mark `sent` (with the provider id) or `failed`, with backoff of 1m, 5m, 15m, 1h, 6h, 24h and at most 6 attempts.
   - Log each result as an `email_sent` or `email_failed` reservation event.
4. **Retries:**
   - A cron route (`/api/cron/outbox`, protected by `CRON_SECRET`) handles them. Vercel cron runs **only on production deployments**. On **Hobby it runs at most once a day** (±59 min), so frequent retries need Pro (`*/5 * * * *`).
   - On any plan, also drain opportunistically: every new booking and every admin action calls `after(() => drainDue({ limit: 10 }))`.
   - The admin email log has a "Retry now" button.
5. **Environment gate (essential while the database is shared):**
   - Set `EMAIL_DELIVERY=live` in Production only. Use `log` or a redirect to `EMAIL_REDIRECT_TO` in development and preview.
   - The drainer only sends rows whose `env` matches `VERCEL_ENV`.
   - Without this, rows queued from a dev machine would be sent by the production cron to real staff and guests.

**Provider:** Resend (Vercel Marketplace `resend/resend-email`), SDK `resend@6.31.0`. Facts that shape the design:
- The `Idempotency-Key` lasts **24 hours** and can be up to 256 characters. The same payload returns the original email; a different payload returns a 409.
- The default rate limit is **10 requests per second per team**, with a 429 and `retry-after` on overflow.
- The free plan's daily quota resets at **00:00 UTC**, which is 07:00 in Vietnam.

Env vars: `RESEND_API_KEY`, `EMAIL_FROM` (needs a verified sending domain, i.e. a DNS change), `EMAIL_DELIVERY`, `EMAIL_REDIRECT_TO`, `CRON_SECRET`.

**Vertex AI tie-in (from the user's request).** Closure `public_reason` and `email_templates` are translatable guest-facing text. They use the same Vertex auto-translate flow as the rest of the CMS: the glossary protects "Tàya House" and "Phố Cuốn", output saves as `draft`, and an editor publishes it. **Never send guest personal data to Vertex.** Translate templates with their placeholders; do not translate individual reservations. Any "translate this guest note for staff" button should be off by default and behind an explicit per-feature switch.

## 9. Migration path (no rows lost)

0. **Read-only pre-flight on the target branch.**
   - Run `SELECT version();` to check the Postgres major version. I used no PG15+ syntax on purpose.
   - Run `SELECT count(*), min(created_at), max(created_at) FROM reservations;`.
   - Run the duplicate-after-normalisation query from the `DO` block.
1. **Snapshot.** Create a Neon branch, e.g. `backup/pre-003`, from the default branch before applying anything.
2. **Rehearse.** Run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` pointing at a **child branch**. Run the app against it, including the one-off Node backfill that recomputes `phone_e164` with `libphonenumber-js` (default country VN) and `search_text` with the existing `fold()`.
3. **Apply 003 to the default branch.**
   - 003 only adds columns, tables and indexes. It keeps every row and every existing column apart from converting `reserved_at` from text to time.
   - Existing rows get `source='legacy'`, a `created` event, an inferred `meal` and the normalised phone.
   - Legacy `FC-12345` references stay valid.
4. **Ship the code switch in the same release.** Nothing has been deployed yet, so no backward-compatible double-reading is needed.
   - Code that must change: `lib/booking.ts` (date logic), `app/actions.ts`, `db/queries.ts`, `/api/availability`, `SiteProvider`, `BookingBar` and `ReserveDrawer` (ISO dates, server-provided slots).
   - The `node-postgres` client returns `time` values as `'19:00:00'`. Use `to_char(reserved_at,'HH24:MI')` in SELECTs, or trim in the data layer.
5. **Separate the environments before launch.** Today one Neon branch serves dev, preview and production, so:
   - Point local `.env.local` at a Neon `dev` branch.
   - Enable "create a branch for each preview deployment" in the Neon–Vercel integration.
   - Keep the default branch for Production only.
   - Decide what happens to the pre-launch rows, which are all test bookings because the site has never been deployed: flag them `is_test=true` (hidden from the inbox, not counted toward capacity) or export and purge them.
   - Until this is done, test bookings take real seats and outbox rows can leak across environments.
6. **Contract (004).** After the new code is live, drop `restaurants.slot_capacity`, the old `SLOTS` and `DAY_COUNT`, and derive or drop `restaurants.meals`. Then refresh the restaurant list cached by the layout (`revalidateTag`, `updateTag` or `revalidatePath`; `server-actions.md:145-150`) whenever hours change.

## 10. Admin screens and actions

Every action is a Server Action in a `server-only` data-access layer that re-checks the session and role itself (`data-security.md:337-368, 399`).

| Screen | Route (suggested) | Role | Main actions |
|---|---|---|---|
| Reservations inbox | `/admin/reservations` | Editor, Admin | Tabs: **Needs action** (requested, soonest sitting first), **Today**, **Upcoming**, **All**. Filters: restaurant, destination, status, date range, source, show test. One search box for reference, phone, name or email. Keyset pagination. Auto-refresh every 30–60 s plus a pending-count badge. Row quick actions: Confirm, Decline, Call (`tel:`) |
| Reservation detail | `/admin/reservations/[id]` | Editor, Admin | Buttons for each allowed transition (Confirm, Decline with reason, Cancel with reason and "notify guest", Arrived, No-show, Reinstate for Admin only). Edit date, time, party or restaurant (re-checks capacity; override with reason). Add a staff note. Timeline (events). Email log with Resend. Copy reference |
| New booking (phone / walk-in) | `/admin/reservations/new` | Editor, Admin | Same validation as the web form. `source` is phone or walk_in. Optional capacity override with reason. Optional confirmation email |
| Day sheet | `/admin/reservations/day?date=&restaurant=` | Editor, Admin | Grouped by service and slot: covers booked against capacity, guest notes, staff notes. Print stylesheet for the host stand |
| Availability calendar | `/admin/reservations/calendar` | Editor, Admin | Month view per restaurant: load %, closures, pending count. Click through to the day sheet |
| Hours and capacity | `/admin/restaurants/[id]/booking` | Editor, Admin | Online booking on/off. Service periods (meal, weekday chips, first and last seating, interval, covers per slot, optional cap per service, optional season). Preview of generated slot chips. Per-slot overrides. Window, lead-time and max-party overrides. Warns: "N future bookings fall outside the new hours" |
| Closures | `/admin/reservations/closures` | Editor, Admin | Create, edit, delete. Scope (all, destination or restaurants), date range, whole day or specific services, kind (closed, private event, reduced %), public reason with AI translate and show/hide, internal note. **Conflict panel:** lists existing bookings in range and offers a bulk "Cancel & notify" (never cancels automatically) |
| Booking settings | `/admin/settings/booking` | Admin | Default window, lead time, same-day cutoff, max party, large-party message, auto-confirm, guest acknowledgement email, personal-data retention period |
| Notifications | `/admin/settings/notifications` | Admin | Recipients per scope and event (add, edit, delete, activate). Sender display name. Delivery mode shown read-only (from env). "Send test email" |
| Email templates | `/admin/content/emails` | Editor, Admin | Per template key and locale: subject and body with placeholder chips, preview with sample data, Vertex "translate from EN" (saves as draft), publish |
| Email log / outbox | `/admin/reservations/emails` | Admin (Editors see it per reservation) | Failed and pending list, error text, retry, mark skipped |
| Export (optional) | `/admin/reservations/export` | Admin | CSV for a date range. Logged in the audit log because it contains personal data |
| Data hygiene | under Settings | Admin | Purge test bookings. Run or schedule anonymisation of bookings older than the retention period |

Server actions:
- **Reservations:** `listReservations`, `getReservation`, `confirmReservation`, `declineReservation`, `cancelReservation`, `markArrived`, `markNoShow`, `reinstateReservation`, `updateReservation`, `createStaffReservation`, `addStaffNote`, `resendEmail`.
- **Hours and closures:** `upsertServicePeriod`, `deleteServicePeriod`, `setSlotOverride`, `createClosure`, `updateClosure`, `deleteClosure`, `previewClosureConflicts`.
- **Settings and notifications:** `updateBookingSettings`, `updateRestaurantBookingRules`, `upsertRecipient`, `deleteRecipient`, `sendTestEmail`, `upsertEmailTemplate`, `translateEmailTemplate` (Vertex), `publishEmailTemplate`.
- **Data hygiene:** `exportReservationsCsv`, `purgeTestReservations`.

## 11. Guest-site changes this implies

- **`lib/booking.ts`:** drop `days()`, `isPast()`, `DAY_COUNT` and the `SLOTS` dependency. Keep `validate`/`fold`. The day plan now comes from the server.
- **`app/actions.ts`:** ISO `date`, a `locale` input, and error **codes** (`full`, `closed`, `past`, `outside_window`, `duplicate`, `invalid_phone`, `party_too_large`) that the client maps to translated CMS strings. Then `after()` drains the outbox.
- **`SiteProvider`, `ReserveDrawer`, `BookingBar`:** the date is a string and starts empty until the server says what today is. The day strip shows closed days with reasons. Slot groups come from the API. The guest stepper's maximum is `maxParty`, plus a "call us for larger groups" line from the CMS.
- **Abuse.** Guest requests hold capacity while they wait for staff, so a bot could fill a restaurant. Mitigations:
  - At most N active requests per phone per day.
  - A honeypot field.
  - Vercel BotID (`botid@1.5.11` on npm) or a Firewall rate limit on the booking POST.


## Recommendation
Replace the global SLOTS and the single slot_capacity with per-restaurant service periods, set by weekday. Each period has a per-slot covers figure, an optional cap for the whole service, and optional per-slot overrides. Add a closures table (scoped to a restaurant, a destination or everything; whole day or specific services) with an optional translated public reason, plus global booking rules (window, lead time, same-day cutoff, max party, auto-confirm) that each restaurant can override.

Widen the status lifecycle to requested → confirmed / declined / cancelled, and confirmed → seated (shown as 'Arrived') / no_show, with an admin-only reinstate. Enforce transitions in one data-layer map with optimistic concurrency (a version column). Record every change in reservation_events and keep staff notes in a separate reservation_notes table.

Fix the timezone bugs together:
- Move to an isomorphic lib/venue-time.ts built on Intl with Asia/Ho_Chi_Minh.
- The client sends ISO dates; the server validates them against its own clock in Vietnam time.
- The client gets 'today' from /api/availability instead of the device clock.

Replace references with FC- plus 8 Crockford base32 characters from node:crypto, retrying on collisions of the reference constraint, and store a normalised E.164 phone (libphonenumber-js) for dedupe and lookup.

For notifications:
- Use a transactional email_outbox written in the same transaction as the booking or status change.
- Drain it with after() from next/server after commit, and send through Resend with idempotency keys.
- Retry via the cron route plus opportunistic drains; the cron can only run daily on Hobby, so frequent retries need Pro.
- Gate sending by environment, because dev, preview and production currently share one database.

Ship this as an expand-only migration (003) after taking a Neon branch snapshot and rehearsing on a child branch. Split the environments onto separate Neon branches before launch, and drop slot_capacity and SLOTS in a later contract migration (004).

## Risks
- Dev, preview and production share one Neon branch today. Without environment separation or the outbox env gate, test bookings take real seats and queued emails from development could be sent to real staff and guests by the production cron.
- On the Vercel Hobby plan, cron can only run daily, so failed emails would wait up to a day unless the opportunistic drains (on each booking and each admin action) run or the team moves to Pro.
- Converting reserved_at from text to time changes what node-postgres returns ('19:00:00'). Every query and comparison against 'HH:MM' must use to_char or trim, or slot matching breaks.
- Normalising phones could merge two existing active rows into one dedupe key. The migration aborts with a clear message, but someone must resolve those rows manually.
- Guest requests hold capacity while staff review them, so spam or bot bookings can block a restaurant. Per-phone limits, a honeypot and BotID or a Firewall rate limit are needed before launch.
- Making the booking window much longer than 14 days won't fit the existing day-strip and dropdown design without a new date-picker pattern, which pushes against the 'within the existing design' rule.
- The advisory-lock concurrency approach relies on transaction-scoped locks working through Neon's pooled PgBouncer URL. I believe this holds but have not tested it on this project.
- Personal data such as names, phones, emails and special requests now flows into emails, exports and the admin. Vietnam's Law 91/2025/QH15 (effective 2026-01-01) requires a retention and anonymisation policy and care with exports. Guest personal data must never be sent to Vertex AI.
- Emails require a verified sending domain in Resend (a DNS change on a Furama-controlled domain). This is outside the code and could delay launch.
- Editing service periods or closures after bookings exist can leave bookings outside the new hours. The admin must warn and list them; nothing should be cancelled automatically.

## Open questions
- Which Vercel plan will production run on, Hobby or Pro? This decides whether failed emails can be retried every few minutes or only once a day.
- Should any restaurants confirm bookings automatically (e.g. Café Indochine breakfast, Yum Food Village), or should every booking stay 'requested' until staff confirm by phone or email?
- Should closures show the reason to guests by default (e.g. 'Closed for a private event'), or just show 'Closed'?
- Will staff mark guests as 'Arrived' and 'No-show' in the admin during service? If not, we can drop the seated state and keep only no_show.
- What booking window (still 14 days, or 30 to 60) and maximum party size should each restaurant have, and what should guests see for larger groups (a phone number, or an enquiry form)?
- The existing reservation rows are all pre-launch test bookings. Should they be deleted, or kept and flagged as tests?
- Who receives new-booking emails for each restaurant and destination, and in which language (Vietnamese for the local team)? Which sending domain and address can be verified in Resend (DNS access)?
- Should Editors be limited to particular restaurants or destinations, or can every Editor see all reservations?
- How long should guest personal data (name, phone, email, notes) be kept before it is anonymised under Vietnam's data protection law?
- Do you want a self-service 'manage or cancel my booking' link in guest emails, or SMS/Zalo notifications? Both are outside the current requirements.

## Key facts
- [verified] Bookings made between 00:00 and 06:59 Vietnam time (Asia/Ho_Chi_Minh, UTC+7) are stored one day early on a UTC server. With TZ=UTC at 2026-10-01T18:00Z (01:00 on 2 Oct in Vietnam), days()[0] is 2026-10-01, so 'Today 19:00' is saved as 1 Oct. (lib/booking.ts:22-30, app/actions.ts:62; reproduced with a scratch script under TZ=UTC vs TZ=Asia/Ho_Chi_Minh)
- [verified] The server's cutoff check runs 7 hours behind on UTC. At 19:00 Vietnam time, isPast(0,'13:00') and isPast(0,'18:00') return false, so the server would accept slots that have already started. (lib/booking.ts:56-58; reproduced under TZ=UTC)
- [verified] TZ is a reserved environment variable on Vercel and cannot be set for Functions, so server code must convert to Vietnam time explicitly. (https://vercel.com/docs/environment-variables/reserved-environment-variables)
- [verified] References use FC- plus 5 random digits (90,000 values), so there is a 50% chance of at least one collision after 354 bookings. Every 23505 error is reported as 'duplicate', so a collision loses the guest's booking with a misleading message. (lib/booking.ts:142, db/queries.ts:132-135, 001_init.sql:20; birthday computation in Node)
- [verified] The dedupe unique index uses the raw phone text, so '0905 000 000' and '+84905000000' are not treated as the same guest. (db/migrations/001_init.sql:40-42)
- [verified] The root layout is ISR (revalidate = 3600), and BookingBar (rendered in Chrome) calls days() during SSR, so the 'Today' label is cached in UTC. (app/layout.tsx:36, components/site/Chrome.tsx:39, components/booking/BookingBar.tsx:15)
- [verified] after() from next/server works in Server Functions and Route Handlers. It runs after the response finishes, also when the response failed, is limited by the route's maxDuration, and uses waitUntil on Vercel. (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md:6-8,48-54,64-66,250 (Next 16.3.7))
- [verified] Every Server Action can be reached by a direct POST and must re-check authentication and authorization itself. (node_modules/next/dist/docs/01-app/02-guides/data-security.md:281-291,337-368)
- [verified] scripts/migrate.mjs applies each .sql file once, inside one transaction, so CREATE INDEX CONCURRENTLY is not possible and a failing migration rolls back fully. (scripts/migrate.mjs:38-60)
- [verified] Resend: the Idempotency-Key lasts 24 hours (max 256 characters). The default rate limit is 10 requests per second per team. The free plan's daily quota resets at 00:00 UTC. The current SDK is resend@6.31.0. (https://resend.com/docs/dashboard/emails/idempotency-keys ; https://resend.com/docs/api-reference/rate-limit ; npm view resend (modified 2026-09-30))
- [verified] Vercel cron jobs run only on production deployments. On Hobby they are limited to once a day with ±59 min precision. (https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [likely] Neon supports pg_trgm (1.6) and btree_gist, and its Vercel integration can create a database branch for each preview deployment. (https://neon.com/docs/extensions/pg-extensions ; https://neon.com/docs/guides/vercel-native-integration-previews)
- [verified] Node 22's Intl formats ISO dates correctly in vi, ko and zh-CN when using timeZone 'UTC'. The project's local Node is v22.22.0, and Temporal is not available there. (local node -e test)
- [likely] Vietnam's Personal Data Protection Law 91/2025/QH15 took effect on 1 Jan 2026, with Decree 356/2025/ND-CP, so reservation personal data needs a retention and anonymisation policy. (https://luatvietnam.vn/legal-updates/the-latest-law-on-personal-data-protection-and-the-guiding-documents-892-106778-article.html ; https://tilleke.com/insights/vietnams-new-personal-data-protection-law-a-closer-look)
- [verified] libphonenumber-js@1.13.14 and botid@1.5.11 are the current npm versions. zod sits in node_modules only as an indirect dependency, not a direct one. (npm view; package.json)
- [unverified] Whether `timestamp AT TIME ZONE text` counts as immutable (needed for a generated starts_at column) could not be confirmed, so the design avoids generated timezone columns. (postgres pg_proc.dat fetch was truncated)