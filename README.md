# Furama Cuisine

Implementation of the `Furama Cuisine.dc.html` design canvas as a Next.js app,
with reservations persisted in Neon Postgres.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + TypeScript
- **Neon Postgres** via the Vercel Marketplace, reached with `pg` (node-postgres)
  on Fluid Compute per Neon's own guidance
- **Better Auth** for staff sign-in (invitation only, Admin and Editor roles)
  and **SMTP** (nodemailer) with react-email for every email, booking emails
  through an outbox sent after commit and by a Vercel Cron
- **Vercel BotID**, a honeypot and a per-phone limit in front of the public
  booking action
- Plain CSS with design tokens — the design is built on fluid `clamp()` values
  throughout, so the tokens mirror them directly rather than round-tripping
  through a utility framework

## Getting started

```bash
npm install
npm run dev
```

`.env.local` must point at the Neon **`dev`** branch: `DATABASE_URL` holds the
pooled string and `DATABASE_URL_UNPOOLED` the direct one. Do not run
`vercel env pull .env.local`. The shared Vercel variables point at production
data and would overwrite those lines.

Apply migrations to the dev branch with `npm run db:migrate`.

The admin (`/admin`) also needs `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL=http://localhost:3000` in `.env.local`; leave
`EMAIL_DELIVERY` unset there (log mode: invitation and reset links are
printed to the terminal). Create your Admin with `scripts/create-admin.mjs`
(see Deploying → First Admin).

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests (Vitest, process timezone pinned to UTC) |
| `TEST_DATABASE_URL=postgres://localhost:5432/furama_cuisine_test npm test` | Unit and integration tests. The database is dropped and recreated on every run, and its name must end in `_test`. |
| `npm run test:e2e` | Playwright against `next start` on port 3100 (or `E2E_PORT`). Set `CI`, a local `_test` `DATABASE_URL`, `EMAIL_DELIVERY=log`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:<port>`, `EMAIL_LOG_FILE` and `CRON_SECRET` (variables below), and blank the keys `.env.local` may carry, as the commands below do, or set `E2E_BASE_URL` for a server you started; otherwise it refuses to run, because `next dev` and `next start` read `.env.local`. Run `npx playwright install chromium` once first. |
| `npm run test:visual` | Pixel-exact screenshots of the home and Tàya House pages, with and without JavaScript, against `e2e/__visual__/` (macOS baselines from before phase 2; CI skips them). Needs a running `next start`, see below. |
| `npm run lint` | oxlint (typescript-eslint does not support TypeScript 7) |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit, integration,
build, the prerender and font check (`scripts/check-prerender.mjs`) and
end-to-end tests against a Postgres 18 service container. The build needs no
auth or email variable; the end-to-end step gets a fresh `BETTER_AUTH_SECRET`
and `CRON_SECRET` per run, `EMAIL_DELIVERY=log` and an `EMAIL_LOG_FILE` the
specs read invitation and reset links and booking emails from.

To run the production build locally against a throwaway database, keep
`.env.local` out of it: process variables win over that file, even blank
ones, and the blank `PG*` variables stop Next from handing its user and
password to `pg`. The other blanks are there because `.env.local` may carry
pulled Vercel values: a pulled `VERCEL_ENV=production` would make a local
server treat log mode as a deployment (no `EMAIL_LOG_FILE`, invitations
unsent, outbox rows stamped `production`) and, with `NEXT_PUBLIC_VERCEL_ENV`
in the build, call the real BotID API.

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test node scripts/reset-db.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= \
  EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= \
  DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test npm run build
node scripts/check-prerender.mjs
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= \
  EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= \
  DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson CRON_SECRET=$(openssl rand -hex 16) npm run test:e2e
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= \
  EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS= \
  DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3201 EMAIL_DELIVERY=log npx next start -p 3201 &
for i in $(seq 1 60); do curl -s -o /dev/null http://localhost:3201/ && break; sleep 1; done
VISUAL_BASE_URL=http://localhost:3201 npm run test:visual
kill %1   # stop the server (or: lsof -ti tcp:3201 | xargs kill)
```

Playwright runs two projects. `desktop` holds every spec file, in parallel
workers; `desktop-serial` holds the `*.serial.spec.ts` files and runs after
`desktop` has finished (`dependencies`), one file at a time (`workers: 1`),
because they change what every guest page reads (a restaurant's
online-booking switch, the shared inbox, a restaurant's page, an offer's
dates). Each puts the data back through the same kind of save (or the daily
cron), which expires the same cache tags, never with a bare SQL update.
Running one serial file also runs the whole `desktop` project first; add
`--project=desktop-serial --no-deps` to run it alone. Spec files run at the same time, so each one books
its own restaurant and dates, and puts back the rules it changes:

| Spec | Restaurant | Dates or rules |
| --- | --- | --- |
| `booking-v2` | Tàya House, Don Cipriani’s, Steakhouse The Fan | the last open day; a closure at +9; `max_party` 8. The availability-error, retry and focus tests added since mock the availability API and write nothing |
| `admin-audit` | Tàya House | 2025-12-31 (a past, confirmed booking), plus `audit_log` rows dated 2001, which it deletes afterwards |
| `admin-reservations` | Tàya House, V-Senses Cafe, ChaoShan Hotpot, Café Indochine | +3, +4, +6 (one booking at 23:30, outside the hours), yesterday (confirmed bookings: one marked no-show, one with an email that Enter in “Lý do” must leave alone, one with an email cancelled after its sitting); +8; +7; +6 (picked from The Fan at +5, where nothing is written; a phone booking with an email, confirmed to the guest) |
| `admin-booking-config` | Thai Siam Kitchen, Hura Izakaya | dinner hours and covers (+2, +3), `max_party` and `window_days` overrides (back to NULL); `max_party` 8 |
| `admin-booking-settings` | Danaksara | `auto_confirm`; the last open day |
| `admin-closures` | Phố Cuốn; the MM Supercenter (Yum Food Village, ChaoShan Hotpot) | +5; a destination closure at +11; closure edits at +60 and +61; Phố Cuốn +62 (the bulk cancel that emails guests: three bookings, two with an email, and a closure it deletes afterwards); Phố Cuốn +63 (two bookings with an email under a closure it deletes afterwards; one is moved to yesterday while the list is open) |
| `booking-acceptance` | Yum Food Village | +3, +4, +12, +13, yesterday; dinner hours, covers and `max_party` |
| `booking-switch.serial` | Tàya House, Hải Vân Lounge, Yum Food Village; then all twelve | online booking off, then on again |
| `shared-inbox.serial` | — | the shared inbox (`site_settings.email`), then `fb@furamavietnam.com` again |
| `restaurant-pages.serial` | Steakhouse The Fan | its page on (portrait, copy, two highlights), then off; its booking rules saved unchanged |
| `offers-expiry.serial` | Hải Vân Lounge | offer 3's `valid_until` set to yesterday, then NULL again, each time with the daily cron |
| `booking-email` | Café Indochine, Tàya House | the last open day (a guest booking: its staff email goes to the shared inbox); +3 (`seedReservation()`: a booking to confirm, and a confirmed one with an email row due for its second attempt) |
| `admin-emails` | Hải Vân Lounge, Hura Izakaya | +40 (failed emails written straight into `email_outbox`); yesterday (a failed email whose sitting has passed); a restaurant recipient under a fresh address, deleted afterwards |
| `guest-guard` | Phố Cuốn | today + 13 (three web requests seeded for a fresh number); the other tests book nothing, and the header-contrast tests write nothing |

The other specs write no booking, closure or rule (the guest specs that
submit mock the availability API and abort the Server Action POST, or are
refused before anything is written). No spec that runs beside the others may
add a notification recipient for `all` or a destination: it would take
`booking-email`'s staff email away from the shared inbox. Keep such cases in
the integration tests or a `*.serial.spec.ts`.
Before the tests that count covers, `admin-reservations.spec.ts` empties the
days it owns (Tàya House +4 and +6, ChaoShan Hotpot +7), so it passes again
on a database it has already run on; never book those days from another spec.

`booking-acceptance.spec.ts` checks every phase-4 acceptance criterion of the
spec (§14.1 row 4) through the screens. Its tests share Yum Food Village's
rules and run in order, so never run that file with `--repeat-each`.
`booking-email.spec.ts` checks phase 5's (§14.1 row 5): a new booking emails
staff (A1), confirming emails the guest (A2), a failed email is retried by
the cron (A3), and with no recipient the staff email goes to the shared inbox
(A4); bots are blocked (A5) in `guest-guard.spec.ts`, the integration tests
and the BotID run below.
`restaurant-pages.serial.spec.ts` checks phase 6's (§14.1 row 6): switching
`has_detail_page` on for Steakhouse The Fan opens a working page, read from
the database, after one admin save, and switching it off closes it again.
The other half, "the site is identical", is the visual baselines: they have
not changed since before phase 2, and every page they shoot now reads the
database (a changed row turns them red).

`e2e/botid.spec.ts` walks BotID's blocked path. Off Vercel nobody can judge a
request, so it is skipped unless the server runs with `BOTID_DEV_BYPASS=BAD-BOT`
(BotID's own development bypass then calls every caller a bot), and every
booking on that server is refused, so it runs on its own, after the main run:

```bash
CI=1 PGHOST= PGUSER= PGPASSWORD= PGDATABASE= VERCEL_ENV= NEXT_PUBLIC_VERCEL_ENV= VERCEL_OIDC_TOKEN= \
  EMAIL_FROM= EMAIL_REDIRECT_TO= SMTP_HOST= SMTP_USER= SMTP_PASSWORD= BOTID_DEV_BYPASS=BAD-BOT \
  DATABASE_URL=postgres://localhost:5432/furama_cuisine_e2e_test \
  BETTER_AUTH_SECRET=$(openssl rand -base64 32) BETTER_AUTH_URL=http://localhost:3100 \
  EMAIL_DELIVERY=log EMAIL_LOG_FILE=$TMPDIR/emails.ndjson CRON_SECRET=$(openssl rand -hex 16) \
  npx playwright test e2e/botid.spec.ts --project=desktop
```

CI does not run it; `lib/server/guard/bot.test.ts`, `lib/botid.test.ts` (the
real BotID fetch wrapper) and the integration test cover the same path.

`E2E_BASE_URL=http://localhost:<port>` points the main Playwright suite at a
server you started yourself (for example `next dev` with the same variables)
instead of starting one. The admin specs still write their staff accounts
(with known passwords) straight into `DATABASE_URL`, so `e2e/staff-fixtures.ts`
refuses anything but a local database named `*_test` or `*_ci`, whichever way
Playwright runs. Never update the visual baselines to make a run
pass: open `test-results/**/*-diff.png` and fix the page.

## Deploying

Migrations are applied by hand with `scripts/migrate.mjs` against the target
environment's direct (unpooled) connection string. Nothing applies them
automatically.

Migration 003 (`phone_e164 NOT NULL` plus `reservations_dedupe_v2_idx`) and the
code that writes `phone_e164` must ship together: apply 003 to an environment
immediately before (or together with) its first deploy of this branch. Before
003 the new code fails on the missing column; after 003 the old code fails on
`NOT NULL`. The site has never been deployed, so there is no live traffic to
break today.

Migration 004 (`locales`, `content_strings`, `destinations` and the
`restaurants_destination_fk` constraint) must be on an environment's Neon
branch **before** that environment builds the phase-2 code: `next build`
reads the `locales` table (the guest layout's `generateStaticParams`) and
prerenders `/en` from the database, so a build against a branch without 004
fails. A failed build is safe (the previous deployment stays live), but
migrate first: apply 004 to a preview branch before its first phase-2
preview, and to production right before the production deploy, with the
`node scripts/migrate.mjs` command below. 004 only adds tables and a
constraint the current data already satisfies, so the code from before
phase 2 keeps working on a migrated database. Check
`SELECT DISTINCT destination FROM restaurants` on the target branch first:
every value must exist in `destinations`, or the constraint fails.

Neon preview branches fork from production, so a branch forked before a
migration reached production lacks it. Run `node scripts/migrate.mjs`
against that preview branch (with `DATABASE_URL_UNPOOLED` set to it) before
the preview builds: `next build` reads what 004 and 006 add (004's `locales`
table, 006's `restaurants.booking_enabled` and `service_periods`) and fails
without it. If the branch only appears with the deployment, such a build
fails (safely, as above); migrate the branch, then redeploy.

Production: never run `npm run db:migrate` (it reads `.env.local`, which must
point at dev). Run
`DATABASE_URL_UNPOOLED=<production direct URL> node scripts/migrate.mjs`
deliberately, after the dev branch has been migrated and verified.

Migration 005 (the `staff_*` tables, `auth_rate_limit`, `staff_invitation`,
`audit_log` and the `audit_feed` view) must be on an environment's Neon
branch before that environment runs the phase-3 code: Better Auth checks its
tables when it starts (`database.validateSchema`) and every admin page reads
them. 005 only adds tables, so the guest site keeps working on a migrated
database. Apply it with `node scripts/migrate.mjs` like the others.

### Migration 006 (phase 4: booking v2)

`006_booking_v2.sql` adds `booking_settings`, the restaurants' booking
switch and overrides, `service_periods` (seeded to behave exactly as before:
the old slots of each restaurant's meals, `slot_capacity` covers each),
`closures` and `closure_i18n`, the v2 columns of `reservations`,
`reservation_events`, `reservation_notes` and the `pg_trgm` search index, and
it redefines `audit_feed` to show booking events. It only adds, but code on
either side of it breaks on the wrong database:

- 006 must be on an environment's Neon branch **before that environment
  builds** the phase-4 code. `next build` prerenders `/en`, whose layout reads
  the catalogue (then `db/queries.ts#listRestaurants`, since phase 6
  `lib/server/content/restaurants.queries.ts#loadRestaurants`:
  `restaurants.booking_enabled` and the active `service_periods`), so a build
  against a 005 database stops at `/en` with `column r.booking_enabled does
  not exist`.
- The phase-3 code cannot write a booking on a 006 database: its INSERT names
  neither `meal` (now NOT NULL) nor `source` (no default).

So apply 006 to each environment right before its first phase-4 build (for
production, right before the production deploy), and apply it to any preview
branch forked before 006 before that preview builds (see above). Until the
phase-4 deployment is live, the phase-3 one cannot take bookings, so keep
that gap short. The site has never been deployed, so no live traffic breaks
today.

006 must run after 005 (it replaces 005's `audit_feed` view and reads
`audit_log`, `locales` and `destinations`). `scripts/migrate.mjs` applies the
files in name order and skips the ones `_migrations` lists, so it runs 005
first if that is missing; never apply 006 by hand with `psql -f`. It runs in
one transaction: if any statement fails (for example `CREATE EXTENSION
pg_trgm`), nothing of it stays.

Before applying 006 to a Neon branch, run these read-only checks on that
branch (`npm run db:psql` reads `.env.local`, so open psql on the branch's own
URL instead):

```sql
-- 1. Exactly 001–005 applied, 006 not yet.
SELECT name FROM _migrations ORDER BY name;
-- 2. pg_trgm is installable: a row means the server has it (an empty result means 006 would roll back).
SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name = 'pg_trgm';
--    If installed_version is empty, 006's CREATE EXTENSION also needs CREATE on the database for the
--    role that migrates (pg_trgm is a trusted extension, so no superuser). Run this as the role of the
--    direct URL you migrate with: it must return t.
SELECT has_database_privilege(current_database(), 'CREATE');
-- 3. Every reserved_at is HH:MM (006 stops with a message otherwise; correct the rows first).
SELECT id, reserved_at FROM reservations WHERE reserved_at !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
-- 4. How many bookings become source 'legacy', is_test (they keep holding covers until purged).
SELECT count(*), min(created_at), max(created_at) FROM reservations;
-- 5. Every meal is one 006 knows (a restaurant with another would get no service period: closed every day).
SELECT id, meals FROM restaurants WHERE NOT meals <@ ARRAY['Breakfast', 'Lunch', 'Dinner', 'Drinks'];
-- 6. An override of these strings must keep the new {max}/{phone} (party_too_large) and read right for both causes (past).
SELECT key, locale, value FROM content_strings WHERE key IN ('error.party_too_large', 'error.past', 'error.closed');
```

Then apply it with `DATABASE_URL_UNPOOLED=<the branch's direct URL> node
scripts/migrate.mjs`, and check:

```sql
SELECT count(*) FROM service_periods;                        -- one per (restaurant, meal): 25 on the seed data
SELECT window_days, lead_minutes, same_day_cutoff, max_party, auto_confirm, guest_ack_email, pii_retention_months
  FROM booking_settings;                                     -- one row: 14, 30, NULL, 12, false, true, 24 (psql: 14 | 30 |  | 12 | f | t | 24)
SELECT count(*) FROM reservations WHERE meal IS NULL OR (search_text IS NULL AND anonymized_at IS NULL);  -- 0
SELECT source, is_test, count(*) FROM reservations GROUP BY 1, 2;
```

The booking-day lock (`pg_advisory_xact_lock` with `SET LOCAL lock_timeout`
inside a transaction, `lib/server/booking/lock.ts`) has only been tested on a
direct Postgres connection. The app uses Neon's **pooled** URL, so check it
once on a Neon branch before the first phase-4 deploy (spec §13). In two psql
sessions on that branch's pooled URL:

```sql
-- session 1
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
-- session 2: waits about 2 seconds, then fails with 55P03 (lock_timeout)
BEGIN;
SELECT set_config('lock_timeout', '2s', true);
SELECT pg_advisory_xact_lock(hashtextextended('booking:taya-house:2030-01-01', 0));
ROLLBACK;
-- session 1
COMMIT;
```

If session 2 does not wait, the pooler does not keep the transaction on one
server connection and two guests could both take the last covers: stop and
switch to the fallback of spec §16 (a lock row per restaurant and date,
`SELECT … FOR UPDATE`).

On the first preview after phase 4, check that a save under "Giờ và sức
chứa" reaches the guest pages: switch a restaurant's online booking off, then
open the home page a few times; every response should drop its RESERVE (the
catalogue is cached per instance and `updateTag('restaurants')` expires it).
Then switch it back on and check the same way that its RESERVE returns on
every response, so the check leaves no restaurant off.

**Never run `npx auth migrate`** (or `generate`) without
`--config scripts/auth-cli.config.ts`: the Better Auth CLI loads `.env` and
`.env.local` by itself, which point at the shared database. That config reads
`AUTH_CLI_DATABASE_URL`, refuses anything but a local database, and drops every
`PG*` variable the CLI copied from `.env.local` before it connects (blank them
in the shell too):

```bash
RESET_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test node scripts/reset-db.mjs
PGHOST= PGUSER= PGPASSWORD= PGDATABASE= AUTH_CLI_DATABASE_URL=postgres://localhost:5432/furama_cuisine_cli_test npx auth check --config scripts/auth-cli.config.ts
```

The staff tables' columns come from `lib/server/auth/config.ts`; change that
file, regenerate with `npx auth generate --config scripts/auth-cli.config.ts`
against an empty local database, and write the difference as a new migration.

### Migration 007 (phase 5: email and consent)

`007_email_and_consent.sql` adds `site_settings` (one row, the shared inbox
`email`, seeded `fb@furamavietnam.com`), `notification_recipients`,
`email_outbox`, and the pair `reservations.consent_version` /
`consented_at` with its CHECK. It only adds: the phase-4 code keeps working
on a 007 database, and `next build` reads none of it. The phase-5 code does
not work without it: a guest's submit writes `consent_version` and queues
`email_outbox` rows in its transaction, so every booking fails until 007 is
on that environment's branch. Unlike 004 and 006, a build without 007
succeeds, so nothing stops such a deployment going live with every booking
failing. Apply 007 to production before the first phase-5 deploy of any
kind. With Vercel's Git integration, pushing or merging `main` is the
Production deploy, and a push of any other branch deploys a Preview whose
Neon branch forks from production at that moment. A preview branch forked
before 007 reached production must be migrated before that preview is used.

`site_settings` is created early with one column (spec §5.2 lists it under
phase 6): phase 6 must add its other columns with `ALTER TABLE site_settings
ADD COLUMN IF NOT EXISTS …`, never `CREATE TABLE`.

Before applying 007 to a Neon branch, on that branch's own URL (read-only):

```sql
-- 1. Exactly 001–006 applied, 007 not yet.
SELECT name FROM _migrations ORDER BY name;
-- 2. None of 007's tables exists yet: three NULLs.
SELECT to_regclass('site_settings'), to_regclass('notification_recipients'), to_regclass('email_outbox');
-- 3. Postgres 13 or newer (the sender uses gen_random_uuid() for Message-IDs): t.
SELECT current_setting('server_version_num')::int >= 130000;
-- 4. The consent columns do not exist yet: no row.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'reservations' AND column_name IN ('consent_version', 'consented_at');
```

Then apply it with `DATABASE_URL_UNPOOLED=<the branch's direct URL> node
scripts/migrate.mjs`, and check:

```sql
SELECT email FROM site_settings;                                       -- fb@furamavietnam.com
SELECT attgenerated FROM pg_attribute
 WHERE attrelid = 'email_outbox'::regclass AND attname = 'idempotency_key';  -- s (STORED)
SELECT count(*) FROM notification_recipients;                          -- 0 until the Admin adds them
SELECT conname FROM pg_constraint WHERE conname = 'reservations_consent_check';  -- one row
```

Until recipients are added, every new booking's staff email goes to the
shared inbox, and the overview lists the restaurants that do so.

### Migration 008 (phase 6: content)

`008_content.sql` moves the guest site's content into the database: `media`
(one row per file in `public/assets`, served from there), the translation
tables, `cuisines`, `restaurant_cuisines`, `restaurant_highlights`,
`sections`, `hero_slides`, `experiences`, `stories`, `offers`, `nav_items`,
`social_links`, the restaurants' content columns (`slug`, `destination_id`,
pictures, phone, map, `has_detail_page`, `is_published`, `archived_at`), the
rest of `site_settings`, and the foreign key of `reservations.offer_id`. It
seeds exactly what the site showed at the end of phase 5. It only adds (the
phase-1 columns `type`, `destination`, `cuisines`, `meals` and
`slot_capacity` stay, unread, until phase 10 drops them), in one transaction
that `migrate.mjs` sends as one query (about 80 ms on a local database).

**008 goes first, then the phase-6 deploy.** The phase-5 code was built and
tested on a 008 database (its E2E run and the visual baselines pass
unchanged), and the phase-6 code needs 008 to build: `next build` prerenders
the guest pages from its tables, so a build on a branch without it fails
(safely: the previous deployment stays live). Until it commits, 008 holds an
ACCESS EXCLUSIVE lock on `restaurants` and `site_settings` and a SHARE ROW
EXCLUSIVE lock on `reservations`, so new bookings wait for it: apply it in
the deploy window.

1. **Pre-flight**, read-only, on the target branch's own direct URL (not
   `npm run db:psql`, which reads `.env.local`):

   ```bash
   psql "<the branch's direct URL>" -v ON_ERROR_STOP=1 -f db/checks/preflight-008.sql
   ```

   Every row must say `ok` = `t`: 001–007 applied and 008 not; none of the
   20 tables 008 creates exists yet; no booking has an `offer_id` (008
   stops on one); every label in `restaurants.cuisines` is one of the 8
   cuisines (008 stops on another and names it; the row's `detail` lists
   the labels found); the 12 restaurants of 002, each with its
   `public/assets/r-<id>.jpg`; every restaurant has a type and a destination
   that exists; the 4 destinations of 004, none with a card picture yet; one
   `site_settings` row; `en` the default language; `gen_random_uuid()`
   available. Any `f`: stop and fix the data first (008 would roll back).
2. **Apply**, the dev branch first, then production, in the deploy window:
   `DATABASE_URL_UNPOOLED=<the branch's direct URL> node scripts/migrate.mjs`
   (it prints `✓ 008_content.sql`).
3. **Post-check**, read-only:
   `psql "<the branch's direct URL>" -v ON_ERROR_STOP=1 -f db/checks/postcheck-008.sql`.
   Every row `t`: the row counts; each restaurant's slug, destination, type
   label, cuisines and card picture equal to its phase-1 columns; only Tàya
   House has a page, with its portrait, story and 4 highlights; every
   destination's picture; the offer FK, and no booking linked to an offer
   yet; the settings (Tàya House, Dinner, 7 s slides); every seeded
   translation `en`, `reviewed`, `seed`; the sequences past the seeded ids.
4. **Deploy phase 6.** A preview branch forked before 008 reached production
   must be migrated (steps 1–3 on its URL) before its preview builds.
5. **Vercel:** after the production deploy, Settings → Cron Jobs lists
   `/api/cron/daily` at `5 17 * * *` (00:05 in Da Nang) beside the outbox
   cron. It uses the `CRON_SECRET` set for launch A and reads no database.
6. **First preview:** switch a restaurant's online booking off in "Giờ và
   sức chứa", then open the home page several times: every response drops
   its RESERVE (each instance caches the pages; `updateTag` must reach them
   all); switch it back on and check the same way. Do the same with "Hộp thư
   chung" and the footer's address. Open `/en/restaurants/<a made-up word>`:
   the site's "Page not found", with `noindex`. If the preview's Neon branch
   can be suspended, see what a guest gets right after a save while the
   database is unreachable (measured locally: a plain 500 on the home page
   and a restaurant page that never finishes loading), then resume it.
7. **Rollback:** leave 008 in place (the phase-5 code runs on it) and roll
   back the deployment only.

Confirmed by the owner (2026-10-03): the Dining House number prints as
"0859 555 759" and dials `+84859555759`, and the TikTok handle
`@furama.dining.hous` is correct (spec §15 item 14); both stay as seeded.

What the owner still gives for phase 6: whether the three offers end on 31
December 2026 (they are seeded without dates, so they show until someone sets
one; the phase-7 editor does it); the Experiences links and a film URL (spec
§15 item 16); for each further restaurant that should get a page, a 4:5
portrait, a kicker, an English story, 2–5 highlights with photos and an
optional menu PDF (spec §15 item 17). Until a page's content exists, its
`has_detail_page` stays off.

### Environment variables (admin)

| Variable | Production | Preview | Local E2E / CI |
| --- | --- | --- | --- |
| `BETTER_AUTH_SECRET` | its own, 32+ random bytes | its own | a fresh `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<production domain>`, the origin of emailed links (required outside log mode) | the preview's own URL | `http://localhost:<port>` |
| `EMAIL_DELIVERY` | `redirect` until go-live, then `live` (Production only: the sender refuses `live` on a Preview and under `vercel dev`) | `redirect` | `log` (also the default when unset) |
| `EMAIL_REDIRECT_TO` | the Admin's inbox, only while Production runs on redirect (before go-live) | the Admin's inbox, which receives every preview email | — |
| `EMAIL_FROM` | `Furama Cuisine <no-reply@…>`, an address the SMTP login may send as, and a mailbox someone reads (bounces land there) | same | unset (log mode) |
| `SMTP_HOST` | the provider's submission host | same | never set |
| `SMTP_PORT` | `587` (STARTTLS, the default) or `465` (TLS) | same | never set |
| `SMTP_SECURE` | only if the port rule does not fit: `true` (TLS from the first byte) or `false` (STARTTLS); unset means `true` on 465 only | same | never set |
| `SMTP_USER`, `SMTP_PASSWORD` | the login (both or neither) | a separate login if the provider allows | never set |
| `CRON_SECRET` | 16+ characters (`openssl rand -hex 32`); Vercel Cron sends it to `/api/cron/outbox`, and a missing or shorter one answers every call 401 | optional (crons run on Production only) | a fresh random value per E2E run |
| `BOTID_DEV_BYPASS` | **never** | **never** | only for the opt-in `e2e/botid.spec.ts` run (`BAD-BOT`); a deployment ignores it |
| `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` | set by Vercel | set by Vercel | never set: they turn on BotID and the deployment rules of the email gate |
| `EMAIL_LOG_FILE` | never | never | a scratch file; log mode appends each email as one JSON line |
| `BOOTSTRAP_ADMIN_EMAIL` | never (only in the shell that runs `scripts/create-admin.mjs`) | never | — |

`EMAIL_DELIVERY`, `EMAIL_FROM`, `EMAIL_REDIRECT_TO` and the `SMTP_*`
settings are read at send time by the running deployment, and `CRON_SECRET`
when the cron calls (`next build` needs none of them); Vercel applies a
change only to a new deployment, so redeploy after every change. An unknown
`EMAIL_DELIVERY` throws instead of sending, and so does `live` where
`VERCEL_ENV` is `preview` or `development`: a Preview runs on data forked
from production, so only redirect may send there.
`RESEND_API_KEY` is no longer read: remove it from every environment.

On a Vercel deployment (`VERCEL_ENV=production` or `preview`) the log mode
prints neither addresses nor links and writes no `EMAIL_LOG_FILE`, so the
email reached no one: the send fails with `not_delivered`, and the staff
screen says email is not set up on that environment instead of "Đã gửi lời
mời.".

### Email (SMTP)

Every email goes through one gate, `lib/server/email/send.ts` (spec §10.4),
and from there over a traditional SMTP account with nodemailer: port 587 with
a mandatory STARTTLS upgrade (the client refuses to go on in clear), or 465
with TLS from the first byte; TLS 1.2 or newer; each message on its own
connection; per-step timeouts and a 30-second cap on a whole send. Only
`lib/server/email/` may import nodemailer (a guard test checks it). Every
email carries `Auto-Submitted: auto-generated` (RFC 3834), so vacation
responders do not answer it.

- **Message-ID.** SMTP has no idempotency key. A staff email's Message-ID is
  made from its key (`<invite-<id>-<hash>@<EMAIL_FROM domain>>`, never the
  token), so a retry of the same send is recognisably the same message.
- **Errors.** A recipient refused for good (a 5xx at `RCPT TO` about the
  mailbox) is `rejected`; a refusal that blames the sender, a relay or the
  login (a `5.7.x` code, or such wording, which Postfix and Exim report at
  `RCPT TO`) is retried like any provider error, and the email log says to
  check `EMAIL_FROM` and the SMTP login. Anything else on the way (network,
  TLS, login, 4xx, a 5xx after the message such as a sending quota, a
  timeout) is `provider_error`.
  Addresses are removed from every stored error and log line, and the SMTP
  server's host and IP address from every stored error (Editors read them in
  the email log).
- **Redirect.** `EMAIL_DELIVERY=redirect` sends every email to
  `EMAIL_REDIRECT_TO`, with the real address in the subject and no Reply-To,
  so answering a redirected email reaches neither a guest of the forked data
  nor production's shared inbox.
- **Links.** Emailed links use `BETTER_AUTH_URL`. Without it, a live or
  redirected email, or any email on a Vercel deployment, fails with
  `missing_app_url` instead of carrying a localhost link.
- **Deliverability** (IT Furama): `EMAIL_FROM` must be an address the SMTP
  login may send as; SPF must include the provider, DKIM must sign for the
  From domain, and DMARC must align (check first whether the root domain
  already has a DMARC record; start at `p=none`). Until that is done keep
  `EMAIL_DELIVERY=redirect` (on a deployment, `log` sends nothing and every
  invitation is marked unsent).

A failed invitation email leaves the invitation in place and the staff screen
says "Chưa gửi được email, bấm Gửi lại" (or, for a setup problem such as
`not_delivered`, `missing_smtp_config` or `missing_app_url`, that email is not
set up on this environment; for an address the server refused, to check it,
revoke the invitation and invite again); a failed reset email is only
logged. Tests reach SMTP only through `test/helpers/smtp-sink.ts`, an
in-process server on `127.0.0.1`.

**Booking emails** (spec §10.3–10.4) go through an outbox:

- **Queued with the change.** A booking change that emails someone writes its
  `email_outbox` rows in its own transaction (`lib/server/email/outbox.ts`),
  one row per recipient: `staff.new` to the active recipients of the
  restaurant, its destination and "all" (deduplicated), or to the shared inbox
  (`site_settings.email`) when nobody matches; the guest's email in the
  booking's language. A failed email never fails the booking.
- **Sent after commit, at least once.** `after()` sends the new rows once the
  response is out (at most 10 rows or 25 s), and `GET /api/cron/outbox` runs
  every 5 minutes (`vercel.json`, Production only) for whatever is due. SMTP
  has no idempotency key, so a row is claimed with a 120-second lease and
  sent with a Message-ID fixed at its first claim
  (`<outbox-<id>.<12 hex>@<EMAIL_FROM domain>>`); if a function dies between
  the server's acceptance and the `sent` mark, the next run sends it again
  with the same Message-ID, and the recipient may get two identical copies.
- **Retries.** After a failure the row waits 1, 5, 15, 60, 360 and 720
  minutes (seven attempts within about 19.4 hours), then it is `failed`. A
  recipient refused for good (a 5xx at `RCPT TO` about the mailbox) fails at
  once; a refusal that blames the sender, a relay or the login is retried
  like any provider error. An enhanced code about the recipient's address
  (5.1.1, 5.1.2, 5.1.3, 5.1.4, 5.1.6, 5.1.10) decides first: Postfix's
  "5.1.1 … User unknown in relay recipient table" fails at once. The overview counts the failed emails and those
  retrying after a failure, only for bookings whose sitting is still ahead
  (the "Lỗi" tab lists every failed one). "Gửi lại" in
  `/admin/reservations/emails` puts a failed email back with a fresh
  schedule; it is not offered once the sitting has passed.
- **Skipped, not sent,** when the booking no longer matches the email (a
  confirmation for a booking cancelled meanwhile), was anonymised, the
  guest's address changed since it was queued, or its sitting has started; a
  staff email also when its recipient was removed or switched off, or (sent
  to the shared inbox) when that address changed. `last_error` says why, and
  the email log says it in Vietnamese. Staff are told the same: the notice
  after a status change promises a guest email only while the sitting is
  still ahead, and a bulk cancel lists a guest whose sitting has started
  among those to phone.
- **Environments.** Each row records its environment (`VERCEL_ENV`), and a
  sender only sends its own: a Preview never sends production's rows.

### Bot protection

The public booking action (`app/actions.ts#submitReservation`) refuses, in
this order and before anything is written: a filled honeypot (an off-screen
field no person sees), then a request Vercel BotID calls a bot (verified bots
included), with "We could not accept this request online. Please call us on
… to book."; then a request without the privacy consent; then, inside the
booking transaction, a fourth requested or confirmed web booking for one phone
number on one date, across all restaurants. BotID runs only on a Vercel
deployment (`VERCEL_ENV` production or preview): the browser half installs
from `instrumentation-client.ts` on guest pages, the server half asks Vercel,
and when Vercel cannot answer, or has not answered within 3 seconds, or its
API answers with an error instead of a verdict, the booking goes ahead and the
function log says `[botid] check failed, request let through` with `name`
`TimeoutError` (no verdict within 3 s), `BotIdError` (an error instead of a
verdict), or the name of the error BotID threw (for example `Error` when
OIDC is off, `TypeError` when its request to Vercel failed). The browser
waits at most 15 seconds for BotID's challenge; then the guest sees the copy
with the restaurant's number, and a new tap starts a fresh challenge. When
the deployment was built without `NEXT_PUBLIC_VERCEL_ENV`, BotID is skipped
altogether: bookings go through unchecked, with one `[botid] off …` warning
per server instance (`next.config.ts` inlines the variable into both halves,
empty when the build had none, so they always agree; `check-prerender.mjs`
fails a build where it was not). `next.config.ts` (`withBotId`) adds
rewrites under `/149e9513-01fa-4fb0-aad4-566afd725d1b/` to Vercel in every
build, the local one too: never request that prefix on a local `next start`.

### Before launch A: what the owner sets up

Email, the cron and BotID need these steps once, in this order. Until the
last one, keep Production on `EMAIL_DELIVERY=redirect`, and nothing reaches
a guest. Running Production on redirect also needs `EMAIL_REDIRECT_TO`,
`EMAIL_FROM` and `SMTP_*`. Redirect sends every email to that inbox, staff's
`staff.new` included, so restaurant staff get no new-booking email until
go-live: they must watch "Cần xử lý" in `/admin/reservations`. Until an SMTP
account exists, no email leaves a deployment, invitations included. After
any change to these variables (switching redirect → live, adding or fixing
`CRON_SECRET`), Deployments → … → Redeploy: Vercel applies a change only to
a new deployment.

1. **Migration 007, before any deploy:** apply 007 to production Neon, with
   the checks in "Migration 007" above, before the first phase-5 deploy,
   Preview or Production. With Vercel's Git integration, pushing or merging
   `main` is the Production deploy, so migrate before that merge. Unlike 004
   and 006, a build without 007 succeeds, and every booking then fails.
2. **Neon plan:** the 5-minute cron queries the production branch around the
   clock, so its compute never scales to zero: about 183 CU-hours a month at
   the 0.25 CU minimum, roughly $19 a month on Launch at $0.106 per CU-hour.
   Check the current prices on neon.tech/pricing. The Free plan's monthly
   compute allowance runs out partway through the month; Neon then suspends
   the compute, and bookings and the admin stop working. Before the first
   Production deploy, confirm in Vercel → Storage → Neon that the project is
   on Launch or higher. (Phase 9 adds a second 5-minute cron; nothing
   changes.) A quieter overnight schedule is a spec change (§10.4) that
   stalls retries; if the owner wants one anyway, Vercel cron times are UTC,
   so Vietnam 06:00–23:59 is `*/5 0-16,23 * * *`.
3. **Vercel project settings, before the first deploy:** turn on
   "Automatically expose System Environment Variables" and OIDC Federation,
   and keep Fluid Compute on (the default). BotID's browser half needs
   `NEXT_PUBLIC_VERCEL_ENV` at build and its server half the OIDC token; the
   variable is inlined at build, so a deploy built before the setting was on
   skips BotID (bookings let through, one `[botid] off …` warning per
   instance) until it is **redeployed**. Email needs the system variables
   too: the outbox and the email gate read `VERCEL_ENV`; without it a
   Production deployment counts as `development`, and the refusal of `live`
   on a Preview cannot work. The `after()` email sends (up to 25 s once the
   response is out) and the cron (`maxDuration` 300) assume Fluid Compute's
   300-second function limit. Decide on BotID's Deep Analysis (billed per
   check: read the current price on vercel.com/docs/botid); never set
   `BOTID_DEV_BYPASS`.
4. **SMTP account:** host, port 587 (STARTTLS) or 465 (TLS), username, and a
   password or app password. Microsoft announced that Exchange Online retires
   Basic authentication (username + password) for SMTP AUTH client
   submission during 2026, and this app logs in only with a username and
   password (no OAuth). Before choosing Microsoft 365, check Microsoft's
   current status (while it still works, the mailbox also needs
   "Authenticated SMTP" turned on), or use Google Workspace with an app
   password, or a transactional SMTP provider (SMTP relay with a username and
   password). Mind each provider's daily recipient limit.
5. **`EMAIL_FROM`:** for example `Furama Cuisine <no-reply@mail.furamavietnam.com>`,
   an address or alias the login may send as. It must also be a mailbox or
   alias someone reads (a `no-reply@` alias too): Microsoft 365 and Google
   accept a mistyped guest address and bounce it later to the sender, so the
   email log shows "Đã gửi" while the bounce lands in that mailbox.
6. **DNS at the mail provider (IT Furama):** SPF includes the provider, DKIM
   signs for the From domain, DMARC aligned (check the root domain first;
   start at `p=none`).
7. **Vercel → Environment Variables, Production:** `EMAIL_DELIVERY=redirect`
   and `EMAIL_REDIRECT_TO=<the Admin's inbox>` until go-live (step 13),
   `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
   (`SMTP_SECURE` only if the port rule does not fit), `CRON_SECRET`
   (`openssl rand -hex 32`), `BETTER_AUTH_URL` = the production origin.
8. **Preview:** `EMAIL_DELIVERY=redirect`, `EMAIL_REDIRECT_TO=<the Admin's
   inbox>`, `EMAIL_FROM`, `SMTP_*` (a separate login if possible), and
   `BETTER_AUTH_URL=<the preview's branch URL>` (set for that Git branch, and
   open the preview at that URL: every emailed link, from `staff.new`'s
   booking link to invitations and resets, needs it, and fails with
   `missing_app_url` without it). Preview branches fork production's staff
   and recipients, so redirect is mandatory there; a password reset on a
   Preview changes only that branch. Remove `RESEND_API_KEY` from every
   environment.
9. **First preview:** push a branch other than `main` and open its preview
   (pushed after step 1, its Neon branch forks with 007; a branch forked
   earlier must be migrated first). "Gửi email thử" in
   `/admin/settings/notifications` arrives at the redirect inbox (that proves
   port 587/465 is reachable from Vercel Functions, the login, and SPF/DKIM
   passing in the headers).
10. **First preview, same branch:** book a table from a browser: the staff
    and guest emails arrive (redirected). In the browser's network tab the
    booking's action POST carries an `x-is-human` header, and the function
    logs show none of `[botid] off`, `[botid] check failed` and `Possible
    misconfiguration`; the BotID traffic view shows the check. In
    `/admin/reservations/emails` the `staff.new` row is "Đã gửi", not
    `missing_app_url`; an invitation from `/admin/users` arrives at the
    redirect inbox with a link to the preview's origin, and the link opens
    the invitation. Then three BotID checks:
    - **A forged header is refused.** In the network tab, copy the booking's
      action POST as cURL, change its `x-is-human` header to `junk`, and run
      it in a terminal (not in the page's console: BotID's fetch wrapper
      there would put a real answer back). The answer contains `bot_blocked`,
      and the function logs show no `[botid] check failed` for it. If they
      do, BotID fails open for forged headers: tell the developer.
    - **A blocked challenge gives the phone number.** In DevTools → Network
      request blocking, block `/149e9513-01fa-4fb0-aad4-566afd725d1b/*`,
      reload the page, then tap REQUEST BOOKING twice. Within about 15 s the
      drawer shows the copy with the phone number, and the button works
      again. Unblock, tap again: the booking goes through.
    - **Autofill does not trip the honeypot.** On an iPhone (Safari) and an
      Android phone (Chrome), fill the form with the browser's autofill and
      book. Neither gets "We could not accept this request online".
11. **Production deploy and cron:** merge into `main` (Production starts on
    redirect). After that deploy, Project → Settings → Cron Jobs shows
    `/api/cron/outbox` every 5 minutes (Vercel Pro).
12. **Recipients:** in `/admin/settings/notifications`, add the notification
    emails per restaurant or destination (spec §15 item 15), and confirm
    `fb@furamavietnam.com` as the shared inbox (the fallback, and where
    guests' replies go).
13. **Production go-live:** give Production `EMAIL_DELIVERY=live` with only
    Production ticked (the dashboard ticks every environment by default, and
    the code refuses `live` on Preview and Development: its emails then fail
    with `invalid_delivery_mode`), remove Production's `EMAIL_REDIRECT_TO`
    (live ignores it), then Deployments → … → Redeploy. On the new
    deployment:
    - `/admin/settings/notifications` says "Chế độ gửi: thật (live)";
    - "Gửi email thử" to an outside inbox says "Đã gửi email thử tới …"
      (not "chuyển hướng tới hộp thư thử nghiệm"), and the email arrives
      there;
    - within 5 minutes, Vercel → Settings → Cron Jobs → `/api/cron/outbox`
      logs show 200, not 401;
    - a test booking made with an address you read: its `guest.ack` (or
      `guest.confirmed`, where the restaurant confirms automatically) reads
      "Đã gửi" in `/admin/reservations/emails` and arrives at that address.
      Cancel the booking afterwards.

Decisions the owner gives (the build's defaults in brackets): "Báo khách qua
email" on a cancel, also from a closure [on]; Vietnamese email for a booking
made in Vietnamese [yes]; guests' replies to the shared inbox and staff
replies to the guest [yes]; the per-phone limit [3 active web requests per
number per booking date]; BotID failing open and refusing verified bots [yes];
the privacy policy's wording and its Vietnamese text (a lawyer's review under
Law 91/2025/QH15, which must also confirm the anti-abuse clause: the count of
one phone number's online requests per day, and the bot check) [an English
draft]; which inbox Previews redirect to.

### First Admin

Staff accounts exist only by invitation (spec §7.1); the one exception is the
first Admin, created once per environment by `scripts/create-admin.mjs`. It
goes through the same invitation gate, which admits `BOOTSTRAP_ADMIN_EMAIL`
only while no Admin exists, so a second run is refused. The script reads no
`.env` file: give it the target environment's variables explicitly, and set
`BOOTSTRAP_ADMIN_*` in that one shell only, never in Vercel.

```bash
BOOTSTRAP_ADMIN_EMAIL=owner@furamavietnam.com BOOTSTRAP_ADMIN_NAME='Chủ quán' \
  npx dotenv -e <file with that branch's DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL> -- \
  node scripts/create-admin.mjs
```

It asks for the password (12–128 characters) unless `BOOTSTRAP_ADMIN_PASSWORD`
is set, and writes a `staff.bootstrap` row to `audit_log`.

Apply migration 005 to that database first; check the `Target database:` line
the script prints before you type the password; and never run it with
`.env.local` while that file points at the shared production database, unless
bootstrapping production is what you mean to do.

## Routes

| Route | Rendering | Notes |
| --- | --- | --- |
| `/` and other unprefixed paths | Proxy (`proxy.ts`) | 307 to `/<locale>…` by the `NEXT_LOCALE` cookie, then `Accept-Language`, then `en` (only `en` is enabled in phase 2); the query is kept |
| `/en` | Static, revalidated hourly (`cacheLife('hours')`, for today's offers) | Home: hero, finder, cuisines, restaurants, destinations, experiences, heritage, stories, offers, read from the database; a section switched off or with nothing to show is left out |
| `/en/restaurants/[slug]` | Static for each restaurant with `has_detail_page` at build time (`_none` when there is none), revalidated hourly (the layout reads today's offers for the nav); a page switched on later renders on its first visit. Any other slug is a 404: the first visit is a soft 404 (status 200 with `noindex`), later visits get the cached 404, and without JavaScript the body is empty | Restaurant detail, read from the database (`taya-house` today). The cached 404 carries `restaurants`, so a save that expires the catalogue opens a page that was just switched on |
| `/taya-house` | Redirect | 308 to `/en/restaurants/taya-house` (`next.config.ts`) |
| `/en/privacy` | Static, revalidated hourly (the layout reads today's offers for the nav), tag `content:legal` | The privacy policy (`legal.*`), linked from the footer and the reserve drawer's consent box |
| `/api/availability` | Dynamic, `no-store` | `?restaurant=&lang=[&from=&to=]`: each day's state (open, full, past, closed, too_large, outside) and public closure reason, with the clock, the party limit and the number to call; `?restaurant=&date=&lang=[&guests=]`: one day's services and slots with the covers left. 404 for an unknown restaurant or one with online booking off; a range given in full that is backwards or too long (400) and an id that cannot exist (404) are answered before any query. `scripts/check-prerender.mjs` fails if it is ever prerendered, or missing from the build |
| `/api/cron/outbox` | Dynamic, `no-store`, `maxDuration` 300 | Vercel Cron, every 5 minutes: sends the due outbox rows of its environment (at most 500 or 240 s) and answers only the counts. 401 without `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/daily` | Dynamic, `no-store`, `maxDuration` 60 | Vercel Cron, daily at 17:05 UTC (00:05 in Da Nang): `revalidateTag('content:offers', 'max')`, so the home page drops an offer past its `valid_until` and shows one whose `valid_from` has come. The first visit after it may still get yesterday's offers once; in exchange, a database that is down then cannot break the home page. 401 without `Authorization: Bearer $CRON_SECRET` |
| `/admin/sign-in`, `/admin/accept-invite`, `/admin/reset-password` | Request time, nonce CSP | The only admin pages open without a session cookie |
| `/admin`, `/admin/users`, `/admin/audit` | Request time, nonce CSP | Overview (with pending and today's bookings); staff and invitations (Admin); audit log of `audit_log` and booking events, paged with `?truoc=`/`?sau=` (Admin). Without a session cookie the proxy sends them to sign-in (307, `?next=` kept) |
| `/admin/reservations`, `/admin/reservations/[id]`, `/admin/reservations/day` | Request time, nonce CSP | Inbox (Cần xử lý · Hôm nay · Sắp tới · Tất cả, search by reference, phone, name or email: the search posts, its text waits 30 minutes in an httpOnly cookie and the URL carries only `?tim=<id>`); a booking (status changes, edit, internal notes, timeline, its emails); the printable day sheet. `reservations:read` |
| `/admin/reservations/emails` | Request time, nonce CSP | The email log of this environment (tabs by status, guest addresses masked) and "Gửi lại". `reservations:read`; "Gửi lại" `reservations:update` |
| `/admin/reservations/new` | Request time, nonce CSP | Phone bookings and walk-ins. `reservations:create` |
| `/admin/reservations/closures`, `/admin/restaurants`, `/admin/restaurants/[id]/booking` | Request time, nonce CSP | Closures with the bookings each covers; the restaurants; "Giờ và sức chứa" (switch, overrides, service periods, slot preview, affected bookings; auto-confirm for Admins). `schedule:read` |
| `/admin/settings/booking` | Request time, nonce CSP | Booking defaults. Admin (`settings:read`) |
| `/admin/settings/notifications` | Request time, nonce CSP | Who hears about new bookings, the shared inbox, the restaurants that fall back to it, "Gửi email thử". Admin (`settings:read`; every save `settings:update`) |
| `/api/auth/*` | Dynamic | Better Auth; `/api/auth/admin/*` is refused with 403 |

Every admin page renders at request time (`app/admin/layout.tsx`: `instant =
false` and `await connection()` before `<html>`), so each response carries the
nonce `proxy.ts` made for it. On `next start` and Vercel an admin page answers
200 even when it renders the sign-in redirect, the 403 view or the 404 view:
those arrive in the page payload, not the status.

The proxy skips `/api`, `/_next`, `/admin` (its own branch), any path with a dot
(files such as `/icon.svg`) and any unprefixed top-level segment of 2–3 letters,
which it reads as a locale. Such unknown top-level paths are not redirected; they
become cached 404s.

The design toggled between these two views with a `#taya-house` hash. They are
real routes here so each gets its own metadata and can be linked directly; the
brand curtain still plays over the swap via client-side navigation.

Guest pages live in `app/(site)/[lang]`. The root layout there reads no
database and never throws; `(guarded)/layout.tsx` checks the language
against the `locales` table and reads the catalogue and UI strings, so a
disabled language gets the site's 404 and a database error gets
`[lang]/error.tsx`, but only for request-time renders with JavaScript on.
An expired static route that fails to re-render, or a disabled-locale 404, gets
a plain 500 or an empty shell instead. Guest pages are cached: the
loaders with `cacheLife('max')` (30 days), today's offers with `'hours'`.
The header and the menu leave out an item whose section the home page
leaves out (no offer today, say), so the layout reads the home page's
lists (`getHomeContent`, `lib/server/content/home-content.ts`), and every
guest page revalidates hourly, expiring after a day. The hourly re-render
reuses the other loaders' cached (`'max'`) entries, so content edited
directly on Neon needs a redeploy (or a tag purge) to appear reliably; the
uncached booking action reads the database directly.
`lib/cache-tags.ts` names every tag of the CMS (spec §6.2), so no code spells
a tag by hand, and `lib/cache-plan.ts` says which tables each cached loader
reads and which tags it carries (`LOADERS`), and what a save to each table
expires (`SAVE_TAGS`, `tagsForSave`); `lib/cache-plan.test.ts` holds the two
together, and `scripts/check-prerender.mjs` checks each prerendered guest
page carries its loaders' tags. Every guest page checks the language again
before it reads (`requireEnabledLocale`): layouts and pages render in
parallel, and a path with a dot such as `/favicon.ico` reaches `[lang]`, so
without it a crawler's request would query the database as a language of its
own, and an error in the page would win over the layout's 404
(`test/guards/guest-pages.guard.test.ts` enforces it). Each page wraps its
content in `<ViewMarker>`: with Cache Components the router keeps the page
you left mounted but hidden, so page DOM is only queried inside the visible
page's `<main>` (`lib/page-scope.guard.test.ts` enforces it).

## Database

The restaurant catalogue is the database's job, not the code's — `restaurants`
is seeded by `db/migrations/002_seed_restaurants.sql` (and its content by
008) and read by `lib/server/content/restaurants.queries.ts#loadRestaurants`,
then handed to the client through `SiteProvider`. Editing the catalogue means
editing a migration until the phase-7 editors.

The rest of the guest site's content is in the database too since phase 6
(migration 008): `media` (every file in `public/assets`, served from there;
alt text per language in `media_i18n`, empty for a decorative file),
`sections` (the home page's fixed blocks: on or off, a picture, a link),
`cuisines`, `destinations` and `restaurants` with their `*_i18n` rows,
`restaurant_cuisines`, `restaurant_highlights`, `hero_slides`, `experiences`,
`stories`, `offers`, `nav_items`, `social_links` and `site_settings`. A
`*_i18n` row shows in its language when `reviewed` (or `machine`, where the
language serves machine translations), and a field it lacks falls back to
the default language's (`lib/server/content/sql.ts`). Phase 6 has no editor:
until phase 7, content changes are migrations. `lib/data.ts` holds code
only (the meal enum, phase 1's slots, the number the error pages print
without the database); `test/fixtures/phase5-content.ts` keeps what its
constants held, and `test/integration/content-seed.test.ts` checks the seed
against it. `db/checks/preflight-008.sql` and `postcheck-008.sql` are the
read-only checks of the 008 runbook (Deploying).

`locales`, `content_strings` and `destinations` (migration 004) are the
shared foundations of the CMS. Which UI strings exist is decided by
`lib/i18n/registry.ts`; `content_strings` only overrides or translates them,
and while it is empty the registry's English text is served. Guest pages
read through cached functions in `lib/server/content/` (`'use cache'`; the
loaders `cacheLife('max')`, the offers `'hours'`, so every guest page
revalidates hourly: the layout reads today's offers for the nav); their
uncached loaders (`*.queries.ts`) are what the integration tests exercise.

`reservations` records bookings (migration 006, phase 4). What a restaurant
offers comes from the database, never from the code: `service_periods` (the
weekly template: meal, weekdays, first and last seating, interval, covers per
slot), `closures` (a restaurant, a destination or all, inclusive dates, some
meals or the whole day, a public reason per language in `closure_i18n`) and
`booking_settings` with each restaurant's overrides and `booking_enabled`.
`lib/booking/resolve-day.ts` turns them into a day: `planDay` (the services
and slots) for staff screens, and `resolveDay` (plus the window, the lead
time, the same-day cut-off, the party limit and the covers held) for guests.
Nothing that reads them for booking is cached: the availability API, the
guest's submit and the staff screens read the database on every request.
The guest catalogue does derive each restaurant's `meals` (from its active
service periods) and `bookingEnabled` from them under `'use cache'`
(`lib/server/content/restaurants.ts`), and every save of the periods or of
the booking switch (`savePeriods`, `saveRules`) expires it with
`updateTag('restaurants')`.

Guarantees:

- every write that takes covers (a guest's submit, a staff booking, an edit
  that moves or grows a booking) takes one advisory lock per restaurant and
  date (`lib/server/booking/lock.ts`) and only then reads the rules and the
  covers, in the same transaction: concurrent requests for the last seats
  cannot both win
- a guest's submit first takes a lock per phone number and date, counts that
  number's requested and confirmed web bookings for the date (at most 3,
  across restaurants), and only then takes the booking-day lock; staff paths
  take the booking-day lock only, so the two never wait on each other in a
  circle
- a web booking stores the privacy policy version the guest agreed to and
  when (`consent_version`, `consented_at`)
- the emails a change sends are `email_outbox` rows written in the change's
  own transaction (see Email (SMTP))
- covers are held by `requested`, `confirmed` and `seated` bookings only
- a partial unique index (`reservations_dedupe_v2_idx`) rejects a second
  `requested` or `confirmed` booking at the same restaurant, date, time and
  phone (`phone_e164`)
- `version` (bumped by the `reservations_before_write` trigger on every
  update) makes a stale admin page a conflict that names who changed it
- every booking change is a `reservation_events` row (the timeline), never
  an `audit_log` row; configuration changes are `audit_log` rows; the
  `audit_feed` view shows both

`app/actions.ts` (`submitReservation`) re-validates everything server-side;
the guest form's checks are only there for immediate feedback.

Migrations use the unpooled connection (DDL needs a direct session); the app
uses the pooled one. Both pin `sslmode=verify-full`; local throwaway databases
(`localhost`) skip it.

## Motion

`lib/motion.tsx` reproduces the design's motion: the intro curtain, staggered
`data-intro` entrances, scroll reveals batched through one `IntersectionObserver`
so simultaneous entries stagger top-to-bottom, parallax, hero fade, header
auto-hide, and per-overlay entrances.

Pre-animation states live in CSS gated on `[data-motion]`, which an inline
script in `<head>` stamps before first paint — so nothing flashes in before
hydration and visitors without JS still see everything. `prefers-reduced-motion`
turns the whole system off.

## Assets

`public/assets/` holds the design's 39 photographs. `scripts/extract-assets.py`
re-derives them from the DesignSync reads in a session transcript and is
idempotent. Each has a `media` row (migration 008) with its type, pixel size
and byte count, which `node scripts/measure-assets.mjs` prints as the
migration's `VALUES` block; `content-seed.test.ts` re-measures every file.

Five source photos exceed the DesignSync 192 KiB per-file transfer cap and are
substituted with the design's own smaller rendition of the same shot (listed in
that script's `FALLBACKS`): `chef`, `hero-taya`/`taya-hero`, `hero-indochine`,
`r-danaksara`, `r-hai-van-lounge`. Re-export those from the design project if
you want them at full resolution.

## Design source

`design-src/Furama Cuisine.dc.html` is the imported design canvas, kept for
reference so future design revisions can be diffed against what was built.

## Scripts

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `npm run dev`        | Dev server                     |
| `npm run build`      | Production build               |
| `npm run typecheck`  | `next typegen`, then `tsc` (no incremental cache) |
| `npm run lint`       | oxlint                         |
| `npm test`           | Vitest (unit, integration)     |
| `npm run test:e2e`   | Playwright                     |
| `npm run test:visual` | Screenshot comparison (local) |
| `npm run db:migrate` | Apply pending SQL migrations   |
| `npm run db:psql`    | psql shell against Neon        |
| `node scripts/measure-assets.mjs` | The `media` rows of `public/assets` (migration 008's `VALUES`) |
