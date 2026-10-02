# Phase 4 spike: booking engine, verified end to end

> Spike report, key `booking-engine` (clone `p4-engine`). Topic: the booking data model (migration 006), the resolveDay engine, availability API v2, a transactional submitReservation v2 with an advisory lock, how cache and `updateTag` behave, and `booking_enabled` in the guest catalogue.
> Where this report and `00-plan-outline.md` disagree, the outline wins (see its §0).

The whole spike is in the APFS clone `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-engine`. A byte-exact patch against HEAD 3c04ace (44 files, +2798/−504) is at `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4-engine.patch`. Files used only to measure the rejected `'use cache'` option are in `/private/tmp/claude-501/-Users-bcmac-Desktop-projects-Outside-Projects-furama-cuisine/e860bf94-efdc-4015-b5d3-085d89bca850/scratchpad/p4engine-spike-only/`. The original repo was not touched (`git status` is clean at 3c04ace). Neon was never contacted. All `*p4engine*_test` databases have been dropped and no server is still listening.

## 0. Results (all run locally on Postgres 18.3 with Node 22.22.0)

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | exit 0, 20 warnings (same baseline) |
| `TEST_DB_TAG=p4engine TEST_DATABASE_URL=…/furama_cuisine_p4engine_test npm test` | **46 files, 448 tests passed** (phase-3 baseline was 41 files, 375 tests; I deleted 2 files and added 7) |
| resolveDay unit tests | 28 passed. Six boundary mutations were each caught: lead `<=`→`<` (5 failures), cutoff `>=`→`>` (1), window `>=`→`>` (3), capacity `>`→`>=` (1), closure end inclusive (7), destination scope (1) |
| seed equivalence (`booking-seed.test.ts`) | 4 passed, more than 5000 slot verdicts compared. Mutating the migration seed was caught: Dinner last seating 20:30 (2 failures), covers +1 (2), Lunch sort order (1). Note: mutating the DB alone is wiped by `test/global-setup.ts`, which resets the DB on every run |
| `migration-006.test.ts` | 17 passed |
| `submit-reservation.test.ts` | 14 passed in each of 5 runs. **With the advisory lock removed, 2 tests fail in every run**: the 12-way race books 6–7 parties instead of 3, and the deterministic lock-holder test fails |
| `availability.test.ts` v2 | 18 passed |
| `npm run build` + `node scripts/check-prerender.mjs` | both pass. `/admin/restaurants/[id]/booking` has no static shell |
| `e2e/booking-rules.spec.ts` (next start :3220) | 3 passed. **Negative control:** without `updateTag('restaurants')`, test 3 fails because `/en` still carries `taya-house=true` |
| full E2E on the deliverable | 61 passed, **12 failed, all guest UI**. The cause is proven: the phase-1 `SiteProvider` reads `data.booked['11:30']` from the v2 response and throws `TypeError: Cannot read properties of undefined (reading '11:30')`. With temporary v1 compat fields (`booked`, `capacity`), 74 passed and 1 failed, the known page-scope flake (#15), which passed 21/21 with `--repeat-each=3` |
| `lock_timeout` on an advisory lock | verified: `SET LOCAL lock_timeout='1s'` aborts the waiter with `canceling statement due to lock timeout` (55P03) after 1.19 s |

## 1. Decisions the spike settles

1. **Booking rules are read live and never cached, for both the API and the action.** Each needs one round trip for the rules (a `json_agg` query) and one for the covers.
   - Measured under `next start`, a `'use cache'` + `cacheTag('booking-rules:<id>')` reader behaves as documented in one process:
     - the second request is a hit (same `loadedAt`);
     - after a direct DB write it still returns the old rules (covers 16, while the live API showed 99);
     - after the Server Action's `updateTag` it is fresh (new `loadedAt`, lastSeating 22:00).
   - It is rejected anyway, for three reasons:
     - On serverless, entries "typically don't persist across requests" (`node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-cache.md:247-252`).
     - "revalidation events are local by default" across instances (`01-app/02-guides/how-revalidation-works.md`, "Multi-Instance Considerations").
     - submitReservation must re-read rules inside its transaction under the lock anyway (spec §10.2 step 6), and spec §6.2 says "Không cache: đặt bàn, availability".
   - Saves still call `updateTag('restaurants')` and `updateTag('booking-rules:<id>')` (spec §10.1). Today only the guest catalogue (tag `restaurants`) depends on them. A future cached reader that embeds rule data should tag `booking-rules:<id>`.
2. **Route handler caching:** under Cache Components a GET handler runs per request once it reads `request.url` (`01-app/01-getting-started/15-route-handlers.md:87-124`). `dynamic` is removed when cacheComponents is on (`…/02-route-segment-config/index.md:19`). I did not use `connection()`: it would also work, but direct `GET(new Request())` calls in Vitest would then need a request scope.
3. **`updateTag` only works inside a Server Action** (`…/04-functions/updateTag.md`). The admin save actions call it after COMMIT.
4. **Lead semantics:** a slot is bookable iff `minutesUntil > lead_minutes`. `venueNow` truncates to the minute, so at 18:30:59 `minutesUntil(19:00)=30` means 29m01s are left. "> lead" is therefore the exact reading of "còn ít nhất lead_minutes", and it matches phase-1 `isSittingClosed` (≤30 closed).
5. **Capacity key:** covers are counted per (restaurant, date, reserved_at), as in phase 1. One service per time is enforced:
   - the admin save rejects overlapping active periods on shared weekdays;
   - the engine also deduplicates a shared time, and the first period by sort order owns it.
6. **Concurrency:**
   - `SET LOCAL lock_timeout='5s'`, then `pg_advisory_xact_lock(hashtextextended('booking:'||restaurant||':'||date,0))`.
   - Inside the lock: re-read the rules and covers → `resolveDay` → INSERT the reservation and its `created` event.
   - The restaurant row is no longer `FOR UPDATE`, so admin saves are never blocked.
   - Dedupe still maps through `err.constraint`: `reservations_dedupe_v2_idx` → `duplicate`, and `reservations_reference_key` → retry, up to 3 times.

## 2. Migration `db/migrations/006_booking_v2.sql` (full)

```sql
-- Phase 4: booking v2 (spec §5.2 "Đặt bàn (đợt 4)", §10).
--
-- Expand only: every existing column and row stays. Safe on a database that
-- already holds phase-1 bookings (they become source 'legacy', is_test, with a
-- 'created' event). Re-running the file is a no-op apart from re-validating
-- the named CHECKs. notification_recipients and email_outbox belong to phase 5.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── booking_settings ──────────────────────────────────────────────────────
-- One row: the defaults every restaurant inherits (restaurant columns below
-- override them when not NULL).
CREATE TABLE IF NOT EXISTS booking_settings (
  id                   boolean     PRIMARY KEY DEFAULT true CONSTRAINT booking_settings_single_row CHECK (id),
  window_days          smallint    NOT NULL DEFAULT 14 CHECK (window_days BETWEEN 1 AND 90),
  lead_minutes         smallint    NOT NULL DEFAULT 30 CHECK (lead_minutes BETWEEN 0 AND 1440),
  -- NULL: no cut-off. '17:00': from 17:00 Da Nang time, no online booking for the same day.
  same_day_cutoff      time        CHECK (extract(second FROM same_day_cutoff) = 0),
  max_party            smallint    NOT NULL DEFAULT 12 CHECK (max_party BETWEEN 1 AND 50),
  auto_confirm         boolean     NOT NULL DEFAULT false,
  guest_ack_email      boolean     NOT NULL DEFAULT true,   -- read from phase 5
  pii_retention_months smallint    NOT NULL DEFAULT 24 CHECK (pii_retention_months BETWEEN 1 AND 120),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);

INSERT INTO booking_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ── restaurants: the booking switch and per-restaurant overrides ──────────
-- NULL = inherit booking_settings. updated_at/updated_by are also in the phase-6
-- column list; IF NOT EXISTS keeps whichever migration runs second harmless.
ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS booking_enabled boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS window_days     smallint    CHECK (window_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS lead_minutes    smallint    CHECK (lead_minutes BETWEEN 0 AND 1440),
  ADD COLUMN IF NOT EXISTS max_party       smallint    CHECK (max_party BETWEEN 1 AND 50),
  ADD COLUMN IF NOT EXISTS auto_confirm    boolean,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by      text;

-- ── service_periods ───────────────────────────────────────────────────────
-- The weekly template. Slots run first_seating, +interval_min, … last_seating.
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

CREATE INDEX IF NOT EXISTS service_periods_restaurant_idx ON service_periods (restaurant_id) WHERE active;

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

-- ── closures, closure_i18n ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS closures (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope          text        NOT NULL CHECK (scope IN ('all', 'destination', 'restaurant')),
  destination_id text        REFERENCES destinations (id) ON UPDATE CASCADE ON DELETE CASCADE,
  restaurant_id  text        REFERENCES restaurants (id) ON UPDATE CASCADE ON DELETE CASCADE,
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

-- The guest-facing reason, per language. Same translation columns as content_strings (spec §5.1).
CREATE TABLE IF NOT EXISTS closure_i18n (
  closure_id    bigint      NOT NULL REFERENCES closures (id) ON DELETE CASCADE,
  locale        text        NOT NULL REFERENCES locales (code) ON UPDATE CASCADE ON DELETE CASCADE,
  public_reason text        NOT NULL CHECK (public_reason <> '' AND length(public_reason) <= 160),
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
  -- Rows that exist now are phase-1 bookings: 'legacy'. New rows name their source.
  ADD COLUMN IF NOT EXISTS source        text        NOT NULL DEFAULT 'legacy'
                                         CHECK (source IN ('web', 'phone', 'walk_in', 'staff', 'legacy')),
  -- The FK to offers arrives with the offers table (phase 6).
  ADD COLUMN IF NOT EXISTS offer_id      bigint,
  ADD COLUMN IF NOT EXISTS over_capacity boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status_reason text        CHECK (length(status_reason) <= 500),
  ADD COLUMN IF NOT EXISTS confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  -- Folded name, email, phone digits and reference; written by the app
  -- (lib/server/booking/search-text.ts), NULL once anonymised.
  ADD COLUMN IF NOT EXISTS search_text   text,
  ADD COLUMN IF NOT EXISTS is_test       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  -- Optimistic concurrency: the reservations_touch trigger bumps it on every UPDATE.
  ADD COLUMN IF NOT EXISTS version       integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by    text;

ALTER TABLE reservations ALTER COLUMN source DROP DEFAULT;

-- Backfill the phase-1 rows. The meal is the restaurant's period that covers
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

UPDATE reservations
   SET search_text = concat_ws(' ', lower(guest_name), lower(email), reference,
                               regexp_replace(phone_e164, '\D', '', 'g'),
                               CASE WHEN phone_e164 LIKE '+84%' THEN '0' || substr(phone_e164, 4) END),
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

-- Only staff bookings may go over capacity (spec §10.3); the reason is on the 'created' event.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_over_capacity_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_over_capacity_check
  CHECK (NOT over_capacity OR source IN ('phone', 'walk_in', 'staff'));

CREATE OR REPLACE FUNCTION reservations_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_touch ON reservations;
CREATE TRIGGER reservations_touch BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_touch();

-- ── reservations: indexes ─────────────────────────────────────────────────
-- reservations_dedupe_v2_idx (migration 003) stays as it is.
-- Covers held per slot: the availability read and the capacity check. Holding
-- statuses are requested, confirmed and seated (spec §10.3).
DROP INDEX IF EXISTS reservations_slot_idx;
CREATE INDEX IF NOT EXISTS reservations_load_idx
  ON reservations (restaurant_id, reserved_on, reserved_at) INCLUDE (guests)
  WHERE status IN ('requested', 'confirmed', 'seated');
CREATE INDEX IF NOT EXISTS reservations_inbox_idx ON reservations (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS reservations_pending_idx
  ON reservations (reserved_on, reserved_at) WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS reservations_day_idx ON reservations (reserved_on, restaurant_id, reserved_at);
CREATE INDEX IF NOT EXISTS reservations_phone_idx ON reservations (phone_e164, reserved_on);
CREATE INDEX IF NOT EXISTS reservations_search_idx ON reservations USING gin (search_text gin_trgm_ops);

-- ── reservation_events, reservation_notes ─────────────────────────────────
-- The booking timeline. Booking writes go here INSTEAD of audit_log (spec §7.4).
-- actor_* are snapshots without FKs, like audit_log.
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
  changes        jsonb,      -- {"guests": [2, 4]}; phase 10 strips personal keys when anonymising
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

-- The phase-1 rows get their 'created' event, once.
INSERT INTO reservation_events (reservation_id, at, actor_kind, actor_label, type, to_status, reason)
SELECT r.id, r.created_at, 'system', 'migration 006', 'created', r.status, 'phase-1 booking'
  FROM reservations r
 WHERE r.source = 'legacy'
   AND NOT EXISTS (SELECT 1 FROM reservation_events e WHERE e.reservation_id = r.id);

-- ── audit_feed ────────────────────────────────────────────────────────────
-- Same columns, same order as migration 005; reservation events join the feed.
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
       e.actor_label,
       'reservation.' || e.type,
       'reservation'::text,
       e.reservation_id::text,
       NULL::text,
       CASE WHEN e.from_status IS NULL THEN NULL ELSE jsonb_build_object('status', e.from_status) END,
       jsonb_strip_nulls(jsonb_build_object('status', e.to_status, 'reason', e.reason)) || COALESCE(e.changes, '{}'::jsonb)
  FROM reservation_events e;
```

What I checked by hand on 001–005 plus three legacy rows (confirmed, cancelled, requested; one with a +1 phone):
- Every row was kept and mapped to meal Dinner, Breakfast and Drinks respectively.
- source is `legacy`, is_test is true, version is 1, and updated_at equals created_at.
- search_text example: `nguyễn văn a a@x.com FC-12345 84905000000 0905000000`.
- Each row got 3 `created` events with actor `system`, and they show in audit_feed.
- 25 periods were seeded, one per restaurant meal (the sum of `cardinality(meals)`).
- Re-applying the file is a no-op: 25 periods, 3 events, versions unchanged.
- The trigger works: an UPDATE moves version 1→2 and touches updated_at.

## 3. Engine (isomorphic, pure)

### `lib/venue-time.ts` (additions)
```ts
/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday (spec §5.2 service_periods.weekdays). */
export const isoWeekday = (d: IsoDate): number => new Date(utcMidnight(d)).getUTCDay() || 7;

/** 1140 → "19:00". */
export const fromMinutes = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
```
`lib/booking/` (a directory) sits next to the existing `lib/booking.ts`. `@/lib/booking` still resolves to the file, under both tsc and Turbopack; the build passes.

### `lib/booking/rules.ts`
```ts
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';

/*
 * The booking rules of one restaurant, as resolveDay reads them (spec §10.1).
 * No server-only import: the admin's slot preview runs the same engine in the
 * browser. The server loads these from the database in
 * lib/server/booking/rules.ts (booking_settings merged with the restaurant's
 * overrides, its active service periods, the closures that reach it).
 */

/** Statuses that hold covers (spec §10.3). One list for SQL, the engine and the admin. */
export const HOLDING_STATUSES = ['requested', 'confirmed', 'seated'] as const;

export const RESERVATION_STATUSES = ['requested', 'confirmed', 'seated', 'no_show', 'cancelled', 'declined'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export type PeriodRule = {
  id: string;
  meal: Meal;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** "HH:MM", Da Nang time. */
  firstSeating: string;
  lastSeating: string;
  intervalMin: number;
  coversPerSlot: number;
  sortOrder: number;
  /** Absent means active: the loader only returns active periods; the admin preview passes drafts. */
  active?: boolean;
};

export type ClosureRule = {
  id: string;
  scope: 'all' | 'destination' | 'restaurant';
  destinationId: string | null;
  restaurantId: string | null;
  startsOn: IsoDate;
  endsOn: IsoDate;
  /** null: the whole day. */
  meals: Meal[] | null;
  /** Already resolved for the guest's language, and null when show_reason is off. */
  publicReason: string | null;
};

export type BookingRules = {
  restaurantId: string;
  restaurantName: string;
  destinationId: string;
  bookingEnabled: boolean;
  windowDays: number;
  leadMinutes: number;
  /** "HH:MM" or null (no same-day cut-off). */
  sameDayCutoff: string | null;
  maxParty: number;
  autoConfirm: boolean;
  periods: PeriodRule[];
  closures: ClosureRule[];
};

/** Covers held per "HH:MM" on one date. */
export type BookedCovers = Record<string, number>;

/** Why a slot cannot take this party. */
export type SlotBlock = 'closed' | 'lead' | 'cutoff' | 'party' | 'full';

export type ResolvedSlot = {
  time: string;
  capacity: number;
  booked: number;
  /** Covers still free (never negative: staff bookings may go over). */
  left: number;
  bookable: boolean;
  block?: SlotBlock;
};

export type ResolvedPeriod = {
  periodId: string;
  meal: Meal;
  /** A closure takes out this meal on this date; its slots carry block 'closed'. */
  closed: boolean;
  reason: string | null;
  slots: ResolvedSlot[];
};

/**
 * - unavailable: online booking is off for the restaurant
 * - outside: before today or past the booking window
 * - closed: no service that weekday, or closures take out every service
 * - too_large: the party is larger than max_party
 * - past: every remaining sitting is inside the lead time or the same-day cut-off
 * - full: sittings remain, none with room for the party
 * - open: at least one bookable slot
 */
export type DayState = 'open' | 'full' | 'past' | 'closed' | 'too_large' | 'outside' | 'unavailable';

export type ResolvedDay = {
  date: IsoDate;
  state: DayState;
  /** The public closure reason, when a closure caused 'closed' and shows its reason. */
  reason: string | null;
  periods: ResolvedPeriod[];
};
```

### `lib/booking/resolve-day.ts`
```ts
import { addDays, daysBetween, fromMinutes, isoWeekday, toMinutes, venueNow, type IsoDate } from '@/lib/venue-time';
import type { BookedCovers, BookingRules, ClosureRule, DayState, PeriodRule, ResolvedDay, ResolvedPeriod, ResolvedSlot, SlotBlock } from './rules';

/*
 * resolveDay (spec §10.1): what one restaurant offers on one date, for a party
 * of `guests`, at the instant `now`. Pure: the guest API, submitReservation
 * (inside its transaction) and the admin preview all call it with rules and
 * booked covers they loaded themselves.
 */

/** The seatings of one period: first, first + interval, … up to last. */
export function seatings(period: Pick<PeriodRule, 'firstSeating' | 'lastSeating' | 'intervalMin'>): string[] {
  const first = toMinutes(period.firstSeating);
  const last = toMinutes(period.lastSeating);
  const out: string[] = [];
  if (period.intervalMin <= 0) return out;
  for (let m = first; m <= last; m += period.intervalMin) out.push(fromMinutes(m));
  return out;
}

/** True when the closure reaches this restaurant on this date. */
export function closureApplies(c: ClosureRule, rules: Pick<BookingRules, 'restaurantId' | 'destinationId'>, date: IsoDate): boolean {
  if (date < c.startsOn || date > c.endsOn) return false;
  if (c.scope === 'all') return true;
  if (c.scope === 'destination') return c.destinationId === rules.destinationId;
  return c.restaurantId === rules.restaurantId;
}

const byOrder = (a: PeriodRule, b: PeriodRule) =>
  a.sortOrder - b.sortOrder || toMinutes(a.firstSeating) - toMinutes(b.firstSeating);

/** One service on one date, before the clock, the bookings or the party size are applied. */
export type PlannedPeriod = {
  periodId: string;
  meal: PeriodRule['meal'];
  closed: boolean;
  reason: string | null;
  slots: { time: string; capacity: number }[];
};

/**
 * Steps 1–3 of spec §10.1 for one date: the active periods of its weekday,
 * closures applied, slots generated. Clock-free, so the admin uses it to
 * preview a schedule and to find the bookings an edit or a closure leaves out.
 */
export function planDay(
  rules: Pick<BookingRules, 'restaurantId' | 'destinationId' | 'periods' | 'closures'>,
  date: IsoDate,
): { periods: PlannedPeriod[]; wholeDayReason: string | null } {
  const weekday = isoWeekday(date);
  const closures = rules.closures.filter((c) => closureApplies(c, rules, date));
  const wholeDay = closures.filter((c) => c.meals === null);
  // Two periods that share a time (an admin save rejects this) would double the
  // slot; the first by sort order keeps it.
  const seen = new Set<string>();
  const periods = rules.periods
    .filter((p) => p.active !== false && p.weekdays.includes(weekday))
    .sort(byOrder)
    .map((p) => {
      const closure = wholeDay[0] ?? closures.find((c) => c.meals?.includes(p.meal));
      const slots = seatings(p)
        .filter((time) => !seen.has(time) && Boolean(seen.add(time)))
        .map((time) => ({ time, capacity: p.coversPerSlot }));
      return { periodId: p.id, meal: p.meal, closed: Boolean(closure), reason: closure?.publicReason ?? null, slots };
    });
  return { periods, wholeDayReason: wholeDay.find((c) => c.publicReason)?.publicReason ?? null };
}

export function resolveDay(
  rules: BookingRules,
  date: IsoDate,
  now: Date,
  booked: BookedCovers = {},
  guests = 1,
): ResolvedDay {
  if (!rules.bookingEnabled) return { date, state: 'unavailable', reason: null, periods: [] };

  const clock = venueNow(now);
  const offset = daysBetween(clock.date, date);
  if (offset < 0 || offset >= rules.windowDays) return { date, state: 'outside', reason: null, periods: [] };

  // venueNow truncates to the minute, so "minutes left > lead" is "at least lead minutes left".
  const cutoffPassed = offset === 0 && rules.sameDayCutoff !== null && clock.minutes >= toMinutes(rules.sameDayCutoff);
  const tooLarge = guests > rules.maxParty;
  const plan = planDay(rules, date);

  const periods: ResolvedPeriod[] = plan.periods.map((p) => ({
    ...p,
    slots: p.slots.map(({ time, capacity }): ResolvedSlot => {
      const taken = booked[time] ?? 0;
      const minutesLeft = offset * 1440 + toMinutes(time) - clock.minutes;
      const block: SlotBlock | undefined = p.closed
        ? 'closed'
        : minutesLeft <= rules.leadMinutes
          ? 'lead'
          : cutoffPassed
            ? 'cutoff'
            : tooLarge
              ? 'party'
              : taken + guests > capacity
                ? 'full'
                : undefined;
      return { time, capacity, booked: taken, left: Math.max(0, capacity - taken), bookable: block === undefined, ...(block ? { block } : {}) };
    }),
  }));

  const closedReason = periods.find((p) => p.closed && p.reason)?.reason ?? plan.wholeDayReason;
  return { date, ...dayState(periods, tooLarge, closedReason), periods };
}

function dayState(periods: ResolvedPeriod[], tooLarge: boolean, closedReason: string | null): { state: DayState; reason: string | null } {
  const open = periods.filter((p) => !p.closed).flatMap((p) => p.slots);
  if (open.length === 0) return { state: 'closed', reason: closedReason };
  if (tooLarge) return { state: 'too_large', reason: null };
  if (open.every((s) => s.block === 'lead' || s.block === 'cutoff')) return { state: 'past', reason: null };
  return { state: open.some((s) => s.bookable) ? 'open' : 'full', reason: null };
}

/** The period and slot a time belongs to on a resolved day, if any. */
export function findSlot(day: ResolvedDay, time: string): { period: ResolvedPeriod; slot: ResolvedSlot } | null {
  for (const period of day.periods) {
    const slot = period.slots.find((s) => s.time === time);
    if (slot) return { period, slot };
  }
  return null;
}

/** Day states for a calendar strip: from..to inclusive, a party of one. */
export function resolveRange(rules: BookingRules, from: IsoDate, to: IsoDate, now: Date, bookedByDate: Record<IsoDate, BookedCovers>): { date: IsoDate; state: DayState; reason?: string }[] {
  const out: { date: IsoDate; state: DayState; reason?: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = resolveDay(rules, d, now, bookedByDate[d] ?? {});
    out.push(day.reason ? { date: d, state: day.state, reason: day.reason } : { date: d, state: day.state });
  }
  return out;
}
```

### `lib/booking/slot-code.ts` (day + time → guest error code)
```ts
import type { BookingErrorCode } from '@/lib/booking-errors';
import { findSlot } from './resolve-day';
import type { DayState, ResolvedDay, ResolvedPeriod, SlotBlock } from './rules';

const DAY_CODES: Partial<Record<DayState, BookingErrorCode>> = { unavailable: 'restaurant_unavailable', outside: 'outside_window', too_large: 'party_too_large' };
const SLOT_CODES: Record<SlotBlock, BookingErrorCode> = { closed: 'closed', lead: 'past', cutoff: 'past', party: 'party_too_large', full: 'full' };

export type SlotVerdict = { ok: true; period: ResolvedPeriod } | { ok: false; code: BookingErrorCode };

export function slotVerdict(day: ResolvedDay, time: string): SlotVerdict {
  const dayCode = DAY_CODES[day.state];
  if (dayCode) return { ok: false, code: dayCode };
  const hit = findSlot(day, time);
  if (!hit) return { ok: false, code: day.state === 'closed' ? 'closed' : 'slot_unavailable' };
  if (hit.slot.block) return { ok: false, code: SLOT_CODES[hit.slot.block] };
  return { ok: true, period: hit.period };
}
```

### `lib/booking/api.ts` (API response types shared with the guest form)
```ts
import type { Meal } from '@/lib/data';
import type { IsoDate } from '@/lib/venue-time';
import type { DayState, SlotBlock } from './rules';

type Clock = { today: IsoDate; now: string /* ISO instant */; maxParty: number };
/** ?restaurant=&from=&to= */
export type AvailabilityDays = Clock & { days: { date: IsoDate; state: DayState; reason?: string }[] };
/** ?restaurant=&date=&guests= */
export type AvailabilityDay = Clock & {
  date: IsoDate; state: DayState; reason?: string;
  periods: { meal: Meal; closed: boolean; reason?: string; slots: { time: string; left: number; bookable: boolean; block?: SlotBlock }[] }[];
};
```

## 4. Server: where the rules live (`lib/server/booking/*`)

### `lib/server/booking/rules.ts` (live loaders; one round trip each)
```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { HOLDING_STATUSES, type BookedCovers, type BookingRules } from '@/lib/booking/rules';
import type { IsoDate } from '@/lib/venue-time';

export type Db = Pool | PoolClient;
type RulesRow = { id: string; name: string; destination: string; booking_enabled: boolean; window_days: number; lead_minutes: number; same_day_cutoff: string | null; max_party: number; auto_confirm: boolean; periods: BookingRules['periods']; closures: BookingRules['closures'] };

export async function loadBookingRules(db: Db, restaurantId: string, locale: string, today: IsoDate): Promise<BookingRules | null> {
  const { rows } = await db.query<RulesRow>(
    `SELECT r.id, r.name, r.destination, r.booking_enabled,
            COALESCE(r.window_days, s.window_days)::int   AS window_days,
            COALESCE(r.lead_minutes, s.lead_minutes)::int AS lead_minutes,
            to_char(s.same_day_cutoff, 'HH24:MI')         AS same_day_cutoff,
            COALESCE(r.max_party, s.max_party)::int       AS max_party,
            COALESCE(r.auto_confirm, s.auto_confirm)      AS auto_confirm,
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
                LEFT JOIN locales l ON l.code = $2
                LEFT JOIN closure_i18n t
                       ON t.closure_id = c.id AND t.locale = $2 AND (t.status = 'reviewed' OR l.serve_machine)
                LEFT JOIN closure_i18n d
                       ON d.closure_id = c.id AND d.locale = (SELECT code FROM locales WHERE is_default)
               WHERE c.ends_on >= $3::date
                 AND (c.scope = 'all'
                      OR (c.scope = 'destination' AND c.destination_id = r.destination)
                      OR (c.scope = 'restaurant' AND c.restaurant_id = r.id))), '[]') AS closures
       FROM restaurants r
      CROSS JOIN booking_settings s
      WHERE r.id = $1`,
    [restaurantId, locale, today],
  );
  const r = rows[0];
  if (!r) return null;
  return { restaurantId: r.id, restaurantName: r.name, destinationId: r.destination, bookingEnabled: r.booking_enabled, windowDays: r.window_days, leadMinutes: r.lead_minutes, sameDayCutoff: r.same_day_cutoff, maxParty: r.max_party, autoConfirm: r.auto_confirm, periods: r.periods, closures: r.closures };
}

/** Covers held per date and "HH:MM" for one restaurant, from..to inclusive. */
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
```
(The file header comment in the clone explains why nothing is cached.) Always format `date` columns with `to_char`, because node-pg turns `date` into a local-TZ JS Date.

### `lib/server/booking/input.ts` (submitReservation step 2, zod 4)
```ts
import 'server-only';
import * as z from 'zod';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { toE164 } from '@/lib/phone';
import { isValidIsoDate, type IsoDate } from '@/lib/venue-time';

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const schema = z.object({
  restaurant: z.string().min(1).max(64),
  date: z.string().refine(isValidIsoDate),
  time: z.string().regex(HHMM),
  // No upper bound here: max_party decides, and answers party_too_large.
  guests: z.number().int().min(1),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).refine((p) => p.replace(/\D/g, '').length >= 8),
  email: z.string().trim().max(254).refine((e) => e === '' || /^\S+@\S+\.\S+$/.test(e)),
  note: z.string().trim().max(1000),
  locale: z.string().max(35).optional(),
});
const FIELD_CODES: [field: string, code: BookingErrorCode][] = [
  ['restaurant', 'restaurant_unavailable'], ['date', 'outside_window'], ['time', 'slot_unavailable'], ['guests', 'unknown'],
  ['name', 'invalid_name'], ['phone', 'invalid_phone'], ['email', 'invalid_email'], ['note', 'unknown'], ['locale', 'unknown'],
];
export type ReservationRequest = { restaurantId: string; date: IsoDate; time: string; guests: number; name: string; phone: string; phoneE164: string; email: string | null; note: string | null; locale: string };
export type ParseResult = { ok: true; value: ReservationRequest } | { ok: false; code: BookingErrorCode };

export function parseReservationInput(input: unknown): ParseResult {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const failed = new Set(parsed.error.issues.map((i) => String(i.path[0])));
    return { ok: false, code: FIELD_CODES.find(([field]) => failed.has(field))?.[1] ?? 'unknown' };
  }
  const v = parsed.data;
  const phoneE164 = toE164(v.phone); // step 4
  if (!phoneE164) return { ok: false, code: 'invalid_phone' };
  return { ok: true, value: { restaurantId: v.restaurant, date: v.date, time: v.time, guests: v.guests, name: v.name, phone: v.phone, phoneE164, email: v.email || null, note: v.note || null, locale: v.locale ?? 'en' } };
}
```

### `lib/server/booking/search-text.ts`
```ts
import { fold } from '@/lib/booking';
export function searchText(r: { name: string; email: string | null; phoneE164: string; reference: string }): string {
  const digits = r.phoneE164.replace(/\D/g, '');
  const national = r.phoneE164.startsWith('+84') ? `0${digits.slice(2)}` : null;
  return [fold(r.name), r.email ? r.email.toLowerCase() : null, r.reference, digits, national].filter(Boolean).join(' ');
}
```

### `lib/server/booking/create.ts` (step 6; the transactional write)
```ts
import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '@/db/client';
import { resolveDay } from '@/lib/booking/resolve-day';
import { slotVerdict } from '@/lib/booking/slot-code';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { newReference } from '@/lib/server/reference';
import { venueNow, type IsoDate } from '@/lib/venue-time';
import type { ReservationRequest } from './input';
import { loadBookedCovers, loadBookingRules } from './rules';
import { searchText } from './search-text';

export type CreateOutcome =
  | { ok: true; id: string; reference: string; date: IsoDate; status: 'requested' | 'confirmed' }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

const REFERENCE_ATTEMPTS = 3;
function violatedConstraint(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { code?: string; constraint?: string };
  return e.code === '23505' ? (e.constraint ?? null) : null;
}

export type CreateOptions = { now?: Date; makeReference?: () => string; /** Tests pass a second pool to play a second server instance. */ pool?: Pool };

export async function createWebReservation(input: ReservationRequest, { now = new Date(), makeReference = newReference, pool = getPool() }: CreateOptions = {}): Promise<CreateOutcome> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insertOnce(pool, input, now, makeReference());
    } catch (err) {
      const constraint = violatedConstraint(err);
      if (constraint === 'reservations_dedupe_v2_idx') return { ok: false, code: 'duplicate' };
      if (constraint === 'reservations_reference_key' && attempt < REFERENCE_ATTEMPTS) continue;
      throw err;
    }
  }
}

async function insertOnce(pool: Pool, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await insertInTransaction(client, input, now, reference);
    await client.query(outcome.ok ? 'COMMIT' : 'ROLLBACK');
    return outcome;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Exported for the staff path, which runs it inside its own transaction. */
export async function lockBookingDay(client: PoolClient, restaurantId: string, date: IsoDate): Promise<void> {
  // A stuck holder must not queue every booking for that day (and the pool's 5
  // connections) forever: give up after 5 s with 55P03, which reaches the guest as error.network.
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  // hashtextextended → bigint, the key space of pg_advisory_xact_lock; released at COMMIT/ROLLBACK.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('booking:' || $1 || ':' || $2, 0))`, [restaurantId, date]);
}

async function insertInTransaction(client: PoolClient, input: ReservationRequest, now: Date, reference: string): Promise<CreateOutcome> {
  await lockBookingDay(client, input.restaurantId, input.date);
  const rules = await loadBookingRules(client, input.restaurantId, input.locale, venueNow(now).date);
  if (!rules) return { ok: false, code: 'restaurant_unavailable' };
  const booked = (await loadBookedCovers(client, input.restaurantId, input.date, input.date))[input.date] ?? {};
  const day = resolveDay(rules, input.date, now, booked, input.guests);
  const verdict = slotVerdict(day, input.time);
  if (!verdict.ok) {
    if (verdict.code === 'slot_unavailable') return { ...verdict, params: { restaurant: rules.restaurantName } };
    if (verdict.code === 'party_too_large') return { ...verdict, params: { max: String(rules.maxParty) } };
    return verdict;
  }
  const status = rules.autoConfirm ? 'confirmed' : 'requested';
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO reservations
       (reference, restaurant_id, reserved_on, reserved_at, meal, guests, guest_name, phone, phone_e164,
        email, note, status, confirmed_at, source, locale, search_text)
     VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             CASE WHEN $12 = 'confirmed' THEN now() END, 'web',
             COALESCE((SELECT code FROM locales WHERE code = $13 AND is_enabled),
                      (SELECT code FROM locales WHERE is_default)),
             $14)
     RETURNING id::text`,
    [reference, input.restaurantId, input.date, input.time, verdict.period.meal, input.guests, input.name, input.phone, input.phoneE164, input.email, input.note, status, input.locale,
     searchText({ name: input.name, email: input.email, phoneE164: input.phoneE164, reference })],
  );
  const id = rows[0].id;
  await client.query(`INSERT INTO reservation_events (reservation_id, actor_kind, type, to_status) VALUES ($1, 'guest', 'created', $2)`, [id, status]);
  return { ok: true, id, reference, date: input.date, status };
}
```

### `lib/server/booking/affected.ts` ("affected reservations listed, never auto-cancel")
```ts
import 'server-only';
import { planDay } from '@/lib/booking/resolve-day';
import { HOLDING_STATUSES, type BookingRules } from '@/lib/booking/rules';
import { fromMinutes, type IsoDate } from '@/lib/venue-time';
import type { Db } from './rules';

export type AffectedReason = 'outside_hours' | 'closed' | 'over_capacity';
export type AffectedReservation = { id: string; reference: string; date: IsoDate; time: string; guests: number; status: string; reason: AffectedReason };

export async function listAffectedReservations(db: Db, rules: Pick<BookingRules, 'restaurantId' | 'destinationId' | 'periods' | 'closures'>, now: { date: IsoDate; minutes: number }): Promise<AffectedReservation[]> {
  const { rows } = await db.query<Omit<AffectedReservation, 'reason'>>(
    `SELECT id::text, reference, to_char(reserved_on, 'YYYY-MM-DD') AS date, reserved_at AS time, guests, status
       FROM reservations
      WHERE restaurant_id = $1 AND status = ANY ($2::text[])
        AND (reserved_on > $3::date OR (reserved_on = $3::date AND reserved_at > $4))
      ORDER BY reserved_on, reserved_at, id`,
    [rules.restaurantId, HOLDING_STATUSES, now.date, fromMinutes(now.minutes)],
  );
  const plans = new Map<IsoDate, Map<string, { capacity: number; closed: boolean }>>();
  const slotOf = (date: IsoDate, time: string) => {
    let plan = plans.get(date);
    if (!plan) {
      plan = new Map(planDay(rules, date).periods.flatMap((p) => p.slots.map((s) => [s.time, { capacity: s.capacity, closed: p.closed }])));
      plans.set(date, plan);
    }
    return plan.get(time);
  };
  const covers = new Map<string, number>();
  for (const r of rows) covers.set(`${r.date} ${r.time}`, (covers.get(`${r.date} ${r.time}`) ?? 0) + r.guests);
  return rows.flatMap((r) => {
    const slot = slotOf(r.date, r.time);
    const reason: AffectedReason | null = !slot ? 'outside_hours' : slot.closed ? 'closed' : (covers.get(`${r.date} ${r.time}`) ?? 0) > slot.capacity ? 'over_capacity' : null;
    return reason ? [{ ...r, reason }] : [];
  });
}
```

### `lib/server/booking/schedule.ts` (admin writes to audit_log; with an updated_at conflict check and an overlap check)
The key parts are below. The full file is in the patch.
```ts
const PERIOD_COLUMNS = `id::text, restaurant_id, meal, weekdays, to_char(first_seating, 'HH24:MI') AS first_seating,
  to_char(last_seating, 'HH24:MI') AS last_seating, interval_min, covers_per_slot, active,
  to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
export type SaveResult = { ok: true } | { ok: false; code: 'not_found' | 'conflict' | 'overlap' };
export async function updatePeriod(pool, actor, input): Promise<SaveResult> {
  return withTransaction(pool, async (client) => {
    const before = await client.query(`SELECT ${PERIOD_COLUMNS} FROM service_periods WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`, [input.periodId, input.restaurantId]);
    if (!before.rowCount) return { ok: false, code: 'not_found' };
    if (before.rows[0].updated_at !== input.expectedUpdatedAt) return { ok: false, code: 'conflict' };
    // One service at a time per restaurant and weekday: resolveDay keys slots by time alone.
    const overlap = await client.query(`SELECT 1 FROM service_periods WHERE restaurant_id = $1 AND id <> $2 AND active AND weekdays && $3::smallint[] AND first_seating <= $5::time AND last_seating >= $4::time`, [input.restaurantId, input.periodId, input.weekdays, input.firstSeating, input.lastSeating]);
    if (overlap.rowCount) return { ok: false, code: 'overlap' };
    const after = await client.query(`UPDATE service_periods SET weekdays = $3, first_seating = $4, last_seating = $5, interval_min = $6, covers_per_slot = $7, updated_at = now(), updated_by = $8 WHERE id = $1 AND restaurant_id = $2 RETURNING ${PERIOD_COLUMNS}`, [...]);
    await insertAudit(client, actor, { action: 'update', entityType: 'service_period', entityId: input.periodId, before: before.rows[0], after: after.rows[0] });
    return { ok: true };
  });
}
// setBookingEnabled(pool, actor, restaurantId, enabled): FOR UPDATE, UPDATE restaurants SET booking_enabled, updated_at, updated_by; insertAudit entity 'restaurant' {booking_enabled}.
```

### `app/actions.ts` (public; the name and result shape are kept, and `data.status` is added)
```ts
'use server';
import type { BookingErrorCode } from '@/lib/booking-errors';
import { createWebReservation } from '@/lib/server/booking/create';
import { parseReservationInput } from '@/lib/server/booking/input';
import type { IsoDate } from '@/lib/venue-time';

export type ReservationResult =
  | { ok: true; data: { reference: string; date: IsoDate; status: 'requested' | 'confirmed' } }
  | { ok: false; code: BookingErrorCode; params?: Record<string, string> };

export async function submitReservation(input: unknown): Promise<ReservationResult> {
  const parsed = parseReservationInput(input);
  if (!parsed.ok) return parsed;
  const result = await createWebReservation(parsed.value);
  if (!result.ok) return result;
  return { ok: true, data: { reference: result.reference, date: result.date, status: result.status } };
}
```
A DB error still throws, so the client shows `error.network` (spec §12). The guard test passes because `submitReservation` is still on the public allowlist.

### `app/api/availability/route.ts` (v2, uncached)
```ts
import { NextResponse } from 'next/server';
import { getPool } from '@/db/client';
import { resolveDay, resolveRange } from '@/lib/booking/resolve-day';
import type { AvailabilityDay, AvailabilityDays } from '@/lib/booking/api';
import { loadBookedCovers, loadBookingRules } from '@/lib/server/booking/rules';
import { addDays, daysBetween, isValidIsoDate, venueNow } from '@/lib/venue-time';

const MAX_RANGE_DAYS = 92;
const LOCALE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const restaurant = params.get('restaurant');
  const lang = params.get('lang') ?? 'en';
  const now = new Date();
  const today = venueNow(now).date;
  if (!restaurant) return bad('restaurant is required');
  if (!LOCALE.test(lang)) return bad('lang is invalid');
  const date = params.get('date');
  const guestsParam = params.get('guests');
  const guests = guestsParam === null ? 1 : Number(guestsParam);
  if (date !== null && !isValidIsoDate(date)) return bad('date is invalid');
  if (!Number.isInteger(guests) || guests < 1 || guests > 50) return bad('guests is invalid');
  try {
    const pool = getPool();
    const rules = await loadBookingRules(pool, restaurant, lang, today);
    if (!rules) return NextResponse.json({ error: 'unknown restaurant' }, { status: 404 });
    const clock = { today, now: now.toISOString(), maxParty: rules.maxParty };
    if (date !== null) {
      const booked = (await loadBookedCovers(pool, restaurant, date, date))[date] ?? {};
      const day = resolveDay(rules, date, now, booked, guests);
      const body: AvailabilityDay = {
        ...clock, date, state: day.state, ...(day.reason ? { reason: day.reason } : {}),
        periods: day.periods.map((p) => ({ meal: p.meal, closed: p.closed, ...(p.reason ? { reason: p.reason } : {}),
          slots: p.slots.map((s) => ({ time: s.time, left: s.left, bookable: s.bookable, ...(s.block ? { block: s.block } : {}) })) })),
      };
      return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
    }
    const from = params.get('from') ?? today;
    const to = params.get('to') ?? addDays(today, rules.windowDays - 1);
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) return bad('from/to is invalid');
    const span = daysBetween(from, to);
    if (span < 0 || span >= MAX_RANGE_DAYS) return bad('from/to is out of range');
    const booked = await loadBookedCovers(pool, restaurant, from, to);
    const body: AvailabilityDays = { ...clock, days: resolveRange(rules, from, to, now, booked) };
    return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.error('availability_failed', { name: err instanceof Error ? err.name : typeof err });
    return NextResponse.json({ error: 'availability unavailable' }, { status: 503 });
  }
}
```
**Transitional v1 compat, validated: 74/75 E2E with it.** Use this only if the API task ships before the guest-form task. Spread these into the day body: `booked, capacity: Math.max(0, ...rules.periods.map((p) => p.coversPerSlot))`.

### Admin "Giờ và sức chứa" (a minimal stand-in that proves updateTag): `app/admin/(shell)/restaurants/[id]/booking/actions.ts`
```ts
'use server';
import { updateTag } from 'next/cache';
// … getPool, z (lib/admin/zod), TAGS, actionError, listAffectedReservations, loadBookingRules, setBookingEnabled, updatePeriod, auditActor, requirePermission, venueNow
export async function saveServicePeriod(_prev: SaveScheduleResult | null, formData: FormData): Promise<SaveScheduleResult> {
  try {
    const actor = await requirePermission({ schedule: ['update'] });
    const input = PeriodForm.parse({ /* restaurantId, periodId, expectedUpdatedAt, weekdays: formData.getAll('weekdays'), firstSeating, lastSeating, intervalMin, coversPerSlot */ });
    const result = await updatePeriod(getPool(), auditActor(actor), input);
    if (!result.ok) {
      if (result.code === 'overlap') return { ok: false, code: 'invalid', fieldErrors: { firstSeating: ['Trùng giờ với một ca khác vào cùng ngày.'] } };
      return { ok: false, code: result.code };
    }
    updateTag(TAGS.restaurants);
    updateTag(TAGS.bookingRules(input.restaurantId));
    return { ok: true, data: { affected: await affectedNow(input.restaurantId) } };
  } catch (err) {
    return actionError(err);
  }
}
export async function saveBookingEnabled(_prev, formData) { /* requirePermission({ reservations: ['configure'] }) → zod → setBookingEnabled → updateTag(restaurants) + updateTag(booking-rules:<id>) */ }
```
PeriodForm zod:
- HH:MM regex, and the weekdays array must have at least one entry.
- `intervalMin: z.coerce.number().pipe(z.union([15,20,30,45,60,90,120].map((n) => z.literal(n))))`.
- Refines: last ≥ first, and the span is a multiple of the interval.

The page is `page.tsx` with `instant = false` and `requirePagePermission({ schedule: ['read'] })`. It renders BookingSwitch plus one `<PeriodForm key={p.id} …>` per period. **The key must not include updated_at**: updateTag re-renders the page, a changed key remounts the form, and the `useActionState` result is lost (error #9).

### Guest catalogue: hiding booking_enabled=false
- `db/queries.ts listRestaurants` selects `booking_enabled` and maps it to `bookingEnabled`.
- `Restaurant` in lib/data.ts gains `bookingEnabled: boolean`.
- `getRestaurants(locale)` keeps `'use cache'`, `cacheLife('max')` and `cacheTag(TAGS.restaurants, TAGS.i18n(locale))`.
- The admin save calls `updateTag('restaurants')`. The E2E shows `/en`'s RSC payload flip from `taya-house=true` to `false` on the next request, and that it stays `true` without the updateTag.
- Still to do in the guest form:
  - filter `restaurants.filter((r) => r.bookingEnabled)` in BookingBar `restaurantOptions` and ReserveDrawer `restaurantOptions`;
  - hide RESERVE in TayaHero, MobileBar, Offers, and the RestaurantCard "Reserve a table" tag and click for disabled restaurants;
  - `SiteProvider` defaults to the first bookable restaurant.

### Deferred items from the phase-3 ledger, done in the spike
- `lib/server/action-result.ts`:
  - imports `unstable_rethrow` from 'next/navigation' and calls it first in `actionError` (`01-app/03-api-reference/04-functions/unstable_rethrow.md`);
  - adds ActionCode `conflict`, with a Vietnamese message in lib/admin/auth-errors.ts.
  - The test fails without the fix. Under Vitest, `forbidden()` throws a plain Error unless `experimental.authInterrupts` is set, so the test builds `Object.assign(new Error(…), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' })` instead.
- `lib/server/client-ip.ts` `clientIp(headers)` (the first X-Forwarded-For entry, trimmed, or null) is now used by the DAL session and the accept-invite action.

### Error codes and copy
- `BOOKING_ERROR_CODES` gains `closed`, with registry key `error.closed`.
- `error.party_too_large` becomes `'Please choose between 1 and {max} guests.'` with `vars: ['max']`. The action passes `params: { max }`, and DEFAULT_PARAMS has `max: '12'`.

## 5. Tests that prove it (all in the patch)
- **`lib/booking/resolve-day.test.ts` (28 tests):**
  - seatings, isoWeekday, weekdays and inactive periods, sort order, overlap dedupe;
  - closures: whole day, inclusive range, all/destination/restaurant scope, single meal, all meals, hidden reason;
  - window, including the Da Nang midnight edge 16:59Z/17:00Z;
  - lead: 18:29 ok, 18:30 blocked, 18:30:59 blocked, lead 0, across midnight (lead 404 ok, 405 blocked);
  - cutoff: 16:59 ok, 17:00 → past, tomorrow unaffected;
  - capacity (left, never negative, full, full vs past), max_party 8/9, unavailable, resolveRange.
- **`test/integration/booking-seed.test.ts`:**
  - for every restaurant and every ISO weekday, the seeded `[meal,time,capacity]` list equals phase-1 `slotsFor × slotCapacity`;
  - more than 5000 slot verdicts (13 clock instants × today/tomorrow × parties 1/4/12) equal phase-1 `!unavailable()`;
  - the window agrees with `inWindow` on both sides of Da Nang midnight.
- **`test/integration/migration-006.test.ts` (17):**
  - on a DB with phase-1 rows: kept rows, legacy/is_test, meal backfill, search_text, created events, the seed shape, settings defaults and the single-row CHECK, booking on everywhere, the audit_feed columns unchanged, idempotent re-apply;
  - every constraint by name: status, guests, reserved_at, meal, source, locale FK, over_capacity, the trigger version bump, the dedupe index, period weekdays/order/grid/interval/meal, closure scope/dates/meals and i18n FK cascade, event staff actor/transition/created status/type, the note body check, pg_trgm and the GIN index;
  - a malformed old time aborts the migration and leaves nothing applied.
- **`test/integration/submit-reservation.test.ts` (14):**
  - Da Nang date, meal, source, locale fallback (vi disabled → en), auto_confirm global vs per-restaurant (with confirmed_at), codes;
  - field codes, max_party 8 blocks 9, booking off, closures (destination Dinner and all-day), lead and cutoff;
  - holding vs non-holding statuses;
  - **a 12-way race for the last 6 covers books exactly 3 parties (sum = 16);**
  - **deterministic cross-instance proof: a second pool holds the same advisory lock, fills the slot and commits; the guest request is still pending after 300 ms, then returns `full`, while another date books immediately;**
  - simultaneous identical requests → one `duplicate`;
  - reference retry (max 3).
- **`test/integration/availability.test.ts` (18):**
  - strip defaults, closure reason by locale (reviewed vi served; machine only with serve_machine; show_reason off), full/unavailable, per-restaurant window and maxParty;
  - day slots with `left`, lead blocks, too_large, **the editor's new dinner hours visible on the very next request**, a closed meal with its reason;
  - 400/404 cases, and a date outside the window → 200 `state:'outside'`.
- **`e2e/booking-rules.spec.ts` (3, next start):** an Editor saves Dinner (last seating 22:00, 20 covers) → the API shows 9 slots with left 20, and an audit row exists; affected list `FC-E2E00001 · <date> 21:30 · 2 khách · ngoài giờ mới`, with status still confirmed; booking switch off → `/en` payload `taya-house=false` and API days all `unavailable`.
- Unit tests: `lib/booking/slot-code.test.ts`, `lib/server/booking/input.test.ts` (16), `lib/server/booking/search-text.test.ts`, `lib/server/client-ip.test.ts`.
- `test/integration/audit-feed.test.ts`: `beforeEach` now `TRUNCATE ${STAFF_TABLES}, reservations CASCADE`, plus a union-ordering test.
- `test/helpers/db.ts`: optional `TEST_DB_TAG` renames `*_test` helper DBs, so parallel checkouts don't collide.
- Removed: `lib/server/check-reservation.ts` with its test, `test/integration/reservations.test.ts`, and `createReservation`/`bookedCovers`/`slotCapacity` in db/queries.ts. Their cases are ported.

## 6. Commands (exact, local-only)
```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_p4engine_test node scripts/reset-db.mjs
TEST_DB_TAG=p4engine TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_p4engine_test npm test
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_p4engine_test npm run build && node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= DATABASE_URL=postgres://localhost:5432/furama_cuisine_p4engine_test BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3220 EMAIL_DELIVERY=log EMAIL_LOG_FILE=<scratch>/p4engine-emails.ndjson E2E_PORT=3220 npx playwright test --retries=0
```

## 7. Errors hit

1. **zsh: `echo =====` printed '(eval):1: ===== not found'; `grep --include=*.ts` gave 'no matches found'.**
   - Cause: zsh expands a leading `=word` as a command path and treats unquoted globs as file patterns.
   - Fix: do not start an argument with '='; quote globs (`--include='*.ts'`).
2. **migration-006 test: expected 6 distinct statuses, got 5.**
   - Cause: a test bug. Phones were built from status.length, so 'requested' and 'confirmed' (both 9 letters) shared a phone. The dedupe index rejected the second insert and a `.catch` swallowed the error.
   - Fix: build phones from the loop index and remove the `.catch`.
3. **migration-006 test: interval_min 25 raised service_periods_grid instead of service_periods_interval_min_check.**
   - Cause: the 18:00–21:00 span (180 min) is not a multiple of 25, so the grid CHECK fired first.
   - Fix: use last_seating 20:30 (150 = 6×25) so only the interval CHECK can fail.
4. **The seed mutation check passed although I had changed service_periods in the DB.**
   - Cause: test/global-setup.ts re-runs reset-db.mjs on TEST_DATABASE_URL at the start of every vitest run, wiping the manual UPDATE.
   - Fix: mutated the seed VALUES in 006_booking_v2.sql instead; 3 mutations each caused 1–2 failures, then I restored the file.
5. **The two-pool statistical race test still passed with the advisory lock removed when it ran after the 12-way race test (5 successes, no overbooking); alone it overbooked (9–10).**
   - Cause: timing. The transactions from the two pools did not overlap in that order, so the race never happened.
   - Fix: replaced it with a deterministic test. A second pool holds the same pg_advisory_xact_lock; the action must still be pending after 300 ms; the holder fills the slot and commits; the action returns 'full'. Without the lock it fails in every run.
6. **audit-feed.test.ts: 2 failures (extra rows, wrong paging) after migration 006.**
   - Cause: audit_feed now UNIONs reservation_events, and earlier test files leave reservations and events behind.
   - Fix: beforeEach now runs `TRUNCATE ${STAFF_TABLES}, reservations CASCADE`; added a union-ordering test.
7. **actionError rethrow test: forbidden() was reported as db_error.**
   - Cause: outside a Next build with experimental.authInterrupts, forbidden() throws a plain Error ('`forbidden()` is experimental…'), not the NEXT_HTTP_ERROR_FALLBACK;403 digest error.
   - Fix: the test builds the forbidden interrupt as `Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;403'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;403' })`; redirect() and notFound() are real.
8. **E2E: the 'Đã lưu' status was not found after saving Dinner, although the audit row showed the save committed.**
   - Cause: the page keyed PeriodForm with `${p.id}-${p.updated_at}`. updateTag in the Server Action re-renders the page, the key changes, the form remounts, and the useActionState result is lost.
   - Fix: `key={p.id}`; the hidden expectedUpdatedAt input still refreshes from props.
9. **Full E2E on the deliverable: 11–12 guest UI tests failed (navigation, page-scope, filters, smoke, routing) with 30 s timeouts.**
   - Cause: the phase-1 SiteProvider reads `data.booked[time]` from /api/availability; the v2 day response has no `booked`. Browser console: 'TypeError: Cannot read properties of undefined (reading '11:30')' → page_render_failed.
   - Fix: not fixed in the spike, since the guest form is out of scope. Proven to be the only cause: with temporary v1 fields (booked, capacity), 74/75 pass, and the 1 failure is the known page-scope flake (21/21 on repeat). The plan must migrate the guest client in the same task as API v2, or keep those two fields temporarily.
10. **Dropping DBs: `for d in $DBS` passed all names as one identifier (NOTICE: identifier … will be truncated).**
    - Cause: zsh does not word-split unquoted parameter expansions.
    - Fix: `psql … | while read -r d; do DROP DATABASE "$d"; done`.
11. **console.log probe output did not appear in a quick Vitest probe.**
    - Cause: the grep pattern did not match Vitest's stdout framing for that run.
    - Fix: used process.stdout.write with a PROBE prefix.

## 8. Package versions

- No npm packages installed or changed in the clone.
- next 16.3.7 (cacheComponents + partialPrefetching on)
- react 19.3.0
- typescript 7.0.2
- pg 8.23.0
- zod 4.6.5 (z.union of z.literal, .pipe, safeParse issues path)
- better-auth 1.7.7
- vitest 5.0.3
- @playwright/test 1.63.0
- oxlint 1.86.0 (20 warnings baseline kept)
- oxc-parser 0.152.0 (guard test passes with the new admin actions)
- Node 22.22.0
- PostgreSQL 18.3 local (Homebrew); pg_trgm 1.6 available locally (also btree_gist 1.8, unaccent 1.1)
- Neon Postgres 18 pg_trgm availability: not verified (no Neon access by rule)

## 9. Recommended task breakdown (spike author)

Phase 4 plan, in dependency order. Each task keeps the gate green.

**T0: Deferred ledger items.** Call unstable_rethrow in actionError (with its test), extract clientIp(), and add ActionCode 'conflict' with its Vietnamese copy. Optionally add the TEST_DB_TAG helper.

**T1: Migration 006.** Use the full SQL in §2. Add test/integration/migration-006.test.ts, renaming the helper DB to furama_cuisine_migrate006_test. Fix audit-feed.test.ts isolation and add the union test. Before applying to Neon, run a read-only pre-flight: `SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name='pg_trgm'`, plus count(*) and malformed reserved_at.

**T2: Pure engine.** Add isoWeekday and fromMinutes to venue-time. Add lib/booking/{rules,resolve-day,slot-code,api}.ts with resolve-day.test.ts and slot-code.test.ts (TDD; the boundary mutations listed in §0 are the RED cases). Add test/integration/booking-seed.test.ts, which proves the seed matches phase 1.

**T3: Server rules and the write path.**
- Add lib/server/booking/{rules,input,search-text,create}.ts and switch submitReservation to v2.
- Add error.closed, and give error.party_too_large `{max}` and params.
- Delete lib/server/check-reservation.ts with its test, the createReservation/bookedCovers/slotCapacity queries, and test/integration/reservations.test.ts.
- Port the integration tests, including the 12-way race and the deterministic lock-holder test.
- Prove RED by removing lockBookingDay.

**T4: Availability API v2 and the guest form, in ONE task, or T4a with the transitional `booked`+`capacity` fields followed by T4b.**
- SiteProvider, BookingBar and ReserveDrawer use server periods and day states, grey out closed days with their reason, cap the stepper at maxParty, and say 'call for larger groups'.
- Filter out restaurants with bookingEnabled=false and hide RESERVE for them.
- Update the e2e/booking-dates.spec.ts and e2e/visual.spec.ts mocks to the v2 shape. Keep the visual baselines unchanged: never --update-snapshots.

**T5: Lifecycle.**
- One TypeScript TRANSITIONS map that also holds the time windows: seated from 60 min before, no_show from 15 min after, corrections on the same service day.
- transitionReservation: `UPDATE … WHERE id=$1 AND version=$2 AND status = ANY($from)` (the trigger bumps version), plus a reservation_events row. Zero rows → 'conflict' with "Vừa được {người} thay đổi".
- Staff create (phone → confirmed, walk_in → seated) and date/time/guest edits take lockBookingDay. over_capacity requires a reason, recorded on the created event.
- Unit table tests plus integration tests.

**T6: Admin reservation screens.** Inbox with keyset paging on reservations_inbox_idx, tabs (Cần xử lý/Hôm nay/Sắp tới/Tất cả), and trigram search over search_text. Detail page with transitions, notes and timeline. New-booking page. Day sheet with a print stylesheet. Closures with closure_i18n, plus an affected list across every restaurant in scope and a bulk "Hủy và báo khách" that never auto-cancels. Add the nav entries.

**T7: /admin/restaurants/[id]/booking ("Giờ và sức chứa") and /admin/settings/booking (Admin).**
- Period CRUD with the overlap check on insert as well as update, the updated_at conflict check, and slot preview via planDay.
- Per-restaurant overrides (the auto_confirm field only for Admin, server-checked with the reservations:auto-confirm permission). The booking switch.
- updateTag('restaurants') and updateTag('booking-rules:<id>') on every save.
- Acceptance E2E: an Editor changes dinner → the guest sees it; max_party 8 blocks 9 guests in the form; closed day greyed; confirm/cancel/no-show; affected list.

**T8: /admin/audit keyset paging** on (at, source, lpad(id)) and the email label for the staff_invitation entity (ledger).

## 10. Risks and open questions

- pg_trgm on Neon PG18 is unverified (Neon access forbidden). CREATE EXTENSION needs the neon_superuser role, which Neon's default role has. Run a read-only pg_available_extensions pre-flight before applying 006; if it fails, the whole migration rolls back (one transaction).
- Advisory xact lock through Neon's pooled (PgBouncer transaction-mode) URL is unverified. Transaction-scoped locks are the compatible kind; spec §13/§16 asks for one check on a Neon branch.
- 'use cache' for booking rules: no benefit on serverless (use-cache.md:247-252) and revalidation is local per instance by default (how-revalidation-works.md), hence live reads. How Vercel's handler propagates updateTag across instances was not measured.
- The API v2 shape breaks the phase-1 guest client (12 E2E failures). The guest form must change in the same task, or ship temporarily with `booked`/`capacity`. The e2e/booking-dates.spec.ts and e2e/visual.spec.ts mocks still use the v1 shape.
- Every staff write that takes covers (staff create, date/time/guest edits, no_show→seated) must call lockBookingDay(client, restaurant, date) inside its transaction; a date move must lock both dates in a fixed order to avoid deadlock.
- The one-service-per-time rule lives only in app code (updatePeriod). Period INSERT must check it too; a DB exclusion constraint would need a custom time range type plus btree_gist.
- listAffectedReservations is per restaurant. Closures scoped to 'all' or a destination must loop over every restaurant in scope.
- lock_timeout 5s → 55P03 is thrown → the guest sees error.network. Should it map to a code instead?
- Same-day cutoff is global only (no per-restaurant override in the spec): confirm.
- closures.show_reason defaults to true: confirm.
- reservations.locale FK is NO ACTION, so a locale with bookings cannot be deleted, only disabled (phase 8 must know).
- is_test legacy rows still count toward capacity (Neon has 0 reservations, so moot there).
- The legacy search_text backfill is lower() only, not accent-folded (SQL has no fold); new rows use JS fold().
- error.party_too_large lacks the restaurant phone the spec mentions (restaurants.phone_e164 arrives in phase 6; destinations.phone_display could stand in).
- The booking-rules:<id> tag currently tags no cached reader; keep calling updateTag per spec, and tag any future cached reader that embeds rule data.
- Restaurants created later (phase 6) have no periods, so they are 'closed' every day until periods are added; the admin create flow should seed a default.
- Periods cannot cross midnight (last_seating >= first_seating CHECK).
- offer_id is bigint; phase 6's offers.id must match for the FK.
- The reservations_touch trigger owns version and updated_at: app SQL must never set version itself (doing so would bump it twice).
- The phase-1 client helpers in lib/booking.ts (SLOTS, slotsFor, MAX_GUESTS, BOOKING_WINDOW_DAYS, LEAD_MINUTES) remain until the guest form rewrite; phase 10 removes them with restaurants.slot_capacity and meals.
- TEST_DB_TAG is optional: without it, parallel checkouts on one Postgres collide on the furama_cuisine_migrate*_test names.

## 11. Spec deviations (spike author)

- /api/availability returns `now` (an ISO instant) instead of `nowMinutes`: the phase-1 decision noted in spec §10.2.
- The day states are named by the spike: open | full | past | closed | too_large | outside | unavailable. Slot blocks are closed | lead | cutoff | party | full. Slots carry `left`, `bookable` and an optional `block`.
- Unknown restaurant → 404 (phase 1 returned 200 with capacity 0). A date outside the window on the day endpoint → 200 with state 'outside' (phase 1 returned 400). from/to ranges are capped at 92 days.
- Lead rule: a slot is bookable iff minutesUntil > lead_minutes on the minute-truncated Da Nang clock. This equals spec 'còn ít nhất lead_minutes' under truncation and phase-1 behaviour.
- Same-day cutoff (now ≥ cutoff minute) maps to error code 'past' (the spec table has no dedicated code).
- Added error code 'closed' with registry key error.closed (it is in the spec table, but phase 1 lacked it). error.party_too_large now uses {max} (vars ['max']), and the action returns params {max}.
- Booking rules are read live (uncached) by both the API and the action. updateTag('restaurants') and updateTag('booking-rules:<id>') are still called on save.
- Capacity is counted per (restaurant, date, reserved_at). Overlapping active periods on shared weekdays are rejected on save; the engine deduplicates a shared time, first by sort order.
- Seed sort_order: Breakfast 10, Lunch 20, Drinks 30, Dinner 40. Seed weekdays: all 7.
- reservations.source has no default (each insert names it). Phase-1 rows become source 'legacy' and is_test=true, and get a 'created' event from actor_kind 'system'.
- version and updated_at are maintained by a BEFORE UPDATE trigger (reservations_touch). The spec's `WHERE version=$2` still applies.
- reservation_events.type is one of created | status_changed | edited | note_added; phase 5 can widen the CHECK for email events.
- audit_feed keeps the phase-3 columns exactly. Reservation rows use source 'reservation', action 'reservation.<type>', entity_type 'reservation', before {status}, and after {status, reason, …changes}.
- restaurants.updated_at and updated_by are added in 006 (also in the phase-6 list; IF NOT EXISTS).
- CHECK bounds chosen by the spike: window_days 1–90, lead_minutes 0–1440, max_party 1–50, covers_per_slot 0–1000, interval_min ∈ {15,20,30,45,60,90,120}, last_seating on the interval grid, closure public_reason ≤160, notes ≤2000.
- closures.show_reason defaults to true. closure_i18n mirrors content_strings' translation columns; serving uses reviewed rows, or machine rows when serve_machine is on, falling back to the default locale.
- SET LOCAL lock_timeout='5s' before the advisory lock (not in the spec).
- submitReservation takes `unknown` (zod) and also returns data.status. Phase-1 checkReservation and the createReservation/bookedCovers/slotCapacity queries are removed.
- The admin booking page in the spike is a minimal stand-in: no nav entry, preview, overrides, auto_confirm field or period create/delete.
